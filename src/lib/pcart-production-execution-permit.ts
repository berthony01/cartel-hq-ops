/**
 * PCART P4 — client reads/cancel for the READY TO SEND permit.
 * No wallet, provider, signature or transaction logic.
 */
import { supabase } from "@/integrations/supabase/client";

export type PcartExecutionPermit = {
  id: string;
  deployment_id: string;
  preparation_authorization_id: string;
  wallet_account: string;
  predicted_contract_address: string;
  unsigned_tx_fingerprint: string;
  issued_at: string;
  expires_at: string;
  cancelled_at: string | null;
  consumed_at: string | null;
};

export const pcartExecutionPermitQueryKey = (deploymentId: string) => ["pcart-production-execution-permit", deploymentId] as const;

export async function fetchLatestPcartExecutionPermit(deploymentId: string): Promise<PcartExecutionPermit | null> {
  const { data, error } = await supabase
    .from("pcart_production_execution_permits")
    .select("id, deployment_id, preparation_authorization_id, wallet_account, predicted_contract_address, unsigned_tx_fingerprint, issued_at, expires_at, cancelled_at, consumed_at")
    .eq("deployment_id", deploymentId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as PcartExecutionPermit | null) ?? null;
}

/** Cancels the permit only. The production DRAFT is never touched. */
export async function cancelPcartExecutionPermit(permitId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_canonical_pcart_execution_permit", { _permit_id: permitId });
  if (error) throw new Error("Could not cancel the final send permit.");
}
