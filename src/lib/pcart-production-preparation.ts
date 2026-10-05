/**
 * PCART P3 — client reads/cancel for the wallet-ready preparation authorization.
 * No wallet, provider, signature or transaction logic.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PcartPreparationAuthorization } from "@/lib/pcart-production-preparation.functions";

export const PCART_PREPARATION_MAX_TTL_MS = 90_000;
export const pcartPreparationQueryKey = (deploymentId: string) => ["pcart-production-preparation", deploymentId] as const;

/** Ready evidence only while not cancelled, not expired, and within the 90s cap. */
export function isPcartPreparationActive(a: Pick<PcartPreparationAuthorization, "issued_at" | "expires_at" | "cancelled_at"> | null | undefined, nowMs: number): boolean {
  if (!a || a.cancelled_at) return false;
  const issued = Date.parse(a.issued_at);
  const expires = Date.parse(a.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return false;
  if (expires - issued > PCART_PREPARATION_MAX_TTL_MS || expires <= issued) return false;
  return nowMs < expires;
}

export async function fetchLatestPcartPreparation(deploymentId: string): Promise<PcartPreparationAuthorization | null> {
  const { data, error } = await supabase
    .from("pcart_production_preparation_authorizations")
    .select("id, deployment_id, wallet_account, predicted_contract_address, issued_at, expires_at, cancelled_at")
    .eq("deployment_id", deploymentId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as PcartPreparationAuthorization | null) ?? null;
}

/** Cancels the authorization only. The production DRAFT is never touched. */
export async function cancelPcartPreparation(authorizationId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_canonical_pcart_production_presign_authorization", {
    _authorization_id: authorizationId,
  });
  if (error) throw new Error("Could not cancel the wallet preparation.");
}
