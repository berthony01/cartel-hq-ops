/**
 * PCART P7 — owner-only official contract registration.
 *
 * Re-derives the deterministic CREATE address from the saved deployer + nonce
 * using the same trusted helper as P3/P5/P6, then calls the owner-only DB RPC
 * which independently enforces every invariant. No chain writes, no wallet,
 * no signing, no lifecycle beyond OFFICIAL_CONTRACT_REGISTERED, no notifications.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { predictPcartProductionAddress } from "@/lib/pcart-production-intent";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
type Ctx = { supabase: any; userId: string };

export type PcartRegisterResult = { ok: true; launchStatus: string; officialContractAddress: string } | { ok: false; reason: string };

export const registerCanonicalPcartOfficialContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string; deploymentId: string; expectedAddress: string }) => {
    if (!i || !UUID.test(String(i.launchId)) || !UUID.test(String(i.deploymentId))) throw new Error("Invalid ids");
    const a = String(i.expectedAddress ?? "").trim();
    if (!ADDR.test(a)) throw new Error("Invalid address");
    return { launchId: i.launchId.toLowerCase(), deploymentId: i.deploymentId.toLowerCase(), expectedAddress: a.toLowerCase() };
  })
  .handler(async ({ data, context }): Promise<PcartRegisterResult> => {
    const ctx = context as Ctx;
    const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
    if (isOwner !== true) return { ok: false, reason: "NOT_PLATFORM_OWNER" };
    const { data: d } = await ctx.supabase
      .from("launch_chain_deployments")
      .select("id, launch_id, status, finality_state, artifact_id, chain_id, network_environment, deployer_address, deployer_nonce_before, contract_address")
      .eq("id", data.deploymentId)
      .maybeSingle();
    if (!d || d.launch_id !== data.launchId) return { ok: false, reason: "DEPLOYMENT_NOT_FOUND" };
    if (d.artifact_id !== "pepecartel-token-v1" || d.chain_id !== 4663 || d.network_environment !== "PRODUCTION") return { ok: false, reason: "NOT_CANONICAL_PCART" };
    if (d.status !== "CONFIRMED" || d.finality_state !== "FINALIZED") return { ok: false, reason: "NOT_VERIFIED_AND_FINALIZED" };
    if (!d.contract_address || d.deployer_nonce_before === null || !d.deployer_address) return { ok: false, reason: "EVIDENCE_INCOMPLETE" };
    const derived = predictPcartProductionAddress(String(d.deployer_address), BigInt(d.deployer_nonce_before)).toLowerCase();
    if (derived !== String(d.contract_address).toLowerCase()) return { ok: false, reason: "CREATE_ADDRESS_MISMATCH" };
    if (data.expectedAddress !== derived) return { ok: false, reason: "CONFIRMATION_MISMATCH" };
    const { data: row, error } = await ctx.supabase.rpc("register_canonical_pcart_official_contract", {
      _launch_id: data.launchId,
      _deployment_id: data.deploymentId,
      _expected_contract_address: data.expectedAddress,
    });
    if (error) return { ok: false, reason: String(error.message ?? "REGISTRATION_REFUSED").slice(0, 300) };
    return { ok: true, launchStatus: String(row?.status), officialContractAddress: String(row?.official_contract_address) };
  });
