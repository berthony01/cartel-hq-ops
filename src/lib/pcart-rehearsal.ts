/**
 * PCART-L3 — exact-artifact TESTNET rehearsal client helpers.
 *
 * Only the canonical pepecartel-launch PROJECT may use this path, and only on
 * Robinhood Chain Testnet 46630. The staged RPC
 * `create_launch_chain_pcart_rehearsal_attempt` is the authority; while it is
 * not applied to the database this helper fails closed with
 * PcartRehearsalUnavailableError and nothing is broadcast.
 *
 * Never writes official_contract_address, lifecycle status, notifications or
 * liquidity state.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeploymentRow } from "./chain-launcher";
import { normalizePcartRehearsalRecipient } from "./launch-artifact-registry";

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

type RpcCaller = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

export async function createPcartRehearsalAttempt(input: {
  launchId: string;
  clientRequestId: string;
  deployerAddress: string;
  rehearsalRecipient: string;
}): Promise<DeploymentRow> {
  const recipient = normalizePcartRehearsalRecipient(input.rehearsalRecipient);
  const deployer = input.deployerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(deployer)) throw new Error("Invalid deployer address.");
  // The RPC is staged, not yet in generated types; call through a narrow cast.
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;
  const { data, error } = await rpc(PCART_REHEARSAL_RPC, {
    _launch_id: input.launchId,
    _client_request_id: input.clientRequestId,
    _deployer_address: deployer,
    _rehearsal_recipient: recipient,
  });
  if (isMissingRpcError(error)) throw new PcartRehearsalUnavailableError();
  if (error) throw new Error(error.message || "Could not start the PCART rehearsal attempt.");
  const row = data as DeploymentRow | null;
  if (
    !row ||
    row.artifact_id !== "pepecartel-token-v1" ||
    Number(row.chain_id) !== 46630 ||
    row.network_environment !== "TESTNET" ||
    row.token_recipient !== recipient
  ) {
    throw new Error("The rehearsal attempt returned by the server does not match the PCART intent.");
  }
  return row;
}
