import { createServerFn } from "@tanstack/react-start";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
} from "./chain-mainnet-registry";

/**
 * P3C-C2 — Robinhood Chain PRODUCTION (4663) HANDOFF CONTRACT (server side).
 *
 * SCOPE AND SAFETY
 * ----------------
 * Two authenticated server functions and nothing else:
 *
 *   1. `claimMainnetDeploymentHandoff` — re-derives the exact creation payload
 *      from stored intent + frozen artifact, verifies it against the stored
 *      `init_code_hash` / `review_fingerprint`, CLAIMs the P3C-A2 authorization
 *      through the AUTHENTICATED claim RPC (never service role), and returns a
 *      bounded, non-editable wallet transaction envelope.
 *
 *   2. `persistMainnetDeploymentTxHash` — persists a canonical transaction hash
 *      for the SAME attempt and SAME authorization through the service-role-only
 *      atomic P3C-C1 RPC, after re-validating every caller/tenant/binding rule.
 *
 * Deliberate omissions — absence, not a flag, is the safety property:
 *   - No cancellation wrapper of any kind. Once a CLAIMED envelope has left the
 *     server, no application evidence can prove `eth_sendTransaction` was never
 *     invoked (a client boolean or local marker is forgeable). CLAIMED-unresolved
 *     therefore FREEZES for later, separately audited operator reconciliation.
 *   - No signing, no broadcast, no provider access, no wallet method here.
 *   - No verifier, lifecycle, official-contract, notification, Telegram, or
 *     liquidity call.
 *
 * Kill-switch semantics (deliberately asymmetric):
 *   - `MAINNET_DEPLOYMENT_TX_ENABLED` gates CLAIM + envelope emission. While it
 *     is false no envelope can exist, so no new send is possible.
 *   - It DOES NOT gate persistence. If a hash is already known from a send that
 *     began before the switch was turned off, recording that SAME hash against
 *     the SAME attempt must stay available; recovery is never blocked.
 *
 * Recovery semantics:
 *   - Never any automatic rebroadcast.
 *   - Hash known + persistence failed => retry persistence ONLY with the same
 *     hash, deployment and authorization. The C1 RPC is idempotent on that path.
 *   - A different hash for the same authorization is a hard conflict and freezes.
 *   - A browser exception after send invocation is ambiguous: it is never
 *     treated as proof of non-broadcast and never cancels anything.
 */

/* ------------------------------------------------------------------ */
/* Deterministic, non-leaking result codes                             */
/* ------------------------------------------------------------------ */

export type HandoffNotice =
  | "PRODUCTION_TX_DISABLED"
  | "NOT_AUTHORIZED"
  | "UNSUPPORTED_DEPLOYMENT"
  | "PRESIGN_NOT_FOUND"
  | "PRESIGN_NOT_ISSUED"
  | "PRESIGN_TOO_CLOSE_TO_EXPIRY"
  | "PRESIGN_BINDING_MISMATCH"
  | "INIT_CODE_HASH_MISMATCH"
  | "INTENT_FINGERPRINT_MISMATCH"
  | "INVALID_ECONOMIC_EVIDENCE"
  | "CLAIM_FAILED"
  | "INVALID_TX_HASH"
  | "PERSIST_CONFLICT"
  | "PERSIST_FAILED";

/* ------------------------------------------------------------------ */
/* Wallet envelope types — single source of truth for both sides       */
/* ------------------------------------------------------------------ */

/**
 * Contract-creation only. There is intentionally NO `to` member on either
 * variant: the absence of a recipient is what makes this a creation.
 */
export type MainnetEip1559Envelope = {
  from: string;
  data: string;
  value: "0x0";
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
};

export type MainnetLegacyEnvelope = {
  from: string;
  data: string;
  value: "0x0";
  gas: string;
  gasPrice: string;
};

export type MainnetWalletEnvelope = MainnetEip1559Envelope | MainnetLegacyEnvelope;

export type MainnetHandoffClaimResult = {
  ok: boolean;
  notice: HandoffNotice | null;
  deploymentId: string;
  authorizationId: string | null;
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  expiresAt: string | null;
  feeModel: "EIP1559" | "LEGACY" | null;
  envelope: MainnetWalletEnvelope | null;
};

export type MainnetHandoffPersistResult = {
  ok: boolean;
  notice: HandoffNotice | null;
  deploymentId: string;
  authorizationId: string;
  txHash: string | null;
  deploymentStatus: string | null;
  authorizationStatus: string | null;
  recoveredExisting: boolean;
};

/* ------------------------------------------------------------------ */
/* Frozen policy constants                                             */
/* ------------------------------------------------------------------ */

/**
 * Widened deliberately. The registry literal is `false as const`; comparing a
 * `false` literal to `true` is a type error and would also let a future
 * activation silently narrow away the guard. Widening keeps the runtime check
 * real and the whole guarded path type-checked.
 */
const PRODUCTION_SEND_ENABLED: boolean = MAINNET_DEPLOYMENT_TX_ENABLED;

/**
 * A claimed envelope must not be handed to a wallet with a near-dead TTL: the
 * operator still has to review and confirm in the wallet UI. Below this margin
 * we refuse to claim at all rather than burn the authorization.
 */
const HANDOFF_MIN_REMAINING_MS = 5_000;

/** Canonical P2 fingerprint domain and separator. Byte-identical to P3C-B. */
const FINGERPRINT_DOMAIN = "cartel-mainnet-sim-v1";
const FIELD_SEPARATOR = "\u001f";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;
const TOKEN_NAME = /^[\x20-\x7e]{1,32}$/;
const TOKEN_SYMBOL = /^[A-Z0-9]{2,11}$/;

const BASE_UNIT_SCALE = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function lower(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Canonical unsigned decimal string -> minimal RPC hex quantity.
 * `0` -> `0x0`, no leading zeros, bigint only, never `Number`.
 * Returns null for anything malformed; callers fail closed.
 */
export function decimalToHexQuantity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!DIGITS.test(text)) return null;
  try {
    return `0x${BigInt(text).toString(16)}`;
  } catch {
    return null;
  }
}

/** Strict canonical unsigned decimal guard used for stored economic evidence. */
function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === "string" && DIGITS.test(value.trim());
}

/** Canonical P2 fingerprint pre-image. 14 fields, trailing tx value "0". */
function fingerprintPreimage(fields: {
  deployer: string;
  recipient: string;
  name: string;
  symbol: string;
  supplyWhole: string;
  totalSupplyBaseUnits: string;
  initCodeHash: string;
}): string {
  return [
    FINGERPRINT_DOMAIN,
    ROBINHOOD_MAINNET_ENVIRONMENT,
    String(ROBINHOOD_MAINNET_CHAIN_ID),
    CARTEL_FIXED_ERC20_ARTIFACT_ID,
    CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH.toLowerCase(),
    fields.deployer.toLowerCase(),
    fields.recipient.toLowerCase(),
    fields.name.normalize("NFC"),
    fields.symbol.normalize("NFC"),
    String(CARTEL_FIXED_ERC20_DECIMALS),
    fields.supplyWhole,
    fields.totalSupplyBaseUnits,
    fields.initCodeHash.toLowerCase(),
    "0",
  ].join(FIELD_SEPARATOR);
}

/** Frozen creation bytecode + ABI-encoded constructor args. */
function buildInitCode(intent: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  recipient: string;
}): `0x${string}` {
  const args = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient as `0x${string}`],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

type AuthorizationRow = {
  id: string;
  deployment_id: string;
  workspace_id: string;
  launch_id: string;
  chain_id: number;
  network_environment: string;
  deployer_address: string;
  operator_user_id: string;
  review_fingerprint: string;
  init_code_hash: string;
  gas_limit_text: string;
  fee_model: string;
  max_fee_per_gas_wei_text: string;
  max_priority_fee_per_gas_wei_text: string | null;
  tx_value_wei: string;
  status: string;
  expires_at: string;
  claimed_at: string | null;
  consumed_at: string | null;
  consumed_tx_hash: string | null;
};

type DeploymentRow = {
  id: string;
  workspace_id: string;
  launch_id: string;
  status: string;
  chain_id: number;
  network_environment: string;
  deployment_kind: string;
  artifact_id: string | null;
  deployer_address: string | null;
  tx_hash: string | null;
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  token_total_supply_text: string | null;
  token_recipient: string | null;
  review_fingerprint: string | null;
  init_code_hash: string | null;
};

const DEPLOYMENT_COLUMNS =
  "id, workspace_id, launch_id, status, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, tx_hash, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, review_fingerprint, init_code_hash";

type IntentDerivation = {
  deployer: string;
  initCode: `0x${string}`;
  initCodeHash: string;
  fingerprint: string;
};

/**
 * Re-derives the creation payload from the live row alone and proves it against
 * the stored A1 evidence. Browser input never participates.
 */
function deriveIntent(row: DeploymentRow): IntentDerivation | HandoffNotice {
  const deployer = typeof row.deployer_address === "string" ? lower(row.deployer_address) : "";
  const recipient = typeof row.token_recipient === "string" ? lower(row.token_recipient) : "";
  const supplyText =
    typeof row.token_total_supply_text === "string" ? row.token_total_supply_text.trim() : "";
  const storedInitCodeHash = typeof row.init_code_hash === "string" ? lower(row.init_code_hash) : "";
  const storedFingerprint =
    typeof row.review_fingerprint === "string" ? lower(row.review_fingerprint) : "";
  const tokenName = typeof row.token_name === "string" ? row.token_name : "";
  const tokenSymbol = typeof row.token_symbol === "string" ? row.token_symbol : "";

  if (
    row.chain_id !== ROBINHOOD_MAINNET_CHAIN_ID ||
    row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT ||
    row.deployment_kind !== "FIXED_SUPPLY_ERC20" ||
    row.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID ||
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
    return "UNSUPPORTED_DEPLOYMENT";
  }

  const totalSupplyBaseUnits = BigInt(supplyText);
  if (totalSupplyBaseUnits <= 0n || totalSupplyBaseUnits % BASE_UNIT_SCALE !== 0n) {
    return "UNSUPPORTED_DEPLOYMENT";
  }
  const supplyWhole = totalSupplyBaseUnits / BASE_UNIT_SCALE;

  const initCode = buildInitCode({
    name: tokenName,
    symbol: tokenSymbol,
    totalSupply: totalSupplyBaseUnits,
    recipient,
  });
  const initCodeHash = lower(keccak256(initCode));
  if (initCodeHash !== storedInitCodeHash) return "INIT_CODE_HASH_MISMATCH";

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
  if (fingerprint !== storedFingerprint) return "INTENT_FINGERPRINT_MISMATCH";

  return { deployer, initCode, initCodeHash, fingerprint };
}

/** Every binding the C1 RPCs also enforce, checked before we ever reach them. */
function bindingMatches(
  authorization: AuthorizationRow,
  deployment: DeploymentRow,
  derived: IntentDerivation,
  operatorUserId: string,
): boolean {
  return (
    authorization.deployment_id === deployment.id &&
    authorization.workspace_id === deployment.workspace_id &&
    authorization.launch_id === deployment.launch_id &&
    authorization.chain_id === ROBINHOOD_MAINNET_CHAIN_ID &&
    authorization.network_environment === ROBINHOOD_MAINNET_ENVIRONMENT &&
    lower(authorization.deployer_address) === derived.deployer &&
    lower(authorization.review_fingerprint) === derived.fingerprint &&
    lower(authorization.init_code_hash) === derived.initCodeHash &&
    authorization.operator_user_id === operatorUserId
  );
}

function firstRow(value: unknown): AuthorizationRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as AuthorizationRow;
}

/* ------------------------------------------------------------------ */
/* A) CLAIM + wallet envelope                                          */
/* ------------------------------------------------------------------ */

type ClaimInput = { deploymentId: string; authorizationId: string };

function claimBase(deploymentId: string): MainnetHandoffClaimResult {
  return {
    ok: false,
    notice: null,
    deploymentId,
    authorizationId: null,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    expiresAt: null,
    feeModel: null,
    envelope: null,
  };
}

function claimFail(deploymentId: string, notice: HandoffNotice): MainnetHandoffClaimResult {
  return { ...claimBase(deploymentId), ok: false, notice };
}

export const claimMainnetDeploymentHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ClaimInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    if (typeof input.authorizationId !== "string" || !UUID.test(input.authorizationId)) {
      throw new Error("Invalid authorization id");
    }
    return { deploymentId: input.deploymentId, authorizationId: input.authorizationId };
  })
  .handler(async ({ data, context }): Promise<MainnetHandoffClaimResult> => {
    const { deploymentId, authorizationId } = data;

    // ---- GATE 1 (authoritative): no envelope may exist while sends are off. --
    // Placed before the RLS read, before the CLAIM RPC, and before any payload
    // reconstruction, so nothing claimable ever leaves this function.
    if (PRODUCTION_SEND_ENABLED !== true) {
      return claimFail(deploymentId, "PRODUCTION_TX_DISABLED");
    }

    // ---- Tenancy: RLS through the caller's own client is the first gate. ----
    const { data: rawDeployment, error: deploymentError } = await context.supabase
      .from("launch_chain_deployments")
      .select(DEPLOYMENT_COLUMNS)
      .eq("id", deploymentId)
      .maybeSingle();

    if (deploymentError || !rawDeployment) return claimFail(deploymentId, "NOT_AUTHORIZED");
    const deployment = rawDeployment as unknown as DeploymentRow;

    // A claim is only ever meaningful for an untouched DRAFT attempt.
    if (deployment.status !== "DRAFT" || deployment.tx_hash !== null) {
      return claimFail(deploymentId, "UNSUPPORTED_DEPLOYMENT");
    }

    const derived = deriveIntent(deployment);
    if (typeof derived === "string") return claimFail(deploymentId, derived);

    // ---- Authoritative authorization read (authenticated RPC). ----
    const { data: rawAuthorization, error: authorizationError } = await context.supabase.rpc(
      "get_launch_chain_production_presign_authorization",
      { _deployment_id: deploymentId },
    );
    if (authorizationError) return claimFail(deploymentId, "NOT_AUTHORIZED");

    const authorization = firstRow(rawAuthorization);
    if (!authorization) return claimFail(deploymentId, "PRESIGN_NOT_FOUND");
    if (authorization.id !== authorizationId) return claimFail(deploymentId, "PRESIGN_NOT_FOUND");

    if (!bindingMatches(authorization, deployment, derived, context.userId)) {
      return claimFail(deploymentId, "PRESIGN_BINDING_MISMATCH");
    }

    if (authorization.status !== "ISSUED") return claimFail(deploymentId, "PRESIGN_NOT_ISSUED");

    // ---- Freshness with a conservative wallet-review margin. ----
    const expiresAtMs = Date.parse(authorization.expires_at);
    if (!Number.isFinite(expiresAtMs)) return claimFail(deploymentId, "PRESIGN_NOT_ISSUED");
    if (expiresAtMs - Date.now() <= HANDOFF_MIN_REMAINING_MS) {
      return claimFail(deploymentId, "PRESIGN_TOO_CLOSE_TO_EXPIRY");
    }

    // ---- Economic evidence must be exactly what A2 stored, nothing derived. --
    const feeModel = authorization.fee_model === "LEGACY" ? "LEGACY" : "EIP1559";
    if (authorization.fee_model !== "LEGACY" && authorization.fee_model !== "EIP1559") {
      return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
    }
    if (
      !isCanonicalDecimal(authorization.gas_limit_text) ||
      !isCanonicalDecimal(authorization.max_fee_per_gas_wei_text) ||
      !isCanonicalDecimal(authorization.tx_value_wei) ||
      authorization.tx_value_wei.trim() !== "0"
    ) {
      return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
    }
    if (feeModel === "EIP1559" && !isCanonicalDecimal(authorization.max_priority_fee_per_gas_wei_text)) {
      return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
    }
    if (feeModel === "LEGACY" && authorization.max_priority_fee_per_gas_wei_text !== null) {
      return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
    }

    const gasHex = decimalToHexQuantity(authorization.gas_limit_text);
    const maxFeeHex = decimalToHexQuantity(authorization.max_fee_per_gas_wei_text);
    if (!gasHex || gasHex === "0x0" || !maxFeeHex) {
      return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
    }

    // ---- CLAIM through the AUTHENTICATED RPC, with SERVER-derived evidence. --
    // Service role is deliberately not used here: the claim must be performed
    // as the operator, under the same authorization rules the RPC enforces.
    const { data: rawClaimed, error: claimError } = await context.supabase.rpc(
      "claim_launch_chain_production_presign_authorization",
      {
        _authorization_id: authorizationId,
        _expected_review_fingerprint: derived.fingerprint,
        _expected_init_code_hash: derived.initCodeHash,
      },
    );
    // Raw DB error text is never surfaced — only the deterministic code.
    if (claimError) return claimFail(deploymentId, "CLAIM_FAILED");

    const claimed = firstRow(rawClaimed);
    if (!claimed || claimed.id !== authorizationId || claimed.status !== "CLAIMED") {
      return claimFail(deploymentId, "CLAIM_FAILED");
    }
    if (!bindingMatches(claimed, deployment, derived, context.userId)) {
      // Should be unreachable; if it ever happens we freeze rather than hand off.
      return claimFail(deploymentId, "PRESIGN_BINDING_MISMATCH");
    }

    // ---- Bounded envelope. No `to` member exists on either variant. ----
    const common = {
      from: derived.deployer,
      data: derived.initCode as string,
      value: "0x0" as const,
      gas: gasHex,
    };

    let envelope: MainnetWalletEnvelope;
    if (feeModel === "EIP1559") {
      const priorityHex = decimalToHexQuantity(claimed.max_priority_fee_per_gas_wei_text);
      if (!priorityHex) return claimFail(deploymentId, "INVALID_ECONOMIC_EVIDENCE");
      envelope = { ...common, maxFeePerGas: maxFeeHex, maxPriorityFeePerGas: priorityHex };
    } else {
      envelope = { ...common, gasPrice: maxFeeHex };
    }

    return {
      ok: true,
      notice: null,
      deploymentId,
      authorizationId,
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      expiresAt: claimed.expires_at,
      feeModel,
      envelope,
    };
  });

/* ------------------------------------------------------------------ */
/* B) Persist a known transaction hash                                 */
/* ------------------------------------------------------------------ */

type PersistInput = { deploymentId: string; authorizationId: string; txHash: string };

function persistBase(
  deploymentId: string,
  authorizationId: string,
): MainnetHandoffPersistResult {
  return {
    ok: false,
    notice: null,
    deploymentId,
    authorizationId,
    txHash: null,
    deploymentStatus: null,
    authorizationStatus: null,
    recoveredExisting: false,
  };
}

function persistFail(
  deploymentId: string,
  authorizationId: string,
  notice: HandoffNotice,
): MainnetHandoffPersistResult {
  return { ...persistBase(deploymentId, authorizationId), ok: false, notice };
}

/**
 * NOT gated on `MAINNET_DEPLOYMENT_TX_ENABLED`. The switch must stop NEW sends;
 * it must never strand a hash that is already known. Recording the SAME hash on
 * the SAME attempt stays available unconditionally.
 */
export const persistMainnetDeploymentTxHash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PersistInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    if (typeof input.authorizationId !== "string" || !UUID.test(input.authorizationId)) {
      throw new Error("Invalid authorization id");
    }
    if (typeof input.txHash !== "string") {
      throw new Error("Invalid transaction hash");
    }
    return {
      deploymentId: input.deploymentId,
      authorizationId: input.authorizationId,
      txHash: input.txHash,
    };
  })
  .handler(async ({ data, context }): Promise<MainnetHandoffPersistResult> => {
    const { deploymentId, authorizationId } = data;

    const txHash = lower(data.txHash);
    if (!HASH32.test(txHash)) return persistFail(deploymentId, authorizationId, "INVALID_TX_HASH");

    // ---- Tenancy first, through the caller's own RLS-bound client. ----
    const { data: rawDeployment, error: deploymentError } = await context.supabase
      .from("launch_chain_deployments")
      .select(DEPLOYMENT_COLUMNS)
      .eq("id", deploymentId)
      .maybeSingle();

    if (deploymentError || !rawDeployment) {
      return persistFail(deploymentId, authorizationId, "NOT_AUTHORIZED");
    }
    const deployment = rawDeployment as unknown as DeploymentRow;

    const derived = deriveIntent(deployment);
    if (typeof derived === "string") return persistFail(deploymentId, authorizationId, derived);

    const { data: rawAuthorization, error: authorizationError } = await context.supabase.rpc(
      "get_launch_chain_production_presign_authorization",
      { _deployment_id: deploymentId },
    );
    if (authorizationError) return persistFail(deploymentId, authorizationId, "NOT_AUTHORIZED");

    const authorization = firstRow(rawAuthorization);
    if (!authorization || authorization.id !== authorizationId) {
      return persistFail(deploymentId, authorizationId, "PRESIGN_NOT_FOUND");
    }
    if (!bindingMatches(authorization, deployment, derived, context.userId)) {
      return persistFail(deploymentId, authorizationId, "PRESIGN_BINDING_MISMATCH");
    }

    const storedHash =
      typeof deployment.tx_hash === "string" ? lower(deployment.tx_hash) : null;
    const consumedHash =
      typeof authorization.consumed_tx_hash === "string"
        ? lower(authorization.consumed_tx_hash)
        : null;

    // ---- Exactly two acceptable shapes. Everything else is a conflict. ----
    const normalPath =
      deployment.status === "DRAFT" &&
      storedHash === null &&
      authorization.status === "CLAIMED" &&
      authorization.claimed_at !== null &&
      authorization.consumed_at === null &&
      consumedHash === null;

    const lostResponsePath =
      deployment.status === "SUBMITTED" &&
      storedHash === txHash &&
      authorization.status === "CONSUMED" &&
      consumedHash === txHash;

    if (!normalPath && !lostResponsePath) {
      // A different known hash, or any other state, freezes for reconciliation.
      // Never a rebroadcast, never a cancellation.
      return persistFail(deploymentId, authorizationId, "PERSIST_CONFLICT");
    }

    // ---- Only now, after every caller/tenant/binding check, go privileged. ---
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rawSubmitted, error: submitError } = await supabaseAdmin.rpc(
      "submit_launch_chain_production_deployment_tx",
      {
        _deployment_id: deploymentId,
        _authorization_id: authorizationId,
        _operator_user_id: context.userId,
        _tx_hash: txHash,
      },
    );
    if (submitError) {
      // Raw DB error text is never surfaced. `42501`/`22023` from the RPC mean
      // the state was not eligible; both collapse to a conflict for the caller.
      const code = (submitError as { code?: string }).code;
      const notice: HandoffNotice =
        code === "42501" || code === "22023" ? "PERSIST_CONFLICT" : "PERSIST_FAILED";
      return persistFail(deploymentId, authorizationId, notice);
    }

    const submitted = (Array.isArray(rawSubmitted) ? rawSubmitted[0] : rawSubmitted) as
      | { status?: string; tx_hash?: string }
      | null
      | undefined;
    if (!submitted || lower(String(submitted.tx_hash ?? "")) !== txHash) {
      return persistFail(deploymentId, authorizationId, "PERSIST_FAILED");
    }

    return {
      ok: true,
      notice: null,
      deploymentId,
      authorizationId,
      txHash,
      deploymentStatus: submitted.status ?? null,
      authorizationStatus: "CONSUMED",
      recoveredExisting: lostResponsePath,
    };
  });
