import { createServerFn } from "@tanstack/react-start";
import { keccak256, stringToHex } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_DECIMALS,
} from "./cartel-fixed-erc20.artifact";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import {
  ADDRESS,
  BASE_UNIT_SCALE,
  DIGITS,
  HASH32,
  PRESIGN_BASE_FEE_HEADROOM_MULTIPLIER,
  PRESIGN_GAS_LIMIT_DENOMINATOR,
  PRESIGN_GAS_LIMIT_NUMERATOR,
  PRESIGN_MAX_QUOTE_BUILD_MS,
  PRESIGN_TTL_SECONDS,
  REQUEST_ID,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  UUID,
  ZERO_ADDRESS,
  baseResult,
  buildInitCode,
  ceilDiv,
  fail,
  fingerprintPreimage,
  lower,
  parseHexQuantity,
  rpcCall,
} from "./chain-mainnet-presign.helpers";

/**
 * P3C-B — Robinhood Chain PRODUCTION (4663) MANAGED SERVER-SIDE PRE-SIGN GATE.
 *
 * SCOPE AND SAFETY
 * ----------------
 * This authenticated server function independently reconstructs the exact
 * fixed-supply ERC-20 contract-creation payload from the stored P3C-A1
 * deployment intent plus the frozen artifact, verifies it against the stored
 * `init_code_hash` and `review_fingerprint`, performs READ-ONLY managed
 * JSON-RPC checks, and only then issues the P3C-A2 authorization through the
 * service-role-only `issue_launch_chain_production_presign_authorization` RPC.
 *
 * Invariants enforced by construction:
 *   - nothing here signs, prepares a signature, or broadcasts a transaction;
 *     there is no wallet method, no injected provider, and no signer;
 *   - no deployment status transition, no tx-hash write, no verifier state
 *     write, no liquidity/pool code;
 *   - the browser supplies ONLY a deployment id and a client request id. The
 *     operator identity is `context.userId`; every economic value is derived
 *     server-side from the managed provider;
 *   - the managed RPC URL is read from process.env inside the handler only and
 *     is never returned, logged, or embedded in an error. There is NO public
 *     diagnostic fallback;
 *   - all supply/gas/fee/cost arithmetic is `bigint`; no `Number` conversion
 *     touches any chain quantity;
 *   - issuing a short-lived A2 authorization is not execution. The production
 *     deployment switch stays off and is neither read as permission nor
 *     changed here; wallet handoff is gated separately in a later phase.
 *
 * Deterministic result codes, frozen policy constants, the pure intent
 * helpers and the read-only managed JSON-RPC transport live in
 * `./chain-mainnet-presign.helpers` and are re-exported here unchanged so that
 * existing importers of this module are unaffected.
 */

export type { PresignNotice, MainnetPresignResult } from "./chain-mainnet-presign.helpers";
export { PRESIGN_TTL_SECONDS } from "./chain-mainnet-presign.helpers";


/* ------------------------------------------------------------------ */
/* Server function                                                     */
/* ------------------------------------------------------------------ */

type PresignInput = { deploymentId: string; clientRequestId: string };

export const presignMainnetTokenDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PresignInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    if (typeof input.clientRequestId !== "string") {
      throw new Error("Invalid client request id");
    }
    return { deploymentId: input.deploymentId, clientRequestId: input.clientRequestId };
  })
  .handler(async ({ data, context }): Promise<MainnetPresignResult> => {
    const deploymentId = data.deploymentId;

    // ---- Client request id: validated, never silently rewritten. ----
    const clientRequestId = data.clientRequestId;
    if (
      clientRequestId.length < 8 ||
      clientRequestId.length > 128 ||
      !REQUEST_ID.test(clientRequestId)
    ) {
      return fail(deploymentId, "INVALID_REQUEST_ID");
    }

    // ---- Tenancy: RLS through the caller's own client is the first gate. ----
    const { data: row, error } = await context.supabase
      .from("launch_chain_deployments")
      .select(
        "id, status, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, tx_hash, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, review_fingerprint, init_code_hash",
      )
      .eq("id", deploymentId)
      .maybeSingle();

    if (error || !row) return fail(deploymentId, "NOT_AUTHORIZED");

    // ---- Hard row pins. Any mismatch fails closed. ----
    const deployer = typeof row.deployer_address === "string" ? lower(row.deployer_address) : "";
    const recipient = typeof row.token_recipient === "string" ? lower(row.token_recipient) : "";
    const supplyText =
      typeof row.token_total_supply_text === "string" ? row.token_total_supply_text.trim() : "";
    const storedInitCodeHash =
      typeof row.init_code_hash === "string" ? lower(row.init_code_hash) : "";
    const storedFingerprint =
      typeof row.review_fingerprint === "string" ? lower(row.review_fingerprint) : "";
    const tokenName = typeof row.token_name === "string" ? row.token_name : "";
    const tokenSymbol = typeof row.token_symbol === "string" ? row.token_symbol : "";

    if (
      row.chain_id !== ROBINHOOD_MAINNET_CHAIN_ID ||
      row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT ||
      row.deployment_kind !== "FIXED_SUPPLY_ERC20" ||
      row.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID ||
      row.status !== "DRAFT" ||
      row.tx_hash !== null ||
      !ADDRESS.test(deployer) ||
      deployer === ZERO_ADDRESS ||
      !ADDRESS.test(recipient) ||
      recipient === ZERO_ADDRESS ||
      row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      !TOKEN_NAME.test(tokenName) ||
      !TOKEN_SYMBOL.test(tokenSymbol) ||
      !DIGITS.test(supplyText) ||
      !HASH32.test(storedFingerprint) ||
      !HASH32.test(storedInitCodeHash)
    ) {
      return fail(deploymentId, "UNSUPPORTED_DEPLOYMENT");
    }

    // ---- Exact base-unit supply handling. bigint only. ----
    const totalSupplyBaseUnits = BigInt(supplyText);
    if (totalSupplyBaseUnits <= 0n || totalSupplyBaseUnits % BASE_UNIT_SCALE !== 0n) {
      return fail(deploymentId, "UNSUPPORTED_DEPLOYMENT");
    }
    const supplyWhole = totalSupplyBaseUnits / BASE_UNIT_SCALE;

    // ---- Independent reconstruction of the exact creation payload. ----
    const initCode = buildInitCode({
      name: tokenName,
      symbol: tokenSymbol,
      totalSupply: totalSupplyBaseUnits,
      recipient,
    });
    const initCodeHash = lower(keccak256(initCode));
    if (initCodeHash !== storedInitCodeHash) {
      return fail(deploymentId, "INIT_CODE_HASH_MISMATCH");
    }

    const fingerprint = lower(
      keccak256(
        stringToHex(
          fingerprintPreimage({
            deployer,
            recipient,
            name: tokenName,
            symbol: tokenSymbol,
            supplyWhole: supplyWhole.toString(),
            totalSupplyBaseUnits: totalSupplyBaseUnits.toString(),
            initCodeHash,
          }),
        ),
      ),
    );
    if (fingerprint !== storedFingerprint) {
      return fail(deploymentId, "INTENT_FINGERPRINT_MISMATCH");
    }

    // ---- Idempotent recovery BEFORE any chain read (authenticated GET). ----
    const { data: existing, error: existingError } = await context.supabase.rpc(
      "get_launch_chain_production_presign_authorization",
      { _deployment_id: deploymentId },
    );
    if (existingError) return fail(deploymentId, "NOT_AUTHORIZED");

    const current = (Array.isArray(existing) ? existing[0] : existing) as
      | {
          id: string;
          deployment_id: string;
          operator_user_id: string;
          deployer_address: string;
          review_fingerprint: string;
          init_code_hash: string;
          client_request_id: string;
          status: string;
          expires_at: string;
          fee_model: string;
          gas_estimate_text: string;
          gas_limit_text: string;
          observed_fee_per_gas_wei_text: string;
          max_fee_per_gas_wei_text: string;
          max_priority_fee_per_gas_wei_text: string | null;
          estimated_cost_wei_text: string;
          max_total_cost_wei_text: string;
        }
      | null
      | undefined;

    if (current) {
      const expiresAtMs = Date.parse(current.expires_at);
      const unexpired = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();

      if (current.client_request_id === clientRequestId) {
        const bindingOk =
          current.deployment_id === deploymentId &&
          current.operator_user_id === context.userId &&
          lower(current.deployer_address) === deployer &&
          lower(current.review_fingerprint) === storedFingerprint &&
          lower(current.init_code_hash) === storedInitCodeHash;

        if (!bindingOk) return fail(deploymentId, "PRESIGN_REQUEST_CONFLICT");
        if (current.status === "CLAIMED") return fail(deploymentId, "PRESIGN_ALREADY_CLAIMED");
        if (current.status === "ISSUED" && unexpired) {
          return {
            ...baseResult(deploymentId),
            ok: true,
            notice: null,
            authorizationId: current.id,
            status: current.status,
            recoveredExisting: true,
            expiresAt: current.expires_at,
            feeModel: current.fee_model === "LEGACY" ? "LEGACY" : "EIP1559",
            gasEstimate: current.gas_estimate_text,
            gasLimit: current.gas_limit_text,
            observedFeePerGasWei: current.observed_fee_per_gas_wei_text,
            maxFeePerGasWei: current.max_fee_per_gas_wei_text,
            maxPriorityFeePerGasWei: current.max_priority_fee_per_gas_wei_text,
            estimatedCostWei: current.estimated_cost_wei_text,
            maxTotalCostWei: current.max_total_cost_wei_text,
          };
        }
        return fail(deploymentId, "PRESIGN_REQUEST_TERMINAL_REUSE");
      }

      // Different request id: an unresolved authorization blocks a new quote.
      if (current.status === "CLAIMED" || (current.status === "ISSUED" && unexpired)) {
        return fail(deploymentId, "PRESIGN_UNRESOLVED_AUTHORIZATION_EXISTS");
      }
    }

    // ---- MANAGED transport only. No fallback of any kind. ----
    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) return fail(deploymentId, "MANAGED_RPC_UNCONFIGURED");

    const quoteStartedAt = Date.now();

    // 1. Chain pin.
    const chainIdOutcome = await rpcCall<string>(endpoint, "eth_chainId", []);
    if (!chainIdOutcome.ok) return fail(deploymentId, chainIdOutcome.notice);
    const observedChainId = parseHexQuantity(chainIdOutcome.value);
    if (observedChainId === null) return fail(deploymentId, "MALFORMED_RESPONSE");
    if (observedChainId !== BigInt(ROBINHOOD_MAINNET_CHAIN_ID)) {
      return fail(deploymentId, "MANAGED_RPC_CHAIN_MISMATCH");
    }

    const tx = { from: deployer, data: initCode, value: "0x0" };

    // 2. Read-only execution of the exact creation payload.
    const callOutcome = await rpcCall<unknown>(endpoint, "eth_call", [tx, "latest"]);
    if (!callOutcome.ok) {
      // Revert data is never surfaced.
      return fail(
        deploymentId,
        callOutcome.notice === "RPC_ERROR" ? "CREATION_SIMULATION_REVERTED" : callOutcome.notice,
      );
    }

    // 3. Gas estimate for exactly the same creation tx.
    const gasOutcome = await rpcCall<string>(endpoint, "eth_estimateGas", [tx]);
    if (!gasOutcome.ok) {
      return fail(
        deploymentId,
        gasOutcome.notice === "RPC_ERROR" ? "GAS_ESTIMATION_FAILED" : gasOutcome.notice,
      );
    }
    const gasEstimate = parseHexQuantity(gasOutcome.value);
    if (gasEstimate === null) return fail(deploymentId, "MALFORMED_RESPONSE");
    if (gasEstimate <= 0n) return fail(deploymentId, "GAS_ESTIMATION_FAILED");

    // 4. Latest block: base fee (fee model) and block gas limit.
    const blockOutcome = await rpcCall<{ baseFeePerGas?: unknown; gasLimit?: unknown } | null>(
      endpoint,
      "eth_getBlockByNumber",
      ["latest", false],
    );
    if (!blockOutcome.ok) return fail(deploymentId, blockOutcome.notice);
    const block = blockOutcome.value;
    if (block === null || typeof block !== "object") {
      return fail(deploymentId, "MALFORMED_RESPONSE");
    }
    const blockGasLimit = parseHexQuantity(block.gasLimit);
    if (blockGasLimit === null || blockGasLimit <= 0n) {
      return fail(deploymentId, "MALFORMED_RESPONSE");
    }

    const baseFeeAbsent = block.baseFeePerGas === undefined || block.baseFeePerGas === null;

    let feeModel: "EIP1559" | "LEGACY";
    let observedFeePerGas: bigint;
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint | null;

    if (!baseFeeAbsent) {
      // Present-but-malformed base fee is a malformed response, never LEGACY.
      const baseFee = parseHexQuantity(block.baseFeePerGas);
      if (baseFee === null) return fail(deploymentId, "MALFORMED_RESPONSE");

      // 5. Priority fee. A failed or malformed read is never defaulted to zero.
      const priorityOutcome = await rpcCall<string>(endpoint, "eth_maxPriorityFeePerGas", []);
      if (!priorityOutcome.ok) {
        return fail(
          deploymentId,
          priorityOutcome.notice === "RPC_ERROR" ? "FEE_DATA_UNAVAILABLE" : priorityOutcome.notice,
        );
      }
      const priority = parseHexQuantity(priorityOutcome.value);
      if (priority === null) return fail(deploymentId, "MALFORMED_RESPONSE");

      feeModel = "EIP1559";
      observedFeePerGas = baseFee + priority;
      maxPriorityFeePerGas = priority;
      maxFeePerGas = baseFee * PRESIGN_BASE_FEE_HEADROOM_MULTIPLIER + priority;
    } else {
      // 6. LEGACY only when the base fee is genuinely absent.
      const gasPriceOutcome = await rpcCall<string>(endpoint, "eth_gasPrice", []);
      if (!gasPriceOutcome.ok) {
        return fail(
          deploymentId,
          gasPriceOutcome.notice === "RPC_ERROR" ? "FEE_DATA_UNAVAILABLE" : gasPriceOutcome.notice,
        );
      }
      const gasPrice = parseHexQuantity(gasPriceOutcome.value);
      if (gasPrice === null) return fail(deploymentId, "MALFORMED_RESPONSE");

      feeModel = "LEGACY";
      observedFeePerGas = gasPrice;
      maxFeePerGas = gasPrice;
      maxPriorityFeePerGas = null;
    }

    // 7. Deployer balance.
    const balanceOutcome = await rpcCall<string>(endpoint, "eth_getBalance", [deployer, "latest"]);
    if (!balanceOutcome.ok) {
      return fail(
        deploymentId,
        balanceOutcome.notice === "RPC_ERROR" ? "BALANCE_UNAVAILABLE" : balanceOutcome.notice,
      );
    }
    const balance = parseHexQuantity(balanceOutcome.value);
    if (balance === null) return fail(deploymentId, "MALFORMED_RESPONSE");

    // ---- Deterministic gas/cost policy. Cannot understate. ----
    const gasLimit = ceilDiv(gasEstimate, PRESIGN_GAS_LIMIT_NUMERATOR, PRESIGN_GAS_LIMIT_DENOMINATOR);
    const estimatedCost = gasEstimate * observedFeePerGas;
    const maxTotalCost = gasLimit * maxFeePerGas;

    const economics = {
      feeModel,
      gasEstimate: gasEstimate.toString(),
      gasLimit: gasLimit.toString(),
      observedFeePerGasWei: observedFeePerGas.toString(),
      maxFeePerGasWei: maxFeePerGas.toString(),
      maxPriorityFeePerGasWei: maxPriorityFeePerGas === null ? null : maxPriorityFeePerGas.toString(),
      estimatedCostWei: estimatedCost.toString(),
      maxTotalCostWei: maxTotalCost.toString(),
      balanceWei: balance.toString(),
    } as const;

    if (gasLimit > blockGasLimit) {
      return fail(deploymentId, "GAS_LIMIT_EXCEEDS_BLOCK_LIMIT", economics);
    }
    if (balance < maxTotalCost) {
      return fail(deploymentId, "INSUFFICIENT_BALANCE_FOR_MAX_COST", economics);
    }

    // ---- Freshness: never issue a fresh expiry from stale observations. ----
    if (Date.now() - quoteStartedAt > PRESIGN_MAX_QUOTE_BUILD_MS) {
      return fail(deploymentId, "QUOTE_BUILD_TOO_OLD", economics);
    }

    // ---- Service role reached only after every check above passed. ----
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: issued, error: issueError } = await supabaseAdmin.rpc(
      "issue_launch_chain_production_presign_authorization",
      {
        _deployment_id: deploymentId,
        _operator_user_id: context.userId,
        _client_request_id: clientRequestId,
        _gas_estimate_text: economics.gasEstimate,
        _gas_limit_text: economics.gasLimit,
        _fee_model: feeModel,
        _observed_fee_per_gas_wei_text: economics.observedFeePerGasWei,
        _max_fee_per_gas_wei_text: economics.maxFeePerGasWei,
        // LEGACY must carry no priority fee; A2 rejects a value there.
        _max_priority_fee_per_gas_wei_text:
          economics.maxPriorityFeePerGasWei as unknown as string,
        _estimated_cost_wei_text: economics.estimatedCostWei,
        _max_total_cost_wei_text: economics.maxTotalCostWei,
        _ttl_seconds: PRESIGN_TTL_SECONDS,
      },
    );

    if (issueError) {
      // Raw Supabase error text is never surfaced.
      const code = (issueError as { code?: string }).code;
      return fail(
        deploymentId,
        code === "22023" ? "PRESIGN_REQUEST_CONFLICT" : "PRESIGN_ISSUE_FAILED",
        economics,
      );
    }

    const authorization = (Array.isArray(issued) ? issued[0] : issued) as
      | { id: string; status: string; expires_at: string }
      | null
      | undefined;
    if (!authorization) return fail(deploymentId, "PRESIGN_ISSUE_FAILED", economics);

    return {
      ...baseResult(deploymentId),
      ...economics,
      ok: true,
      notice: null,
      authorizationId: authorization.id,
      status: authorization.status,
      recoveredExisting: false,
      expiresAt: authorization.expires_at,
    };
  });
