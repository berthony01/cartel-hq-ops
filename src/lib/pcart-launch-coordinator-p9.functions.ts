/**
 * PCART P9.0/P9.1 — owner-only coordinator snapshot + launch-plan save.
 * Snapshot: SELECT-only DB reads + read-only chain reads (server-side). Never writes launches,
 * deployments, controls, contracts, claims or notifications. Plan save calls only the existing
 * owner-only planning RPC (plan row + activity record).
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveCoordinatorState, milestones, planStatus, policyApproval, type P9Snapshot } from "@/lib/pcart-launch-coordinator-p9";
import { derivePreflight } from "@/lib/pcart-launch-coordinator-p9-2";
import { auctionReadModel, estimateAuctionBlocks, interpretChain, interpretDependencies, interpretSafe, validatePlanInput } from "@/lib/pcart-launch-coordinator-p9-live";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { supabase: any; userId: string };
const isOwner = async (ctx: Ctx) => (await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId })).data === true;

export const getPcartP9CoordinatorSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string }) => {
    if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
    return { launchId: i.launchId.toLowerCase() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const sb = ctx.supabase;
    const [launch, dep, ctl, p8a, p8b, rev, plan, events, signers] = await Promise.all([
      sb.from("launches").select("id, status, official_contract_address").eq("id", data.launchId).maybeSingle(),
      sb.from("launch_chain_deployments").select("id, attempt_number, status, tx_hash, contract_address, finality_state, submitted_at, artifact_id, chain_id, network_environment, deployer_address, deployer_nonce_before, init_code_hash, review_fingerprint")
        .eq("launch_id", data.launchId).eq("network_environment", "PRODUCTION").order("attempt_number", { ascending: false }).limit(1).maybeSingle(),
      sb.from("launch_chain_production_execution_controls").select("execution_enabled, emergency_stop_engaged").eq("control_key", "ROBINHOOD_MAINNET_DEPLOYMENT").maybeSingle(),
      sb.from("pcart_auction_liquidity_plan_reviews").select("id, manifest_version, manifest_fingerprint, reviewed_at, expires_at").eq("launch_id", data.launchId),
      sb.from("pcart_auction_execution_rehearsal_reviews").select("id, manifest_version, manifest_fingerprint, overall_result, reviewed_at, expires_at").eq("launch_id", data.launchId),
      sb.from("pcart_policy_approval_revocations").select("review_id").eq("launch_id", data.launchId),
      sb.from("pcart_launch_day_plans").select("promotion_start_at, intended_auction_start_at, authoritative_start_block, end_block").eq("launch_id", data.launchId).maybeSingle(),
      sb.from("pcart_launch_coordinator_events").select("event_kind, created_at").eq("launch_id", data.launchId).order("created_at", { ascending: false }).limit(10),
      sb.from("launch_treasury_signer_configs").select("signer_1, signer_2, signer_3, safe_address").eq("launch_id", data.launchId).maybeSingle(),
    ]);
    const active = await sb.from("launch_chain_deployments").select("id", { count: "exact", head: true })
      .eq("launch_id", data.launchId).eq("network_environment", "PRODUCTION").eq("chain_id", 4663).eq("artifact_id", "pepecartel-token-v1").in("status", ["DRAFT", "SUBMITTED", "PENDING", "CONFIRMED"]);
    const claims = dep.data?.id
      ? await sb.from("pcart_production_send_claims").select("claim_status").eq("deployment_id", dep.data.id)
      : { data: [] };

    const officialToken: string | null = launch.data?.official_contract_address ?? null;
    const { readP9Live } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const raw = await readP9Live(officialToken, dep.data?.deployer_address ?? null);
    const chain = interpretChain(raw.chain);
    const configured = signers.data ? [signers.data.signer_1, signers.data.signer_2, signers.data.signer_3].filter(Boolean) : [];
    const safe = interpretSafe(raw.safe, signers.data?.safe_address ?? null, configured);
    const deps = interpretDependencies(raw.deps);
    const currentBlock = chain.status === "LIVE" || chain.status === "STALE" ? chain.latestBlock : null;
    // No auction address is stored anywhere before P9.3 preparation → NOT_CREATED (never an error, never fabricated).
    const auction = auctionReadModel(null, null, currentBlock);

    const map = (rows: any[] | null) => (rows ?? []).map((r) => ({ id: r.id, manifestVersion: r.manifest_version, manifestFingerprint: r.manifest_fingerprint, overallResult: r.overall_result ?? null, reviewedAt: r.reviewed_at, expiresAt: r.expires_at }));
    const revoked = (rev.data ?? []).map((r: any) => String(r.review_id));
    const a = policyApproval("P8A", map(p8a.data), revoked);
    const b = policyApproval("P8B", map(p8b.data), revoked);
    const snap: P9Snapshot = {
      nowMs: Date.now(),
      control: ctl.data ? { executionEnabled: ctl.data.execution_enabled === true, emergencyStopEngaged: ctl.data.emergency_stop_engaged !== false } : null,
      deployment: dep.data ? { status: dep.data.status, txHash: dep.data.tx_hash, contractAddress: dep.data.contract_address, finalityState: dep.data.finality_state } : null,
      sendClaims: (claims.data ?? []).map((c: any) => ({ claimStatus: String(c.claim_status) })),
      launch: { status: launch.data?.status ?? null, officialContractAddress: officialToken },
      p8a: a.status,
      p8b: b.status,
      plan: plan.data ? { promotionStartAt: plan.data.promotion_start_at, intendedAuctionStartAt: plan.data.intended_auction_start_at, authoritativeStartBlock: plan.data.authoritative_start_block?.toString() ?? null, endBlock: plan.data.end_block?.toString() ?? null } : null,
      observed: { preAuctionSafeTxExecuted: null, currentBlock, migrated: null, graduated: null, unsoldSwept: null },
      live: { chainLive: chain.status === "LIVE", safeReady: safe.status === "READY", dependenciesVerified: deps.status === "VERIFIED" },
    };
    const preflight = derivePreflight({
      chain: { live: chain.status === "LIVE", chainId: "chainId" in chain ? (chain as any).chainId ?? null : null },
      safe: { status: safe.status, reasons: safe.reasons, threshold: safe.threshold ?? null, nonce: safe.nonce ?? null, owners: safe.owners },
      configuredSigners: configured as string[],
      dependencies: deps.status,
      p8a: a.status, p8b: b.status,
      attempt: dep.data ? { status: dep.data.status, txHash: dep.data.tx_hash, submittedAt: dep.data.submitted_at, contractAddress: dep.data.contract_address, finalityState: dep.data.finality_state, artifactId: dep.data.artifact_id, chainId: dep.data.chain_id, networkEnvironment: dep.data.network_environment, deployerAddress: dep.data.deployer_address, deployerNonceBefore: dep.data.deployer_nonce_before == null ? null : String(dep.data.deployer_nonce_before), initCodeHash: dep.data.init_code_hash, reviewFingerprint: dep.data.review_fingerprint } : null,
      activeProductionAttempts: active.count ?? 0,
      uncertainClaim: (claims.data ?? []).some((c: any) => c.claim_status === "AMBIGUOUS" || c.claim_status === "CLAIMED"),
      deployerLive: raw.deployerLive,
      control: snap.control,
    });
    return {
      ok: true as const,
      preflight,
      derivation: deriveCoordinatorState(snap),
      milestones: milestones(snap),
      plan: snap.plan,
      planStatus: planStatus(snap.plan),
      estimate: estimateAuctionBlocks(snap.plan?.intendedAuctionStartAt ?? null, chain),
      chain,
      safe,
      dependencies: deps,
      auction,
      officialTokenCodeHash: raw.officialTokenCodeHash,
      control: snap.control,
      launchStatus: snap.launch.status,
      officialContractAddress: officialToken,
      attempt: dep.data ? { number: dep.data.attempt_number, status: dep.data.status, txHash: dep.data.tx_hash, submittedAt: dep.data.submitted_at, contractAddress: dep.data.contract_address, finalityState: dep.data.finality_state } : null,
      p8a: { status: a.status, reviewedAt: a.review?.reviewedAt ?? null, attestationExpiresAt: a.review?.expiresAt ?? null },
      p8b: { status: b.status, reviewedAt: b.review?.reviewedAt ?? null, attestationExpiresAt: b.review?.expiresAt ?? null },
      claimsCount: (claims.data ?? []).length,
      recentEvents: (events.data ?? []) as { event_kind: string; created_at: string }[],
    };
  });

/** Owner-only planning save. Independent of execution switch / emergency stop by design. */
export const savePcartP9LaunchPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { launchId: string; promotionStartAt: string | null; intendedAuctionStartAt: string | null }) => {
    if (!i || !UUID.test(String(i.launchId))) throw new Error("Invalid launch");
    const norm = (v: unknown) => (v == null || v === "" ? null : new Date(String(v)).toISOString());
    return { launchId: i.launchId.toLowerCase(), promotionStartAt: norm(i.promotionStartAt), intendedAuctionStartAt: norm(i.intendedAuctionStartAt) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const v = validatePlanInput(data.promotionStartAt, data.intendedAuctionStartAt);
    if (!v.ok) return { ok: false as const, reason: v.error! };
    const { error } = await ctx.supabase.rpc("set_canonical_pcart_launch_day_plan", {
      _launch_id: data.launchId, _promotion_start_at: data.promotionStartAt, _intended_auction_start_at: data.intendedAuctionStartAt,
    });
    if (error) return { ok: false as const, reason: String(error.message ?? "SAVE_FAILED") };
    return { ok: true as const };
  });
