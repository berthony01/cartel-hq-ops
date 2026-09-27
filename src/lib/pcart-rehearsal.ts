/**
 * PCART-L3 — exact-artifact TESTNET rehearsal client helpers.
 *
 * Only the canonical pepecartel-launch PROJECT may use this path, and only on
 * Robinhood Chain Testnet 46630. The RPC
 * `create_launch_chain_pcart_rehearsal_attempt` (applied in migration
 * 20260927141715) is the authority; if it is ever missing or drifted this
 * helper fails closed with PcartRehearsalUnavailableError and nothing is
 * broadcast.
 *
 * Never writes official_contract_address, lifecycle status, notifications or
 * liquidity state.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeploymentRow } from "./chain-launcher";
import { PCART_FIXED_INTENT, normalizePcartRehearsalRecipient } from "./launch-artifact-registry";

export const PCART_REHEARSAL_RPC = "create_launch_chain_pcart_rehearsal_attempt" as const;

export class PcartRehearsalUnavailableError extends Error {
  constructor() {
    super(
      "The PCART rehearsal path is not enabled on the database yet. Nothing was created or broadcast.",
    );
    this.name = "PcartRehearsalUnavailableError";
  }
}

/** Missing-function signals from PostgREST / Postgres. */
export function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

export async function createPcartRehearsalAttempt(input: {
  launchId: string;
  clientRequestId: string;
  deployerAddress: string;
  rehearsalRecipient: string;
}): Promise<DeploymentRow> {
  const recipient = normalizePcartRehearsalRecipient(input.rehearsalRecipient);
  const deployer = input.deployerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(deployer)) throw new Error("Invalid deployer address.");
  const { data, error } = await supabase.rpc(PCART_REHEARSAL_RPC, {
    _launch_id: input.launchId,
    _client_request_id: input.clientRequestId,
    _deployer_address: deployer,
    _rehearsal_recipient: recipient,
  });
  if (isMissingRpcError(error)) throw new PcartRehearsalUnavailableError();
  if (error) throw new Error(error.message || "Could not start the PCART rehearsal attempt.");
  const row = (Array.isArray(data) ? data[0] : data) as unknown as DeploymentRow | null;
  if (!isExactPcartRehearsalRow(row, recipient)) {
    throw new Error("The rehearsal attempt returned by the server does not match the PCART intent.");
  }
  return row as DeploymentRow;
}

/** Validates every frozen field of a freshly created PCART rehearsal row. */
export function isExactPcartRehearsalRow(
  row: DeploymentRow | null | undefined,
  recipient: string,
): boolean {
  if (!row) return false;
  let supply: bigint;
  try {
    supply = BigInt(String(row.token_total_supply ?? ""));
  } catch {
    return false;
  }
  return (
    row.artifact_id === PCART_FIXED_INTENT.artifactId &&
    row.deployment_kind === "FIXED_SUPPLY_ERC20" &&
    Number(row.chain_id) === 46630 &&
    row.network_environment === "TESTNET" &&
    row.token_name === PCART_FIXED_INTENT.name &&
    row.token_symbol === PCART_FIXED_INTENT.symbol &&
    Number(row.token_decimals) === PCART_FIXED_INTENT.decimals &&
    supply === PCART_FIXED_INTENT.totalSupply &&
    row.token_recipient === recipient &&
    row.status === "DRAFT"
  );
}

/** True for PCART rehearsal evidence rows (used to scope the evidence panel). */
export function isPcartRehearsalRow(row: Pick<DeploymentRow, "artifact_id">): boolean {
  return row.artifact_id === PCART_FIXED_INTENT.artifactId;
}
