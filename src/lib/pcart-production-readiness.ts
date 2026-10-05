/**
 * PCART final production readiness — read + owner approval only.
 *
 * Both calls are database RPCs that independently verify the caller and all
 * evidence server-side. Nothing here touches a wallet, provider, network or
 * transaction, and nothing creates a production deployment attempt.
 */
import { supabase } from "@/integrations/supabase/client";

export type PcartReadinessState = {
  canonical: boolean;
  is_platform_owner?: boolean;
  rehearsal_complete?: boolean;
  safe_configured?: boolean;
  safe_verified?: boolean;
  evidence_ok?: boolean;
  evidence_reason?: string | null;
  rehearsal_attempt_number?: number | null;
  rehearsal_tx_hash?: string | null;
  safe_address?: string | null;
  execution_locked?: boolean;
  approval?: {
    id: string;
    artifact_id: string;
    rehearsal_tx_hash: string;
    safe_address: string;
    approved_at: string;
    evidence_still_matches: boolean;
  } | null;
};

export const pcartReadinessQueryKey = (launchId: string) => ["pcart-production-readiness", launchId] as const;

export async function fetchPcartReadiness(launchId: string): Promise<PcartReadinessState> {
  const { data, error } = await supabase.rpc("get_canonical_pcart_production_readiness", { _launch_id: launchId });
  if (error) throw new Error("Could not load production readiness.");
  return data as unknown as PcartReadinessState;
}

export async function approvePcartReadiness(launchId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_canonical_pcart_production_readiness", { _launch_id: launchId });
  if (error) throw new Error("Approval was refused: readiness evidence is not satisfied or you are not the platform owner.");
}

/** Owner action is offered only when every precondition is authoritatively proven. */
export function canOfferApproval(s: PcartReadinessState | undefined | null): boolean {
  return !!s && s.canonical === true && s.is_platform_owner === true && s.rehearsal_complete === true &&
    s.safe_configured === true && s.safe_verified === true && s.evidence_ok === true &&
    s.execution_locked === true && !s.approval;
}
