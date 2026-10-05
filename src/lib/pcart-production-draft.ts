/**
 * PCART P2 — save / abandon the canonical production DRAFT.
 *
 * Both are owner-only database RPCs that independently re-verify readiness,
 * the pinned Treasury Safe recipient, signer membership, the exact init-code
 * hash, the review fingerprint and the locked execution control. Nothing here
 * touches a wallet, provider, signature or transaction.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeploymentRow } from "@/lib/chain-launcher";
import type { PcartProductionReview } from "@/lib/pcart-production-review.functions";

export const PCART_PRODUCTION_ABANDON_REASON_MIN = 4;

/** Active (unsent or in-flight) canonical PCART production row, if any. */
export function findPcartProductionAttempt(rows: readonly DeploymentRow[] | null | undefined): DeploymentRow | null {
  return (
    (rows ?? []).find(
      (r) =>
        r.network_environment === "PRODUCTION" &&
        r.chain_id === 4663 &&
        r.artifact_id === "pepecartel-token-v1" &&
        ["DRAFT", "SUBMITTED", "PENDING", "CONFIRMED"].includes(r.status),
    ) ?? null
  );
}

export function isUnsentPcartDraft(r: DeploymentRow | null | undefined): boolean {
  return !!r && r.status === "DRAFT" && !r.tx_hash && !r.submitted_at && !r.contract_address;
}

export async function savePcartProductionDraft(review: PcartProductionReview, clientRequestId: string): Promise<DeploymentRow> {
  const { data, error } = await supabase.rpc("create_canonical_pcart_production_draft", {
    _launch_id: review.launchId,
    _client_request_id: clientRequestId,
    _deployer_address: review.deployer,
    _deployer_nonce_before: Number(review.nonce),
    _init_code_hash: review.initCodeHash,
    _review_fingerprint: review.reviewFingerprint,
  });
  if (error || !data) throw new Error(mapPcartProductionDraftError(error));
  return data as unknown as DeploymentRow;
}

export async function abandonPcartProductionDraft(deploymentId: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < PCART_PRODUCTION_ABANDON_REASON_MIN) throw new Error("Enter a reason.");
  const { error } = await supabase.rpc("abandon_canonical_pcart_production_draft", {
    _deployment_id: deploymentId,
    _reason: trimmed,
  });
  if (error) throw new Error(error.message);
}
