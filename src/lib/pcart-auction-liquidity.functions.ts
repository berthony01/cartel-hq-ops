/**
 * PCART P8A — owner-only read-only attestation + plan review record.
 * Chain access is eth_getCode only (mainnet managed RPC, public fallback; testnet public RPC).
 * No signer, no wallet, no Safe proposal, no transaction.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http, keccak256 } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { ROBINHOOD_TESTNET_RPC_URL } from "@/lib/chain-registry";
import { attestationOk, classifyAttestation, selectRehearsalMode, type P8aAttestRow } from "@/lib/pcart-auction-liquidity-attest";
import {
  canonicalJson,
  P8A_MAINNET_DEPENDENCIES,
  P8A_MANIFEST_FINGERPRINT,
  P8A_MANIFEST_VERSION,
  runP8aSimulation,
  type P8aDependencyKey,
} from "@/lib/pcart-auction-liquidity-plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
type Ctx = { supabase: any; userId: string };

async function readHashes(url: string): Promise<Partial<Record<P8aDependencyKey, string | null | undefined>>> {
  const client = createPublicClient({ transport: http(url, { timeout: 15_000 }) });
  const out: Partial<Record<P8aDependencyKey, string | null | undefined>> = {};
  await Promise.all(P8A_MAINNET_DEPENDENCIES.map(async (d) => {
    try {
      const code = await client.getCode({ address: d.address });
      out[d.key] = code && code !== "0x" ? keccak256(code) : null;
    } catch { out[d.key] = undefined; }
  }));
  return out;
}

export type P8aAttestation = { mainnet: P8aAttestRow[]; testnet: P8aAttestRow[]; mainnetOk: boolean; rehearsalMode: "TESTNET" | "FORKED_MAINNET"; checkedAt: string };

async function attest(): Promise<P8aAttestation> {
  const mainnetUrl = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim() || PUBLIC_MAINNET_RPC;
  const [m, t] = await Promise.all([readHashes(mainnetUrl), readHashes(ROBINHOOD_TESTNET_RPC_URL)]);
  const mainnet = classifyAttestation(m);
  const testnet = classifyAttestation(t);
  return { mainnet, testnet, mainnetOk: attestationOk(mainnet), rehearsalMode: selectRehearsalMode(testnet), checkedAt: new Date().toISOString() };
}

const jsonSafe = (v: unknown) => JSON.parse(canonicalJson(v));

async function requireOwner(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
  return data === true;
}

export const getPcartP8aStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string }) => {
    if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
    return { launchId: i.launchId.toLowerCase() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await requireOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const a = await attest();
    const sim = runP8aSimulation(a.rehearsalMode, a.mainnetOk);
    const { data: latest } = await ctx.supabase
      .from("pcart_auction_liquidity_plan_reviews")
      .select("id, review_kind, manifest_fingerprint, rehearsal_mode, simulation_fingerprint, reviewed_at, expires_at")
      .eq("launch_id", data.launchId).order("reviewed_at", { ascending: false }).limit(1).maybeSingle();
    return { ok: true as const, attestation: a, simulation: jsonSafe(sim), manifestFingerprint: P8A_MANIFEST_FINGERPRINT, latestReview: latest ?? null };
  });

export const reviewPcartP8aPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string }) => {
    if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
    return { launchId: i.launchId.toLowerCase() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await requireOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    // Server re-attests and re-simulates; never trusts browser-supplied evidence.
    const a = await attest();
    if (!a.mainnetOk) return { ok: false as const, reason: "MAINNET_DEPENDENCY_NOT_MATCH" };
    const sim = runP8aSimulation(a.rehearsalMode, true);
    if (!sim.success.ok || !sim.failure.ok) return { ok: false as const, reason: "SIMULATION_FAILED" };
    const { data: id, error } = await ctx.supabase.rpc("record_pcart_auction_liquidity_plan_review", {
      _launch_id: data.launchId,
      _manifest_version: P8A_MANIFEST_VERSION,
      _manifest_fingerprint: P8A_MANIFEST_FINGERPRINT,
      _rehearsal_mode: a.rehearsalMode,
      _dependency_attestation: jsonSafe({ mainnet: a.mainnet, testnet: a.testnet, checkedAt: a.checkedAt }),
      _simulation_fingerprint: sim.fingerprint,
      _simulation_summary: jsonSafe({ success: sim.success, failure: sim.failure, mode: sim.mode }),
    });
    if (error) return { ok: false as const, reason: String(error.message ?? "REVIEW_FAILED") };
    return { ok: true as const, reviewId: String(id) };
  });
