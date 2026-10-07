/**
 * PCART P9.2 — server-only live re-attestation for the bound send permit.
 * Reuses the P9.1 read-only readers (no signer, no transaction, RPC URL stays server-side) and
 * returns deterministic fingerprints, or a fail-closed reason when any fact is unavailable/mismatched.
 */
import { readP9Live } from "@/lib/pcart-launch-coordinator-p9-readers.server";
import { interpretChain, interpretDependencies, interpretSafe } from "@/lib/pcart-launch-coordinator-p9-live";
import { dependencyAttestationFingerprint, safeAttestationFingerprint } from "@/lib/pcart-p9-2-permit-binding";

export type P9_2Attestation =
  | { ok: true; dependencyFingerprint: string; safeFingerprint: string; safeNonce: number }
  | { ok: false; reason: "CHAIN_NOT_LIVE" | "DEPENDENCIES_NOT_VERIFIED" | "SAFE_NOT_READY" | "SIGNERS_UNAVAILABLE" };

export async function attestP9_2Live(launchId: string): Promise<P9_2Attestation> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: s } = await supabaseAdmin.from("launch_treasury_signer_configs").select("safe_address, signer_1, signer_2, signer_3").eq("launch_id", launchId).maybeSingle();
  if (!s) return { ok: false, reason: "SIGNERS_UNAVAILABLE" };
  const live = await readP9Live(null, null);
  if (interpretChain(live.chain).status !== "LIVE") return { ok: false, reason: "CHAIN_NOT_LIVE" };
  if (interpretDependencies(live.deps).status !== "VERIFIED") return { ok: false, reason: "DEPENDENCIES_NOT_VERIFIED" };
  const dependencyFingerprint = dependencyAttestationFingerprint(live.deps);
  if (!dependencyFingerprint) return { ok: false, reason: "DEPENDENCIES_NOT_VERIFIED" };
  const safe = interpretSafe(live.safe, s.safe_address, [s.signer_1, s.signer_2, s.signer_3].map(String));
  const safeFingerprint = safeAttestationFingerprint(safe);
  if (!safeFingerprint || safe.nonce === null) return { ok: false, reason: "SAFE_NOT_READY" };
  return { ok: true, dependencyFingerprint, safeFingerprint, safeNonce: safe.nonce };
}
