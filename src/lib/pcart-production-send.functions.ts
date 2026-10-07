/**
 * PCART P5 — owner-only claim + recovery server functions.
 *
 * claim: fresh read-only managed-RPC revalidation (reused from P3) then the
 * owner-only DB claim, which is window/lifecycle gated and consumes the P4
 * permit atomically. recovery: managed-RPC nonce/code evidence; may attach a
 * PROVEN matching transaction hash or release a claim only when chain evidence
 * proves nothing was sent. No signing, broadcast, verification write,
 * registration or execution-control change exists here.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http, keccak256 } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mainnetChain } from "@/lib/chain-mainnet-verify-shape";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { normalizeAddress } from "@/lib/pcart-production-intent";
import { revalidate } from "@/lib/pcart-production-preparation.functions";
import { attestP9_2Live } from "@/lib/pcart-p9-2-attestation.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounded history scan for the nonce transition (managed RPC must serve historical nonce reads). */
export const PCART_RECOVERY_SCAN_BLOCKS = 3_000_000n;
type Ctx = { supabase: any; userId: string };

export type PcartClaimResult = { ok: true; claimId: string } | { ok: false; reason: string };
export type PcartRecoveryResult =
  | { ok: true; state: "ATTACHED" | "ALREADY_RECORDED"; txHash: string }
  | { ok: true; state: "RELEASED" | "CLEAN_NOT_RELEASED" | "POSSIBLE_BROADCAST" }
  | { ok: false; reason: string };

function claimReason(msg: string): string {
  if (/launch window/i.test(msg)) return "OUTSIDE_WINDOW";
  if (/LAUNCH_APPROACHING/i.test(msg)) return "WRONG_LIFECYCLE";
  if (/expired|used or cancelled|mismatched; run/i.test(msg)) return "PERMIT_NOT_ACTIVE";
  if (/already/i.test(msg)) return "ALREADY_CLAIMED";
  if (/locked/i.test(msg)) return "EXECUTION_NOT_LOCKED";
  return "CLAIM_REFUSED";
}

export const claimPcartMainnetSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { deploymentId: string; permitId: string; wallet: string }) => {
    if (!i || !UUID.test(String(i.deploymentId)) || !UUID.test(String(i.permitId))) throw new Error("Invalid input");
    const wallet = normalizeAddress(i.wallet);
    if (!wallet) throw new Error("Invalid wallet");
    return { deploymentId: i.deploymentId.toLowerCase(), permitId: i.permitId.toLowerCase(), wallet };
  })
  .handler(async ({ data, context }): Promise<PcartClaimResult> => {
    const ctx = context as Ctx;
    const base = await revalidate(ctx, data.deploymentId, data.wallet);
    if (!base.ok) return base;
    // P9.2: re-read live dependencies/Safe immediately before the claim; the DB requires both
    // fingerprints to equal the values bound into the permit. Mismatch cancels the permit (no regeneration).
    const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
    if (isOwner !== true) return { ok: false, reason: "NOT_PLATFORM_OWNER" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dep } = await supabaseAdmin.from("launch_chain_deployments").select("launch_id").eq("id", data.deploymentId).maybeSingle();
    if (!dep) return { ok: false, reason: "DRAFT_NOT_FOUND" };
    const att = await attestP9_2Live(String(dep.launch_id));
    if (!att.ok) {
      await ctx.supabase.rpc("cancel_canonical_pcart_execution_permit", { _permit_id: data.permitId });
      return { ok: false, reason: `LIVE_ATTESTATION_${att.reason}` };
    }
    const { data: row, error } = await (supabaseAdmin as any).rpc("claim_canonical_pcart_mainnet_send_v2", {
      _actor: ctx.userId,
      _permit_id: data.permitId,
      _dependency_attestation_fingerprint: att.dependencyFingerprint,
      _safe_attestation_fingerprint: att.safeFingerprint,
    });
    if (error || !row) {
      const msg = String(error?.message ?? "");
      if (/P9\.2 binding/.test(msg)) {
        await ctx.supabase.rpc("cancel_canonical_pcart_execution_permit", { _permit_id: data.permitId });
        return { ok: false, reason: "BOUND_PERMIT_STALE" };
      }
      return { ok: false, reason: claimReason(msg) };
    }
    if (String(row.deployment_id) !== data.deploymentId || row.wallet_account !== data.wallet) return { ok: false, reason: "CLAIM_MISMATCH" };
    return { ok: true, claimId: String(row.id) };
  });

export const recoverPcartMainnetSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { claimId: string; mode: "CHECK" | "RELEASE_REJECTED" | "RELEASE_AMBIGUOUS" }) => {
    if (!i || !UUID.test(String(i.claimId))) throw new Error("Invalid claim");
    if (!["CHECK", "RELEASE_REJECTED", "RELEASE_AMBIGUOUS"].includes(i.mode)) throw new Error("Invalid mode");
    return { claimId: i.claimId.toLowerCase(), mode: i.mode };
  })
  .handler(async ({ data, context }): Promise<PcartRecoveryResult> => {
    const ctx = context as Ctx;
    const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
    if (isOwner !== true) return { ok: false, reason: "NOT_PLATFORM_OWNER" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("pcart_production_send_claims").select("*").eq("id", data.claimId).maybeSingle();
    if (!c) return { ok: false, reason: "CLAIM_NOT_FOUND" };
    if (c.claim_status === "BROADCAST" && c.tx_hash) return { ok: true, state: "ALREADY_RECORDED", txHash: c.tx_hash };
    if (c.claim_status === "RELEASED") return { ok: true, state: "RELEASED" };
    const { data: d } = await supabaseAdmin.from("launch_chain_deployments").select("id, init_code_hash, tx_hash").eq("id", c.deployment_id).maybeSingle();
    if (!d) return { ok: false, reason: "DRAFT_NOT_FOUND" };

    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) return { ok: false, reason: "MANAGED_RPC_UNCONFIGURED" };
    const client = createPublicClient({ chain: mainnetChain(endpoint), transport: http(endpoint) });
    const dep = c.wallet_account as `0x${string}`;
    const saved = BigInt(c.deployer_nonce);
    try {
      if ((await client.getChainId()) !== 4663) return { ok: false, reason: "CHAIN_MISMATCH" };
      const [latest, pending, code] = await Promise.all([
        client.getTransactionCount({ address: dep, blockTag: "latest" }),
        client.getTransactionCount({ address: dep, blockTag: "pending" }),
        client.getCode({ address: c.predicted_contract_address as `0x${string}` }),
      ]);
      const hasCode = !!code && code !== "0x";

      if (BigInt(latest) > saved) {
        // Find the block where the deployer's nonce moved past the saved nonce, then the exact tx.
        const head = await client.getBlockNumber();
        let lo = head > PCART_RECOVERY_SCAN_BLOCKS ? head - PCART_RECOVERY_SCAN_BLOCKS : 0n;
        let hi = head;
        if (BigInt(await client.getTransactionCount({ address: dep, blockNumber: lo })) > saved) return { ok: true, state: "POSSIBLE_BROADCAST" };
        while (lo + 1n < hi) {
          const mid = (lo + hi) / 2n;
          if (BigInt(await client.getTransactionCount({ address: dep, blockNumber: mid })) > saved) hi = mid;
          else lo = mid;
        }
        const block = await client.getBlock({ blockNumber: hi, includeTransactions: true });
        const tx = block.transactions.find(
          (t) => typeof t !== "string" && t.from.toLowerCase() === dep && BigInt(t.nonce) === saved,
        );
        if (
          tx && typeof tx !== "string" && tx.to === null && tx.value === 0n &&
          keccak256(tx.input).toLowerCase() === String(d.init_code_hash).toLowerCase()
        ) {
          const { error } = await ctx.supabase.rpc("record_canonical_pcart_mainnet_tx_hash", { _claim_id: c.id, _tx_hash: tx.hash });
          if (error) return { ok: false, reason: "RECORD_FAILED" };
          return { ok: true, state: "ATTACHED", txHash: tx.hash.toLowerCase() };
        }
        // Nonce consumed by something else (or unprovable): never release.
        return { ok: true, state: "POSSIBLE_BROADCAST" };
      }
      if (BigInt(pending) !== saved || hasCode) return { ok: true, state: "POSSIBLE_BROADCAST" };

      // Clean evidence: latest == pending == saved and no code at the predicted address.
      await supabaseAdmin.rpc("note_canonical_pcart_send_recovery_check", { _claim_id: c.id, _operator_user_id: ctx.userId });
      if (data.mode === "CHECK") return { ok: true, state: "CLEAN_NOT_RELEASED" };
      const { error } = await supabaseAdmin.rpc("release_canonical_pcart_mainnet_send_claim", {
        _claim_id: c.id,
        _operator_user_id: ctx.userId,
        _mode: data.mode === "RELEASE_REJECTED" ? "USER_REJECTED" : "AMBIGUOUS_CLEARED",
      });
      if (error) return { ok: true, state: "CLEAN_NOT_RELEASED" };
      return { ok: true, state: "RELEASED" };
    } catch {
      return { ok: false, reason: "MANAGED_RPC_READ_FAILED" };
    }
  });
