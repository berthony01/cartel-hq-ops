/**
 * P3C-E — PRODUCTION verifier state-write boundary (Robinhood Chain 4663).
 *
 * Extracted verbatim from `chain-mainnet-verify.functions.ts`; behavior and
 * call order are unchanged. This module owns the AUTHORITATIVE verifier
 * state-write gate and the two guarded service-role apply helpers.
 *
 * SCOPE OF THIS GATE
 * ------------------
 * `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` authorizes DATABASE evidence and
 * finality writes ONLY. It is entirely separate from, and grants nothing to,
 * the registry's `MAINNET_DEPLOYMENT_TX_ENABLED` / `MAINNET_LIQUIDITY_TX_ENABLED`
 * switches and the Supabase runtime execution control. No signer, wallet,
 * broadcast, presign/canary/send-window, registration or liquidity path exists
 * here or is reachable from here.
 *
 * INVOCATION-BOUND
 * ----------------
 * Importing this module performs zero I/O and zero writes. The service-role
 * client is imported dynamically, INSIDE each helper, and only after the gate
 * assertion passes. If the gate is ever set back to false every helper throws
 * `STATE_WRITES_DISABLED` before any admin import — fail closed by
 * construction.
 */

/**
 * AUTHORITATIVE verifier state-write gate. ACTIVATED at the P3C-E checkpoint.
 * Real-money transaction execution remains independently OFF.
 */
export const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = true as const;

/**
 * Widened runtime mirror of the gate. Its ONLY purpose is branch-safe
 * typechecking at the call sites; the authoritative literal above is the
 * single source of truth and every helper re-checks it at runtime before any
 * service-role import.
 */
export const STATE_WRITES_ENABLED: boolean = Boolean(
  MAINNET_VERIFICATION_STATE_WRITES_ENABLED as boolean,
);

/** Deterministic, sanitized code. Raw DB/provider error text never escapes. */
export const STATE_WRITE_FAILED_RETRYABLE = "STATE_WRITE_FAILED_RETRYABLE" as const;

/**
 * Exact upper bound of the PostgreSQL signed `integer` domain. The RPC column
 * `_observed_confirmations` is `integer`, NOT `bigint`, so a diagnostic
 * confirmation value is only convertible when it fits here. Anything outside
 * `[0, 2_147_483_647]` is omitted rather than sent.
 */
export const POSTGRES_INTEGER_MAX = 2_147_483_647n;

export function assertStateWritesEnabled(): void {
  if (!STATE_WRITES_ENABLED) {
    throw new Error("STATE_WRITES_DISABLED");
  }
}

/**
 * Fail-closed bigint -> DB integer conversion. A block height outside the
 * IEEE-754 safe-integer range would silently lose precision on the way to the
 * RPC, so it is refused deterministically before any service-role call.
 */
export function toSafeDbInteger(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`UNSAFE_DB_INTEGER:${field}`);
  }
  return Number(value);
}

export async function applyProductionDeploymentVerification(payload: {
  deploymentId: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  observedConfirmations?: number;
  contractAddress?: string;
  blockNumber?: bigint;
  blockHash?: string;
  failureCode?: string;
  failureDetail?: string;
  verifiedToken?: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
    recipientBalance: bigint;
  };
}): Promise<void> {
  // Refuse BEFORE importing the service-role client or touching the network.
  assertStateWritesEnabled();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const args = {
    _deployment_id: payload.deploymentId,
    _status: payload.status,
    ...(payload.observedConfirmations !== undefined
      ? { _observed_confirmations: payload.observedConfirmations }
      : {}),
    ...(payload.contractAddress ? { _contract_address: payload.contractAddress } : {}),
    ...(payload.blockNumber !== undefined
      ? { _block_number: toSafeDbInteger(payload.blockNumber, "block_number") }
      : {}),

    ...(payload.blockHash ? { _block_hash: payload.blockHash } : {}),
    ...(payload.failureCode ? { _failure_code: payload.failureCode } : {}),
    ...(payload.failureDetail ? { _failure_detail: payload.failureDetail } : {}),
    ...(payload.verifiedToken
      ? {
          _verified_token_name: payload.verifiedToken.name,
          _verified_token_symbol: payload.verifiedToken.symbol,
          _verified_token_decimals: payload.verifiedToken.decimals,
          // Exact decimal strings: base units exceed IEEE-754 safe integers.
          _verified_total_supply: payload.verifiedToken.totalSupply.toString(),
          _verified_recipient_balance: payload.verifiedToken.recipientBalance.toString(),
        }
      : {}),
  } as unknown as Parameters<
    typeof supabaseAdmin.rpc<"apply_launch_chain_production_token_deployment_verification">
  >[1];

  const { error } = await supabaseAdmin.rpc(
    "apply_launch_chain_production_token_deployment_verification",
    args,
  );
  if (error) throw new Error("Verification could not be recorded");
}

export async function applyProductionFinality(payload: {
  deploymentId: string;
  finalityState: "FINALITY_PENDING" | "FINALIZED" | "PROVIDER_INCONSISTENT";
  finalizedBlockNumber?: bigint;
  finalizedHeadBlockNumber?: bigint;
  finalizedBlockHashConfirmed?: boolean;
  finalityNotice?: string;
}): Promise<void> {
  // Refuse BEFORE importing the service-role client or touching the network.
  assertStateWritesEnabled();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("apply_launch_chain_production_finality", {
    _deployment_id: payload.deploymentId,
    _finality_state: payload.finalityState,
    // MANAGED is the only permitted finality authority.
    _finality_provider_kind: "MANAGED",
    ...(payload.finalizedBlockNumber !== undefined
      ? { _finalized_block_number: toSafeDbInteger(payload.finalizedBlockNumber, "finalized_block_number") }
      : {}),
    ...(payload.finalizedHeadBlockNumber !== undefined
      ? {
          _finalized_head_block_number: toSafeDbInteger(
            payload.finalizedHeadBlockNumber,
            "finalized_head_block_number",
          ),
        }
      : {}),
    ...(payload.finalizedBlockHashConfirmed !== undefined
      ? { _finalized_block_hash_confirmed: payload.finalizedBlockHashConfirmed }
      : {}),
    ...(payload.finalityNotice ? { _finality_notice: payload.finalityNotice } : {}),
  });
  if (error) throw new Error("Finality could not be recorded");
}
