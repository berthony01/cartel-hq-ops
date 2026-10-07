/**
 * PCART P8B — owner-only read-only attestation + rehearsal review record.
 * Chain access: eth_getCode, eth_blockNumber and Safe view calls only. No signer, no wallet,
 * no Safe proposal, no transaction. The review RPC records a review row and nothing else.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http, keccak256, parseAbi } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import {
  P8B_CODE_HASH_ATTESTATIONS,
  P8B_MANIFEST_FINGERPRINT,
  P8B_REAL_TREASURY_SAFE,
  P8B_REFUND_FINGERPRINT,
  P8B_RELEASE_SCHEDULE_FINGERPRINT,
  P8B_SOURCE_ATTESTATION_FINGERPRINT,
  P8B_SUCCESS_FINGERPRINT,
  P8B_TRANSACTION_SEQUENCE,
  p8bCanonicalJson,
} from "@/lib/pcart-auction-execution-p8b";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const SAFE_ABI = parseAbi(["function VERSION() view returns (string)", "function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])", "function nonce() view returns (uint256)"]);
type Ctx = { supabase: any; userId: string };

export type P8bLiveAttestation = {
  codeHashes: { key: string; expected: string; observed: string | null; match: boolean }[];
  codeHashesOk: boolean;
  safe: { version: string | null; threshold: number | null; owners: string[]; nonce: number | null };
  safeOk: boolean;
  block: string | null;
  checkedAt: string;
};

async function attestLive(): Promise<P8bLiveAttestation> {
  const url = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim() || PUBLIC_MAINNET_RPC;
  const c = createPublicClient({ transport: http(url, { timeout: 15_000 }) });
  const codeHashes = await Promise.all(P8B_CODE_HASH_ATTESTATIONS.map(async (a) => {
    let observed: string | null = null;
    try { const code = await c.getCode({ address: a.address as `0x${string}` }); observed = code && code !== "0x" ? keccak256(code) : null; } catch { observed = null; }
    return { key: a.key, expected: a.codeHash, observed, match: observed?.toLowerCase() === a.codeHash.toLowerCase() };
  }));
  const safe = { version: null as string | null, threshold: null as number | null, owners: [] as string[], nonce: null as number | null };
  let block: string | null = null;
  try {
    const addr = P8B_REAL_TREASURY_SAFE.address as `0x${string}`;
    const [v, t, o, n, b] = await Promise.all([
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "VERSION" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "getThreshold" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "getOwners" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "nonce" }),
      c.getBlockNumber(),
    ]);
    safe.version = String(v); safe.threshold = Number(t); safe.owners = (o as string[]).map(String); safe.nonce = Number(n); block = b.toString();
  } catch { /* stays null → safeOk false */ }
  const want = P8B_REAL_TREASURY_SAFE.owners.map((x) => x.toLowerCase());
  const safeOk = safe.version === "1.4.1" && safe.threshold === 2 && safe.owners.length === 3 && want.every((w) => safe.owners.map((x) => x.toLowerCase()).includes(w));
  return { codeHashes, codeHashesOk: codeHashes.every((h) => h.match), safe, safeOk, block, checkedAt: new Date().toISOString() };
}

async function isOwner(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
  return data === true;
}
const validate = (i: { launchId: string }) => {
  if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
  return { launchId: i.launchId.toLowerCase() };
};
const jsonSafe = (v: unknown) => JSON.parse(p8bCanonicalJson(v));

export const getPcartP8bStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const live = await attestLive();
    const [{ data: p8a }, { data: p8b }] = await Promise.all([
      ctx.supabase.from("pcart_auction_liquidity_plan_reviews").select("id, manifest_version, manifest_fingerprint, reviewed_at, expires_at")
        .eq("launch_id", data.launchId).order("reviewed_at", { ascending: false }).limit(1).maybeSingle(),
      ctx.supabase.from("pcart_auction_execution_rehearsal_reviews").select("id, manifest_version, manifest_fingerprint, reviewed_at, expires_at")
        .eq("launch_id", data.launchId).order("reviewed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { ok: true as const, live: jsonSafe(live) as P8bLiveAttestation, manifestFingerprint: P8B_MANIFEST_FINGERPRINT, latestP8a: p8a ?? null, latestP8b: p8b ?? null };
  });

export const reviewPcartP8bRehearsal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    // Server re-attests read-only; never trusts browser-supplied evidence.
    const live = await attestLive();
    if (!live.codeHashesOk) return { ok: false as const, reason: "CODE_HASH_MISMATCH" };
    if (!live.safeOk) return { ok: false as const, reason: "SAFE_ATTESTATION_FAILED" };
    const { data: id, error } = await ctx.supabase.rpc("review_canonical_pcart_p8b_rehearsal", {
      _launch_id: data.launchId,
      _manifest_fingerprint: P8B_MANIFEST_FINGERPRINT,
      _source_attestation_fingerprint: P8B_SOURCE_ATTESTATION_FINGERPRINT,
      _success_fingerprint: P8B_SUCCESS_FINGERPRINT,
      _refund_fingerprint: P8B_REFUND_FINGERPRINT,
      _release_schedule_fingerprint: P8B_RELEASE_SCHEDULE_FINGERPRINT,
      _transaction_sequence: jsonSafe(P8B_TRANSACTION_SEQUENCE),
      _live_attestation: jsonSafe(live),
    });
    if (error) return { ok: false as const, reason: String(error.message ?? "REVIEW_FAILED") };
    return { ok: true as const, reviewId: String(id) };
  });
