import { check, isBlank, type EvidenceCheck } from "./launch-evidence-checks";

/**
 * Cartel Verified Launch — production managed-finality evaluation (Hardening B).
 *
 * READ ONLY BY CONSTRUCTION. Pure function of its input. No I/O, no Supabase
 * client, no RPC, no writes, no transaction building, no wallet access.
 *
 * For Robinhood Chain production official-contract registration, managed
 * FINALIZED evidence is the authoritative depth requirement. Observed
 * `confirmations` remains stored and displayed, but is DIAGNOSTIC only: a
 * legitimate finalized production deployment reporting 0–4 confirmations is
 * not rejected for depth alone.
 *
 * Every predicate here mirrors the server-side authority in
 * `public.assert_launch_contract_evidence`, which independently re-derives all
 * of them inside `register_verified_launch_contract`. This module only decides
 * what an owner is OFFERED; the database remains authoritative and fails
 * closed on its own.
 */

export const FINALITY_STATE_FINALIZED = "FINALIZED" as const;
export const FINALITY_PROVIDER_MANAGED = "MANAGED" as const;

export type ProductionFinalityInput = {
  block_number: number | null;
  finality_state: string | null;
  finalized_block_hash_confirmed: boolean | null;
  finality_provider_kind: string | null;
  finalized_at: string | null;
  finalized_block_number: number | null;
  finalized_head_block_number: number | null;
};

export type ProductionFinalityEvaluation = {
  /** True only when every managed-finality predicate passed. */
  finalityOk: boolean;
  checks: EvidenceCheck[];
  blockReasons: string[];
};

/**
 * Evaluates managed production finality evidence. Fails closed: any missing,
 * unmanaged, mismatched or behind-head value blocks registration.
 */
export function evaluateProductionFinality(
  row: ProductionFinalityInput,
): ProductionFinalityEvaluation {
  const checks: EvidenceCheck[] = [];
  const blockReasons: string[] = [];

  const stateOk = row.finality_state === FINALITY_STATE_FINALIZED;
  checks.push(
    check(
      "finality_state",
      "Managed finality is FINALIZED",
      stateOk ? "PASS" : "BLOCKED",
      stateOk
        ? "The production verifier recorded managed finality as FINALIZED."
        : `Recorded finality state is ${row.finality_state ?? "unknown"}, not FINALIZED.`,
    ),
  );
  if (!stateOk) blockReasons.push("Managed finality is not FINALIZED");

  const providerOk = row.finality_provider_kind === FINALITY_PROVIDER_MANAGED;
  checks.push(
    check(
      "finality_provider",
      "Finality recorded by the managed provider",
      providerOk ? "PASS" : "BLOCKED",
      providerOk
        ? "Finality evidence was recorded by the managed finality provider."
        : `Finality provider is ${row.finality_provider_kind ?? "unknown"}, not MANAGED.`,
    ),
  );
  if (!providerOk) blockReasons.push("Finality evidence was not recorded by a managed provider");

  const hashOk = row.finalized_block_hash_confirmed === true;
  checks.push(
    check(
      "finalized_block_hash",
      "Finalized block hash re-confirmed",
      hashOk ? "PASS" : "BLOCKED",
      hashOk
        ? "The finalized block hash was re-read and confirmed."
        : "No confirmed finalized block hash is recorded.",
    ),
  );
  if (!hashOk) blockReasons.push("Finalized block hash is not confirmed");

  const finalizedAtOk = !isBlank(row.finalized_at);
  checks.push(
    check(
      "finalized_at",
      "Finalization timestamp recorded",
      finalizedAtOk ? "PASS" : "BLOCKED",
      finalizedAtOk
        ? `Finalized at ${row.finalized_at}.`
        : "No finalization timestamp is recorded.",
    ),
  );
  if (!finalizedAtOk) blockReasons.push("No finalization timestamp is recorded");

  const blockNumberKnown = row.block_number != null;
  const finalizedBlockOk =
    blockNumberKnown &&
    row.finalized_block_number != null &&
    row.finalized_block_number === row.block_number;
  checks.push(
    check(
      "finalized_block_number",
      "Finalized block matches the deployment block",
      finalizedBlockOk ? "PASS" : "BLOCKED",
      !blockNumberKnown
        ? "No mined block number is recorded for this deployment."
        : finalizedBlockOk
          ? `Finalized block ${row.finalized_block_number} matches the recorded deployment block.`
          : `Finalized block ${row.finalized_block_number ?? "unknown"} does not match the recorded deployment block ${row.block_number}.`,
    ),
  );
  if (!finalizedBlockOk)
    blockReasons.push("Finalized block number does not match the recorded deployment block");

  const headOk =
    blockNumberKnown &&
    row.finalized_head_block_number != null &&
    row.finalized_head_block_number >= (row.block_number as number);
  checks.push(
    check(
      "finalized_head_block",
      "Finalized head is at or beyond the deployment block",
      headOk ? "PASS" : "BLOCKED",
      !blockNumberKnown
        ? "No mined block number is recorded for this deployment."
        : headOk
          ? `Finalized head block ${row.finalized_head_block_number} is at or beyond the deployment block.`
          : `Finalized head block ${row.finalized_head_block_number ?? "unknown"} is behind the recorded deployment block ${row.block_number}.`,
    ),
  );
  if (!headOk) blockReasons.push("Finalized head block is behind the recorded deployment block");

  return {
    finalityOk: stateOk && providerOk && hashOk && finalizedAtOk && finalizedBlockOk && headOk,
    checks,
    blockReasons,
  };
}
