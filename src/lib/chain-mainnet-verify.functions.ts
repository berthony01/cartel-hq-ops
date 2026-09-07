import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPublicClient, defineChain, encodeAbiParameters, http, keccak256 } from "viem";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import {
  CARTEL_FIXED_ERC20_ABI,
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";

/**
 * P3B — PRODUCTION (Robinhood Chain 4663) deployment verifier + finality checker.
 *
 * SAFETY MODEL
 * ------------
 *  - Structurally separate from the testnet verifier. This module does NOT
 *    import `chain-verify.functions.ts`, `chain-registry.ts`, or
 *    `chain-launcher.ts`, so no testnet constant (notably the legacy fixed
 *    confirmation count) can ever leak in as authority here.
 *  - CHAIN ACCESS IS READ-ONLY. There is no signer, no wallet access, no
 *    transaction builder, no approval / liquidity path. Every chain call is an
 *    `eth_call`-class read. DATABASE STATE WRITES ARE PRESENT in this module
 *    but are hard-locked off (see STATE-WRITE LOCK below): while the lock is
 *    false no service-role client is imported and no row is mutated.

 *  - The ONLY transport permitted is the server-only managed provider named by
 *    `ROBINHOOD_MAINNET_MANAGED_RPC_ENV`. The public diagnostic endpoint is
 *    deliberately NOT imported: a rate-limited public endpoint can be censored
 *    or lag, so it may never be authoritative for production evidence and may
 *    never act as a fallback. Absent managed provider => fail closed.
 *  - The managed endpoint value and raw provider error text are never returned,
 *    logged, or serialized. Callers receive deterministic non-secret codes.
 *  - Confirmations are OBSERVATIONAL ONLY. On an L2 a fixed confirmation depth
 *    is not a settlement proof; only the provider's `finalized` head is. No
 *    count anywhere in this file authorizes finality or CONFIRMED status.
 *
 * STATE-WRITE GATE (P3C-E: ACTIVATED)
 * -----------------------------------
 * `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` lives in
 * `./chain-mainnet-verify-apply` and is now literal `true`: this verifier may
 * persist independently observed evidence and managed finality. It remains a
 * local, independent gate — it grants NOTHING to the registry's
 * deployment/liquidity switches (both still literal `false`) or to the
 * Supabase runtime execution control (still stopped). Writes are
 * invocation-bound: importing this module writes nothing, and every apply call
 * still sits behind the gate and re-asserts inside the helper before any
 * service-role import, so turning the gate off again fails closed.
 */
import {
  POSTGRES_INTEGER_MAX,
  STATE_WRITES_ENABLED,
  STATE_WRITE_FAILED_RETRYABLE,
  applyProductionDeploymentVerification,
  applyProductionFinality,
} from "./chain-mainnet-verify-apply";
import { readManagedReceipt } from "./chain-mainnet-verify-receipt";
import {
  baseResult,
  buildInitCode,
  mainnetChain,
  type MainnetVerifyResult,
} from "./chain-mainnet-verify-shape";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const DIGITS = /^[0-9]+$/;




export type {
  MainnetFinalityClassification,
  MainnetVerifyResult,
} from "./chain-mainnet-verify-shape";

const lower = (v: string) => v.toLowerCase();


/* -------------------------------------------------------------------------
 * Service-role apply helpers live in `./chain-mainnet-verify-apply`.
 *
 * The exported verifier calls them in exactly this order, and only inside
 * `if (STATE_WRITES_ENABLED)` branches:
 *   1. PENDING with complete, independently observed mined + token evidence;
 *   2. managed finality only — FINALITY_PENDING / PROVIDER_INCONSISTENT /
 *      FINALIZED (production finality RPC, `MANAGED` authority);
 *   3. CONFIRMED only after a FINALIZED apply succeeded, reusing the exact
 *      same immutable mined/token evidence recorded at PENDING.
 * No path persists FAILED in this slice. Each helper re-asserts the gate
 * before importing the admin client, so a future gate-off fails closed.
 * ---------------------------------------------------------------------- */



type VerifyInput = { deploymentId: string };

export const verifyMainnetChainDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VerifyInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    return { deploymentId: input.deploymentId };
  })
  .handler(async ({ data, context }): Promise<MainnetVerifyResult> => {
    // RLS (platform owner AND workspace operator) decides visibility. A missing
    // or cross-tenant row yields a generic error that leaks nothing.
    const { data: row, error } = await context.supabase
      .from("launch_chain_deployments")
      .select(
        "id, status, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, tx_hash, confirmations, contract_address, block_number, block_hash, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, finality_state, finalized_block_number, finalized_head_block_number, finalized_block_hash_confirmed",
      )
      .eq("id", data.deploymentId)
      .maybeSingle();

    if (error || !row) throw new Error("Not authorized");

    // Observed evidence fields stay null until this module reads them from the
    // managed provider itself. Stored DB values are never presented as
    // independently observed.
    const result = baseResult(String(row.status));

    // Safe early returns: no chain read, no write.
    if (
      row.status === "DRAFT" ||
      row.status === "ABANDONED" ||
      row.status === "FAILED" ||
      row.status === "CONFIRMED" ||
      !row.tx_hash
    ) {
      return result;
    }

    // Hard row pins. Wrong chain / environment / artifact fails closed.
    const supplyText =
      typeof row.token_total_supply_text === "string" ? row.token_total_supply_text : null;
    const recipient = typeof row.token_recipient === "string" ? lower(row.token_recipient) : null;
    const deployer = lower(String(row.deployer_address));

    if (
      Number(row.chain_id) !== ROBINHOOD_MAINNET_CHAIN_ID ||
      row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT ||
      row.deployment_kind !== "FIXED_SUPPLY_ERC20" ||
      row.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID ||
      row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      !row.token_name ||
      !row.token_symbol ||
      supplyText === null ||
      !DIGITS.test(supplyText) ||
      recipient === null ||
      !ADDRESS.test(recipient) ||
      !ADDRESS.test(deployer)
    ) {
      throw new Error("Unsupported deployment artifact");
    }

    const txHashRaw = lower(String(row.tx_hash));
    if (!TX_HASH.test(txHashRaw)) {
      // A malformed recorded hash is never "retry later"; it is fail-closed.
      result.notice = "RECORDED_TX_HASH_MALFORMED";
      return result;
    }
    const txHash = txHashRaw as `0x${string}`;

    // MANAGED transport only. No fallback of any kind.
    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) {
      result.notice = "MANAGED_RPC_UNCONFIGURED";
      return result;
    }

    const client = createPublicClient({
      chain: mainnetChain(endpoint),
      transport: http(endpoint),
    });

    // Independently pin the managed endpoint's own chain id before any
    // evidence read. A misconfigured managed provider pointed at another
    // network must never produce production evidence. No fallback endpoint.
    let observedChainId: number | null = null;
    try {
      observedChainId = await client.getChainId();
    } catch {
      observedChainId = null;
    }
    if (observedChainId === null) {
      result.notice = "MANAGED_RPC_CHAIN_ID_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      result.notice = "MANAGED_RPC_CHAIN_MISMATCH";
      return result;
    }

    const expectedSupply = BigInt(supplyText);
    const expectedInitCode = lower(
      buildInitCode({
        name: String(row.token_name),
        symbol: String(row.token_symbol),
        totalSupply: expectedSupply,
        recipient: recipient as `0x${string}`,
      }),
    );

    // ---- Independent evidence. Nothing below originates from the browser. ----
    let tx: Awaited<ReturnType<typeof client.getTransaction>> | null = null;
    try {
      tx = await client.getTransaction({ hash: txHash });
    } catch {
      tx = null;
    }
    if (!tx) {
      // Not yet visible / provider hiccup: retryable, NEVER proof of failure.
      result.notice = "TX_NOT_VISIBLE_RETRYABLE";
      return result;
    }

    // Fatal shape checks (contract creation, zero value, correct sender).
    if (tx.to !== null && tx.to !== undefined) {
      result.notice = "MISMATCH_NOT_CONTRACT_CREATION";
      return result;
    }
    if (tx.value !== 0n) {
      result.notice = "MISMATCH_NONZERO_VALUE";
      return result;
    }
    if (lower(String(tx.from)) !== deployer) {
      result.notice = "MISMATCH_SENDER";
      return result;
    }
    if (lower(String(tx.input)) !== expectedInitCode) {
      result.notice = "MISMATCH_INIT_CODE";
      return result;
    }

    // Truthful receipt classification (P3C Pre-Canary Hardening A). Provider
    // uncertainty is retryable and NEVER promotes status/finality/CONFIRMED,
    // never marks FAILED, and performs no state write.
    const receiptRead = await readManagedReceipt(endpoint, txHash);
    if (receiptRead.kind === "ABSENT") {
      // Authoritative JSON-RPC `result: null` — genuinely not mined yet.
      result.notice = "RECEIPT_NOT_MINED_RETRYABLE";
      return result;
    }
    if (receiptRead.kind === "UNAVAILABLE") {
      result.notice = "RECEIPT_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (receiptRead.kind === "MALFORMED") {
      result.notice = "RECEIPT_MALFORMED_RETRYABLE";
      return result;
    }
    const receipt = receiptRead.receipt;
    if (lower(String(receipt.transactionHash)) !== txHash) {
      result.notice = "MISMATCH_RECEIPT_TX_HASH";
      return result;
    }
    if (receipt.status !== "0x1") {
      result.notice = "MISMATCH_RECEIPT_REVERTED";
      return result;
    }
    const contractAddress = receipt.contractAddress ? lower(receipt.contractAddress) : null;
    if (!contractAddress || !ADDRESS.test(contractAddress)) {
      result.notice = "MISMATCH_NO_CREATED_CONTRACT";
      return result;
    }
    const receiptBlockHash = receipt.blockHash ? lower(receipt.blockHash) : null;
    if (receipt.blockNumber === null || !receiptBlockHash) {
      result.notice = "RECEIPT_BLOCK_UNAVAILABLE_RETRYABLE";
      return result;
    }
    const receiptBlockNumber = BigInt(receipt.blockNumber);


    result.contractAddress = contractAddress;
    result.blockNumber = receiptBlockNumber.toString();
    result.blockHash = receiptBlockHash;

    // Stored mined evidence is immutable. It is compared to, never trusted
    // over, and never overwritten by this read-only module.
    if (row.contract_address && lower(String(row.contract_address)) !== contractAddress) {
      result.notice = "MISMATCH_RECORDED_CONTRACT_ADDRESS";
      return result;
    }
    if (
      row.block_number !== null &&
      row.block_number !== undefined &&
      BigInt(row.block_number) !== receiptBlockNumber
    ) {
      result.notice = "MISMATCH_RECORDED_BLOCK_NUMBER";
      return result;
    }
    if (row.block_hash && lower(String(row.block_hash)) !== receiptBlockHash) {
      result.finality = "PROVIDER_INCONSISTENT";
      result.finalityAuthority = "MANAGED";
      result.notice = "MISMATCH_RECORDED_BLOCK_HASH";
      return result;
    }

    // Re-read the deployment block by exact number: mined evidence is only
    // stable if the canonical block at that height still carries that hash.
    let minedBlockHash: string | null = null;
    try {
      const block = await client.getBlock({ blockNumber: receiptBlockNumber });
      minedBlockHash = block.hash ? lower(block.hash) : null;
    } catch {
      minedBlockHash = null;
    }
    if (!minedBlockHash) {
      result.notice = "BLOCK_READ_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (minedBlockHash !== receiptBlockHash) {
      // Immutable block-hash mismatch => reorg evidence. Fatal candidate.
      result.finality = "PROVIDER_INCONSISTENT";
      result.finalityAuthority = "MANAGED";
      result.notice = "MISMATCH_BLOCK_HASH_REORG";
      return result;
    }

    // Runtime artifact pin.
    let runtimeCode: `0x${string}` | undefined;
    try {
      runtimeCode = await client.getCode({ address: contractAddress as `0x${string}` });
    } catch {
      runtimeCode = undefined;
    }
    if (!runtimeCode || runtimeCode === "0x") {
      result.notice = "RUNTIME_CODE_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (lower(keccak256(runtimeCode)) !== lower(CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH)) {
      result.notice = "MISMATCH_RUNTIME_ARTIFACT";
      return result;
    }

    // Token state must equal stored intent exactly (bigint comparison).
    let token: {
      name: string;
      symbol: string;
      decimals: number;
      totalSupply: bigint;
      recipientBalance: bigint;
    } | null = null;
    try {
      const address = contractAddress as `0x${string}`;
      const [name, symbol, decimals, totalSupply, recipientBalance] = await Promise.all([
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "name" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "decimals" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "totalSupply" }),
        client.readContract({
          address,
          abi: CARTEL_FIXED_ERC20_ABI,
          functionName: "balanceOf",
          args: [recipient as `0x${string}`],
        }),
      ]);
      token = {
        name: String(name),
        symbol: String(symbol),
        decimals: Number(decimals),
        totalSupply: BigInt(totalSupply),
        recipientBalance: BigInt(recipientBalance),
      };
    } catch {
      token = null;
    }
    if (!token) {
      result.notice = "TOKEN_READ_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (
      token.name !== String(row.token_name) ||
      token.symbol !== String(row.token_symbol) ||
      token.decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      token.totalSupply !== expectedSupply ||
      token.recipientBalance !== expectedSupply
    ) {
      result.notice = "MISMATCH_TOKEN_STATE";
      return result;
    }

    // Observational confirmations from `latest`. DIAGNOSTIC DISPLAY ONLY —
    // deliberately computed after all evidence checks and never consulted by
    // any branch below. A depth count cannot settle an L2. Values outside the
    // PostgreSQL signed INTEGER domain [0, 2_147_483_647] are omitted rather
    // than coerced, because `_observed_confirmations` is an `integer` column.
    try {
      const latest = await client.getBlockNumber();
      const diff = latest - receiptBlockNumber + 1n;
      const bounded = diff > 0n ? diff : 0n;
      result.observationalConfirmations =
        bounded >= 0n && bounded <= POSTGRES_INTEGER_MAX ? Number(bounded) : null;
    } catch {
      result.observationalConfirmations = null;
    }
    const diagnosticConfirmations = result.observationalConfirmations;

    /**
     * STEP A — MINED / TOKEN EVIDENCE -> PENDING.
     * Every mined and token check above has passed, so the evidence recorded
     * here is fully independent of the browser. This exact evidence object is
     * reused verbatim by the CONFIRMED apply in step C; nothing re-reads or
     * re-derives it. Confirmations travel as a diagnostic field only.
     */
    const minedEvidence = {
      deploymentId: data.deploymentId,
      contractAddress,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      verifiedToken: token,
      ...(diagnosticConfirmations !== null
        ? { observedConfirmations: diagnosticConfirmations }
        : {}),
    } as const;

    let pendingRowEstablished = false;
    if (STATE_WRITES_ENABLED) {
      try {
        await applyProductionDeploymentVerification({ ...minedEvidence, status: "PENDING" });
        pendingRowEstablished = true;
        // The PENDING apply landed, so the reported DB status is now PENDING.
        // Status only ever advances after the corresponding RPC succeeded.
        result.status = "PENDING";
      } catch {
        // Sanitized and retryable: never FAILED, never CONFIRMED. The last
        // status known to have landed (the RLS read) is preserved.
        result.notice = STATE_WRITE_FAILED_RETRYABLE;
        return result;
      }
    }



    // ---- Finality: MANAGED provider `finalized` tag only. ----
    // No `safe`, no `latest - N`, no fixed confirmation count, no public
    // diagnostic endpoint, no timing heuristic.
    result.finalityAuthority = "MANAGED";
    let finalizedHead: bigint | null = null;
    try {
      const finalizedBlock = await client.getBlock({ blockTag: "finalized" });
      const n = finalizedBlock?.number;
      finalizedHead = typeof n === "bigint" && n >= 0n ? n : null;
    } catch {
      finalizedHead = null;
    }
    if (finalizedHead === null) {
      // Unsupported tag / malformed / provider error: retryable, no promotion,
      // and deliberately no finality write — an absent head is not evidence.
      result.finality = "FINALITY_PENDING";
      result.notice = "FINALIZED_HEAD_UNAVAILABLE_RETRYABLE";
      return result;
    }
    result.finalizedHeadBlockNumber = finalizedHead.toString();

    const storedHead =
      row.finalized_head_block_number === null || row.finalized_head_block_number === undefined
        ? null
        : BigInt(row.finalized_head_block_number);
    if (storedHead !== null && finalizedHead < storedHead) {
      // A retreating finalized head is never legitimate.
      result.finality = "PROVIDER_INCONSISTENT";
      result.notice = "FINALIZED_HEAD_RETREATED";
      // Only recordable against a PENDING row this run established. A PENDING
      // row is never fabricated merely to carry an inconsistency.
      if (STATE_WRITES_ENABLED && pendingRowEstablished) {
        try {
          await applyProductionFinality({
            deploymentId: data.deploymentId,
            finalityState: "PROVIDER_INCONSISTENT",
            finalizedHeadBlockNumber: finalizedHead,
            finalizedBlockHashConfirmed: false,
            finalityNotice: "FINALIZED_HEAD_RETREATED",
          });
        } catch {
          result.notice = STATE_WRITE_FAILED_RETRYABLE;
        }
      }
      return result;
    }

    // Second canonical deployment-block re-read AFTER the finalized head was
    // obtained: closes the time-of-check / time-of-finality-check gap where a
    // reorg lands between the first continuity check and the head read.
    let finalityBlockHash: string | null = null;
    try {
      const reread = await client.getBlock({ blockNumber: receiptBlockNumber });
      finalityBlockHash = reread.hash ? lower(reread.hash) : null;
    } catch {
      finalityBlockHash = null;
    }
    if (!finalityBlockHash) {
      // Transport failure, not evidence: retryable, no finality write.
      result.finality = "FINALITY_PENDING";
      result.notice = "FINALITY_BLOCK_REREAD_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (finalityBlockHash !== receiptBlockHash) {
      result.finality = "PROVIDER_INCONSISTENT";
      result.notice = "FINALITY_BLOCK_HASH_CHANGED";
      if (STATE_WRITES_ENABLED && pendingRowEstablished) {
        try {
          await applyProductionFinality({
            deploymentId: data.deploymentId,
            finalityState: "PROVIDER_INCONSISTENT",
            finalizedHeadBlockNumber: finalizedHead,
            finalizedBlockHashConfirmed: false,
            finalityNotice: "FINALITY_BLOCK_HASH_CHANGED",
          });
        } catch {
          result.notice = STATE_WRITE_FAILED_RETRYABLE;
        }
      }
      return result;
    }

    /**
     * STEP B — MANAGED FINALITY. Clean canonical deployment block, but the
     * managed finalized head has not reached it yet: FINALITY_PENDING only.
     */
    if (finalizedHead < receiptBlockNumber) {
      result.finality = "FINALITY_PENDING";
      result.notice = MAINNET_VERIFICATION_STATE_WRITES_ENABLED ? null : "STATE_WRITES_DISABLED";
      if (STATE_WRITES_ENABLED) {
        try {
          await applyProductionFinality({
            deploymentId: data.deploymentId,
            finalityState: "FINALITY_PENDING",
            finalizedHeadBlockNumber: finalizedHead,
            finalizedBlockHashConfirmed: true,
          });
        } catch {
          result.notice = STATE_WRITE_FAILED_RETRYABLE;
        }
      }
      return result;
    }

    // Finalized head has passed the deployment block and the block hash still
    // matches. Under the local lock this is a CANDIDATE only: no DB promotion,
    // and never a claim of DEPLOYMENT_VERIFIED or CONFIRMED.
    result.finality = "FINALIZED_CANDIDATE";
    result.notice = MAINNET_VERIFICATION_STATE_WRITES_ENABLED ? null : "STATE_WRITES_DISABLED";

    if (STATE_WRITES_ENABLED) {
      /**
       * STEP B (cont.) — FINALIZED must be applied FIRST, with the finalized
       * block exactly equal to the deployment block.
       */
      try {
        await applyProductionFinality({
          deploymentId: data.deploymentId,
          finalityState: "FINALIZED",
          finalizedBlockNumber: receiptBlockNumber,
          finalizedHeadBlockNumber: finalizedHead,
          finalizedBlockHashConfirmed: true,
        });
      } catch {
        // FINALIZED did not land, so CONFIRMED must not be attempted. The
        // deployment status stays at PENDING, the last status that landed.
        result.notice = STATE_WRITE_FAILED_RETRYABLE;
        return result;
      }

      /**
       * STEP C — FINALIZED -> CONFIRMED, reusing the identical immutable
       * mined/token evidence already recorded at PENDING. Unreachable unless
       * the FINALIZED apply above succeeded. Status is only promoted to
       * CONFIRMED after this RPC actually succeeds.
       */
      try {
        await applyProductionDeploymentVerification({ ...minedEvidence, status: "CONFIRMED" });
        result.status = "CONFIRMED";
      } catch {
        result.notice = STATE_WRITE_FAILED_RETRYABLE;
        return result;
      }
    }

    return result;
  });
