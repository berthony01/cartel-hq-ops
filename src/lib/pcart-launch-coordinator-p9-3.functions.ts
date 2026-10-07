/**
 * PCART P9.3A — owner-only auction-segment server functions.
 * Segment/preview: SELECT-only DB reads + read-only chain views. Prepare: full server re-attestation, then the
 * service-role-only `record_canonical_pcart_preauction_prepared` (creates a PREPARED record only).
 * No wallet, no signature, no Safe proposal, no transaction, no migrate, no sweep, no control/lifecycle change.
 * Client-supplied input is limited to launchId, the owner-confirmed start block, and a cancel reason.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { policyApproval } from "@/lib/pcart-launch-coordinator-p9";
import { P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import {
  auctionModel, auctionSteps, computeAuthoritativeBlocks, dependencyFingerprintP93, deriveAuctionSegment, effectiveActionStatus, ownersFingerprint,
  preparePreAuction, P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK, P9_3_PINNED_DEPENDENCY_FINGERPRINT, P9_3_SWEEP_DISPOSITION,
  type P93CurrentFacts, type P93PolicyRef, type P93StoredAction,
} from "@/lib/pcart-launch-coordinator-p9-3";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { supabase: any; userId: string };
const isOwner = async (ctx: Ctx) => (await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId })).data === true;
const launchInput = (i: { launchId: string }) => { if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch"); return { launchId: i.launchId.toLowerCase() }; };

const mapAction = (r: any): P93StoredAction => ({
  id: r.id, actionKind: r.action_kind, status: r.status, statusReason: r.status_reason ?? null,
  officialTokenAddress: r.official_token_address, officialTokenCodeHash: r.official_token_code_hash,
  p8aReviewId: r.p8a_review_id, p8aManifestFingerprint: r.p8a_manifest_fingerprint, p8bReviewId: r.p8b_review_id, p8bManifestFingerprint: r.p8b_manifest_fingerprint,
  dependencyAttestationFingerprint: r.dependency_attestation_fingerprint, safeOwnersFingerprint: r.safe_owners_fingerprint, safeThreshold: Number(r.safe_threshold), safeNonce: Number(r.safe_nonce),
  promotionStartAt: r.promotion_start_at, intendedAuctionStartAt: r.intended_auction_start_at,
  authoritativeStartBlock: r.authoritative_start_block?.toString() ?? null, endBlock: r.end_block?.toString() ?? null, safeTxHash: r.safe_tx_hash, preparedAt: r.prepared_at,
});

async function loadFacts(ctx: Ctx, launchId: string) {
  const sb = ctx.supabase;
  const [launch, dep, ctl, p8a, p8b, rev, plan, actions] = await Promise.all([
    sb.from("launches").select("id, status, official_contract_address").eq("id", launchId).maybeSingle(),
    sb.from("launch_chain_deployments").select("id, status, tx_hash, contract_address, finality_state").eq("launch_id", launchId).eq("network_environment", "PRODUCTION").order("attempt_number", { ascending: false }).limit(1).maybeSingle(),
    sb.from("launch_chain_production_execution_controls").select("execution_enabled, emergency_stop_engaged").eq("control_key", "ROBINHOOD_MAINNET_DEPLOYMENT").maybeSingle(),
    sb.from("pcart_auction_liquidity_plan_reviews").select("id, manifest_version, manifest_fingerprint, reviewed_at, expires_at").eq("launch_id", launchId),
    sb.from("pcart_auction_execution_rehearsal_reviews").select("id, manifest_version, manifest_fingerprint, overall_result, reviewed_at, expires_at").eq("launch_id", launchId),
    sb.from("pcart_policy_approval_revocations").select("review_id").eq("launch_id", launchId),
    sb.from("pcart_launch_day_plans").select("promotion_start_at, intended_auction_start_at").eq("launch_id", launchId).maybeSingle(),
    sb.from("pcart_launch_coordinator_actions").select("*").eq("launch_id", launchId).order("prepared_at", { ascending: false }).limit(20),
  ]);
  const claims = dep.data?.id ? await sb.from("pcart_production_send_claims").select("claim_status").eq("deployment_id", dep.data.id) : { data: [] };
  const map = (rows: any[] | null) => (rows ?? []).map((r) => ({ id: r.id, manifestVersion: r.manifest_version, manifestFingerprint: r.manifest_fingerprint, overallResult: r.overall_result ?? null, reviewedAt: r.reviewed_at, expiresAt: r.expires_at }));
  const revoked = (rev.data ?? []).map((r: any) => String(r.review_id));
  const a = policyApproval("P8A", map(p8a.data), revoked), b = policyApproval("P8B", map(p8b.data), revoked);
  const ref = (x: typeof a): P93PolicyRef => ({ status: x.status, reviewId: x.review?.id ?? null, manifestVersion: x.review?.manifestVersion ?? null, manifestFingerprint: x.review?.manifestFingerprint ?? null });
  const d = dep.data;
  const officialToken: string | null = launch.data?.official_contract_address ?? null;
  return {
    launchStatus: launch.data?.status ?? null, officialToken,
    officialRegistered: !!officialToken && !!d && d.status === "CONFIRMED" && d.finality_state === "FINALIZED" && String(d.contract_address ?? "").toLowerCase() === officialToken.toLowerCase(),
    deploymentFinalized: !!d && d.status === "CONFIRMED" && d.finality_state === "FINALIZED",
    control: ctl.data ? { executionEnabled: ctl.data.execution_enabled === true, emergencyStopEngaged: ctl.data.emergency_stop_engaged !== false } : null,
    p8a: ref(a), p8b: ref(b),
    plan: plan.data ? { promotionStartAt: plan.data.promotion_start_at as string | null, intendedAuctionStartAt: plan.data.intended_auction_start_at as string | null } : null,
    uncertain: (claims.data ?? []).some((c: any) => c.claim_status === "AMBIGUOUS" || c.claim_status === "CLAIMED") || (!!d && (d.status === "SUBMITTED" || d.status === "PENDING") && !d.tx_hash),
    actions: (actions.data ?? []).map(mapAction),
  };
}

/** Passive, read-only. Never writes, never prompts a wallet, never prepares. */
export const getPcartP9_3Segment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(launchInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const f = await loadFacts(ctx, data.launchId);
    const { readP9_3PrepareFacts } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const live = await readP9_3PrepareFacts(f.officialToken);
    const depFp = dependencyFingerprintP93(live.observed);
    const current: P93CurrentFacts = {
      officialTokenAddress: f.officialToken, tokenRuntimeKeccak: live.tokenRuntimeKeccak, p8a: f.p8a, p8b: f.p8b, dependencyFingerprint: depFp,
      safeOwnersFingerprint: live.safe ? ownersFingerprint(live.safe.owners) : null, safeThreshold: live.safe?.threshold ?? null, safeNonce: live.safe?.nonce ?? null, plan: f.plan,
    };
    const pre = f.actions.find((x) => x.actionKind === "PREAUCTION_SETUP" && x.status !== "CANCELLED") ?? null;
    const preEff = pre ? effectiveActionStatus(pre, current) : null;
    // No auction address exists until a confirmed pre-auction execution is reconciled (P9.3B) → NOT_CREATED.
    const auction = auctionModel({ auctionAddress: null, boundStartBlock: null, boundEndBlock: null, currentBlock: live.head ? live.head.block.toString() : null, obs: null });
    const segment = deriveAuctionSegment({
      nowMs: Date.now(), officialRegistered: f.officialRegistered && live.tokenRuntimeKeccak?.toLowerCase() === P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK.toLowerCase(),
      plan: f.plan, p8aCurrent: f.p8a.status === "CURRENT", p8bCurrent: f.p8b.status === "CURRENT",
      dependenciesVerified: depFp === P9_3_PINNED_DEPENDENCY_FINGERPRINT,
      safeReady: !!live.safe && live.safe.threshold === 2 && live.safe.version === "1.4.1",
      uncertainTransaction: f.uncertain, preAuction: preEff, preAuctionConfirmed: false, auction, migrationConfirmed: null, sweepAction: null, sweepConfirmed: false,
    });
    return {
      ok: true as const, segment, steps: auctionSteps(segment), auction, sweepDisposition: P9_3_SWEEP_DISPOSITION,
      preAuction: pre ? { id: pre.id, status: preEff!.status, staleReasons: preEff!.reasons, storedStatusReason: pre.statusReason, safeNonce: pre.safeNonce,
        startBlock: pre.authoritativeStartBlock, endBlock: pre.endBlock, safeTxHash: pre.safeTxHash, preparedAt: pre.preparedAt } : null,
      officialRegistered: f.officialRegistered, planSet: !!(f.plan?.promotionStartAt && f.plan?.intendedAuctionStartAt),
    };
  });

/** Read-only preview of exact authoritative blocks from a FRESH chain read, for explicit owner review. */
export const previewPcartPreAuction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(launchInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const f = await loadFacts(ctx, data.launchId);
    const { readP9_3PrepareFacts } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const live = await readP9_3PrepareFacts(f.officialToken);
    const r = computeAuthoritativeBlocks({ head: live.head, nowMs: Date.now(), promotionStartAt: f.plan?.promotionStartAt ?? null, intendedAuctionStartAt: f.plan?.intendedAuctionStartAt ?? null });
    if (!r.ok) return { ok: false as const, reason: r.reason };
    return { ok: true as const, startBlock: r.startBlock.toString(), endBlock: r.endBlock.toString(), headBlock: r.headBlock.toString(), headCapturedAt: new Date(r.headCapturedAtMs).toISOString() };
  });

/** Explicit owner action. Re-attests everything server-side, builds via the P8B builder, records PREPARED only. */
export const preparePcartPreAuction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string; confirmedStartBlock: string }) => {
    const l = launchInput(i);
    if (!/^\d{1,15}$/.test(String(i.confirmedStartBlock))) throw new Error("Invalid start block");
    return { ...l, confirmedStartBlock: String(i.confirmedStartBlock) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const f = await loadFacts(ctx, data.launchId);
    const { readP9_3PrepareFacts } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const live = await readP9_3PrepareFacts(f.officialToken);
    const r = preparePreAuction({
      nowMs: Date.now(), launchId: data.launchId, launchStatus: f.launchStatus, officialTokenAddress: f.officialToken, deploymentFinalized: f.deploymentFinalized,
      tokenRuntimeKeccak: live.tokenRuntimeKeccak, plan: f.plan, p8a: f.p8a, p8b: f.p8b, observedCodeHashes: live.observed,
      safe: live.safe ? { address: P8B_REAL_TREASURY_SAFE.address, version: live.safe.version, threshold: live.safe.threshold, owners: live.safe.owners, nonce: live.safe.nonce, codeHash: live.safe.codeHash } : null,
      control: f.control, head: live.head, uncertainTransaction: f.uncertain,
      existingOpenAction: f.actions.some((x) => x.actionKind === "PREAUCTION_SETUP" && x.status === "PREPARED"),
      ownerConfirmedStartBlock: data.confirmedStartBlock,
    });
    if (!r.ok) return { ok: false as const, reason: r.blocks.join(", ") };
    const b = r.binding;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await (supabaseAdmin as any).rpc("record_canonical_pcart_preauction_prepared", {
      _actor: ctx.userId,
      _b: {
        launch_id: b.launchId, binding_version: b.bindingVersion, chain_id: b.chainId, official_token_address: b.officialTokenAddress, official_token_code_hash: b.officialTokenCodeHash,
        p8a_review_id: b.p8aReviewId, p8a_manifest_version: b.p8aManifestVersion, p8a_manifest_fingerprint: b.p8aManifestFingerprint,
        p8b_review_id: b.p8bReviewId, p8b_manifest_version: b.p8bManifestVersion, p8b_manifest_fingerprint: b.p8bManifestFingerprint,
        dependency_attestation_fingerprint: b.dependencyAttestationFingerprint, safe_address: b.safeAddress, safe_owners_fingerprint: b.safeOwnersFingerprint,
        safe_threshold: b.safeThreshold, safe_nonce: b.safeNonce, promotion_start_at: b.promotionStartAt, intended_auction_start_at: b.intendedAuctionStartAt,
        authoritative_start_block: b.authoritativeStartBlock, end_block: b.endBlock, permit2_expiration: b.permit2Expiration,
        call_batch_fingerprint: b.callBatchFingerprint, safe_tx_target: b.safeTxTarget, safe_tx_operation: b.safeTxOperation, safe_tx_data_keccak: b.safeTxDataKeccak,
        safe_tx_hash: b.safeTxHash, binding_fingerprint: r.bindingFingerprint, chain_head_block: b.chainHeadBlock, chain_head_captured_at: b.chainHeadCapturedAt,
      },
    });
    if (error) return { ok: false as const, reason: String(error.message ?? "PREPARE_FAILED") };
    return { ok: true as const, actionId: String(id), safeTxHash: b.safeTxHash };
  });

export const cancelPcartCoordinatorAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { actionId: string; reason: string }) => {
    if (!i || !UUID.test(String(i.actionId))) throw new Error("Invalid action");
    const reason = String(i.reason ?? "").trim();
    if (reason.length < 3 || reason.length > 300) throw new Error("Reason required");
    return { actionId: i.actionId.toLowerCase(), reason };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const { error } = await ctx.supabase.rpc("cancel_canonical_pcart_coordinator_action", { _action_id: data.actionId, _reason: data.reason });
    if (error) return { ok: false as const, reason: String(error.message ?? "CANCEL_FAILED") };
    return { ok: true as const };
  });
