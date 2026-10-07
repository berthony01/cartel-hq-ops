/**
 * PCART P9.0 — owner-only read-only coordinator snapshot.
 * Reads only (SELECT). Never writes launches, deployments, controls, contracts, claims or notifications.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveCoordinatorState, milestones, planStatus, policyApproval, type P9Snapshot } from "@/lib/pcart-launch-coordinator-p9";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { supabase: any; userId: string };

export const getPcartP9CoordinatorSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string }) => {
    if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
    return { launchId: i.launchId.toLowerCase() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const { data: owner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
    if (owner !== true) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const sb = ctx.supabase;
    const [launch, dep, ctl, p8a, p8b, rev, plan, events] = await Promise.all([
      sb.from("launches").select("id, status, official_contract_address").eq("id", data.launchId).maybeSingle(),
      sb.from("launch_chain_deployments").select("id, attempt_number, status, tx_hash, contract_address, finality_state, submitted_at")
        .eq("launch_id", data.launchId).eq("network_environment", "PRODUCTION").order("attempt_number", { ascending: false }).limit(1).maybeSingle(),
      sb.from("launch_chain_production_execution_controls").select("execution_enabled, emergency_stop_engaged").eq("control_key", "ROBINHOOD_MAINNET_DEPLOYMENT").maybeSingle(),
      sb.from("pcart_auction_liquidity_plan_reviews").select("id, manifest_version, manifest_fingerprint, reviewed_at, expires_at").eq("launch_id", data.launchId),
      sb.from("pcart_auction_execution_rehearsal_reviews").select("id, manifest_version, manifest_fingerprint, overall_result, reviewed_at, expires_at").eq("launch_id", data.launchId),
      sb.from("pcart_policy_approval_revocations").select("review_id").eq("launch_id", data.launchId),
      sb.from("pcart_launch_day_plans").select("promotion_start_at, intended_auction_start_at, authoritative_start_block, end_block").eq("launch_id", data.launchId).maybeSingle(),
      sb.from("pcart_launch_coordinator_events").select("event_kind, created_at").eq("launch_id", data.launchId).order("created_at", { ascending: false }).limit(10),
    ]);
    const claims = dep.data?.id
      ? await sb.from("pcart_production_send_claims").select("claim_status").eq("deployment_id", dep.data.id)
      : { data: [] };
    const map = (rows: any[] | null) => (rows ?? []).map((r) => ({ id: r.id, manifestVersion: r.manifest_version, manifestFingerprint: r.manifest_fingerprint, overallResult: r.overall_result ?? null, reviewedAt: r.reviewed_at, expiresAt: r.expires_at }));
    const revoked = (rev.data ?? []).map((r: any) => String(r.review_id));
    const a = policyApproval("P8A", map(p8a.data), revoked);
    const b = policyApproval("P8B", map(p8b.data), revoked);
    const snap: P9Snapshot = {
      nowMs: Date.now(),
      control: ctl.data ? { executionEnabled: ctl.data.execution_enabled === true, emergencyStopEngaged: ctl.data.emergency_stop_engaged !== false } : null,
      deployment: dep.data ? { status: dep.data.status, txHash: dep.data.tx_hash, contractAddress: dep.data.contract_address, finalityState: dep.data.finality_state } : null,
      sendClaims: (claims.data ?? []).map((c: any) => ({ claimStatus: String(c.claim_status) })),
      launch: { status: launch.data?.status ?? null, officialContractAddress: launch.data?.official_contract_address ?? null },
      p8a: a.status,
      p8b: b.status,
      plan: plan.data ? { promotionStartAt: plan.data.promotion_start_at, intendedAuctionStartAt: plan.data.intended_auction_start_at, authoritativeStartBlock: plan.data.authoritative_start_block?.toString() ?? null, endBlock: plan.data.end_block?.toString() ?? null } : null,
      observed: { preAuctionSafeTxExecuted: null, currentBlock: null, migrated: null, graduated: null, unsoldSwept: null },
    };
    return {
      ok: true as const,
      derivation: deriveCoordinatorState(snap),
      milestones: milestones(snap),
      plan: snap.plan,
      planStatus: planStatus(snap.plan),
      control: snap.control,
      launchStatus: snap.launch.status,
      officialContractAddress: snap.launch.officialContractAddress,
      attempt: dep.data ? { number: dep.data.attempt_number, status: dep.data.status, txHash: dep.data.tx_hash, contractAddress: dep.data.contract_address } : null,
      p8a: { status: a.status, reviewedAt: a.review?.reviewedAt ?? null, attestationExpiresAt: a.review?.expiresAt ?? null },
      p8b: { status: b.status, reviewedAt: b.review?.reviewedAt ?? null, attestationExpiresAt: b.review?.expiresAt ?? null },
      claimsCount: (claims.data ?? []).length,
      recentEvents: (events.data ?? []) as { event_kind: string; created_at: string }[],
    };
  });
