/**
 * PCART P9.0 — Launch Day Coordinator foundation (pure, read-only).
 * Derives exactly one coordinator state from authoritative data. Contains no wallet, signing,
 * Safe proposal, send, auction-start, migrate or sweep capability. P9.0 is display/planning only.
 */
import { P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "@/lib/pcart-auction-liquidity-plan";
import { P8B_DURATION_BLOCKS, P8B_MANIFEST_FINGERPRINT, P8B_MANIFEST_VERSION } from "@/lib/pcart-auction-execution-p8b";

export const P9_STOP_COPY = "No live action is enabled in P9.0." as const;
export const P9_PROMOTION_MIN_DAYS = 21;
const DAY_MS = 86_400_000;

export const P9_STATES = [
  "BLOCKED_UNCERTAIN_TRANSACTION",
  "BLOCKED_STALE_DEPENDENCY",
  "AWAITING_DEPLOYMENT",
  "DEPLOYMENT_PENDING",
  "AWAITING_FINALIZATION",
  "AWAITING_REGISTRATION",
  "AWAITING_PROMOTION_PLAN",
  "PROMOTION_RUNWAY",
  "AWAITING_PRE_AUCTION_SAFE_TX",
  "AUCTION_SCHEDULED",
  "AUCTION_OPEN",
  "AUCTION_ENDED_AWAITING_MIGRATE",
  "REFUND_PATH",
  "AWAITING_UNSOLD_SWEEP",
  "LAUNCH_COMPLETE",
  "BLOCKED_DEPLOYMENT_FAILED",
] as const;
export type P9State = (typeof P9_STATES)[number];

export type P9Review = { id: string; manifestVersion: string; manifestFingerprint: string; overallResult?: string | null; reviewedAt: string; expiresAt: string } | null;
export type P9PolicyStatus = "CURRENT" | "MISSING" | "MANIFEST_MISMATCH" | "REVOKED" | "SUPERSEDED";

/**
 * Durable policy approval: current when the LATEST review for the kind matches the exact manifest
 * version + fingerprint and has not been revoked. The historical 24h `expires_at` is attestation
 * freshness only and does not, by itself, invalidate policy approval.
 */
export function policyApproval(kind: "P8A" | "P8B", reviews: NonNullable<P9Review>[], revokedIds: string[]): { status: P9PolicyStatus; review: P9Review } {
  const want = kind === "P8A" ? { v: P8A_MANIFEST_VERSION as string, fp: P8A_MANIFEST_FINGERPRINT as string } : { v: P8B_MANIFEST_VERSION as string, fp: P8B_MANIFEST_FINGERPRINT as string };
  const sorted = [...reviews].sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt));
  const latest = sorted[0] ?? null;
  if (!latest) return { status: "MISSING", review: null };
  const matches = (r: NonNullable<P9Review>) => r.manifestVersion === want.v && r.manifestFingerprint.toLowerCase() === want.fp.toLowerCase() && (r.overallResult == null || r.overallResult === "PASS");
  if (!matches(latest)) {
    return { status: sorted.some(matches) ? "SUPERSEDED" : "MANIFEST_MISMATCH", review: latest };
  }
  if (revokedIds.includes(latest.id)) return { status: "REVOKED", review: latest };
  return { status: "CURRENT", review: latest };
}

export type P9Plan = { promotionStartAt: string | null; intendedAuctionStartAt: string | null; authoritativeStartBlock: string | null; endBlock: string | null } | null;

export function planStatus(plan: P9Plan): { ok: boolean; reason: "NOT_SET" | "PARTIAL" | "RUNWAY_TOO_SHORT" | "OK" } {
  if (!plan || (!plan.promotionStartAt && !plan.intendedAuctionStartAt)) return { ok: false, reason: "NOT_SET" };
  if (!plan.promotionStartAt || !plan.intendedAuctionStartAt) return { ok: false, reason: "PARTIAL" };
  const p = Date.parse(plan.promotionStartAt), a = Date.parse(plan.intendedAuctionStartAt);
  if (!Number.isFinite(p) || !Number.isFinite(a) || a < p + P9_PROMOTION_MIN_DAYS * DAY_MS) return { ok: false, reason: "RUNWAY_TOO_SHORT" };
  return { ok: true, reason: "OK" };
}

export type P9Snapshot = {
  nowMs: number;
  control: { executionEnabled: boolean; emergencyStopEngaged: boolean } | null;
  deployment: { status: string | null; txHash: string | null; contractAddress: string | null; finalityState: string | null } | null;
  sendClaims: { claimStatus: string }[];
  launch: { status: string | null; officialContractAddress: string | null };
  p8a: P9PolicyStatus;
  p8b: P9PolicyStatus;
  plan: P9Plan;
  /** Observed facts that only exist after later phases (null until P9.1+ readers exist). */
  observed: { preAuctionSafeTxExecuted: boolean | null; currentBlock: string | null; migrated: boolean | null; graduated: boolean | null; unsoldSwept: boolean | null };
};

export type P9Derivation = { state: P9State; nextStep: string; blockers: string[]; liveActionEnabled: false };

const NEXT: Record<P9State, string> = {
  BLOCKED_UNCERTAIN_TRANSACTION: "A transaction outcome is uncertain. Resolve it through draft recovery before anything else — never resend.",
  BLOCKED_STALE_DEPENDENCY: "A required P8A/P8B policy approval is missing, revoked or no longer matches the pinned plan. Re-review it.",
  AWAITING_DEPLOYMENT: "Deploy the official PCART contract (P5) once the send window is authorized.",
  DEPLOYMENT_PENDING: "Wait for the deployment transaction to confirm, then verify it (P6).",
  AWAITING_FINALIZATION: "Wait for finality and complete P6 verification.",
  AWAITING_REGISTRATION: "Register the finalized address as the official contract (P7).",
  AWAITING_PROMOTION_PLAN: "Choose the promotion start and an auction start at least 21 days later.",
  PROMOTION_RUNWAY: "Promote the launch. The pre-auction Safe transaction is prepared nearer the auction.",
  AWAITING_PRE_AUCTION_SAFE_TX: "Prepare the pre-auction Safe transaction and collect 2 owner signatures (P9.3).",
  AUCTION_SCHEDULED: "Wait for the auction start block. It starts on-chain by itself.",
  AUCTION_OPEN: "Auction is open. Nothing to sign — monitor progress.",
  AUCTION_ENDED_AWAITING_MIGRATE: "Auction ended. Call or confirm the public migrate().",
  REFUND_PATH: "Minimum raise not met. Bidders claim refunds; then sweep PCART back to the Treasury Safe.",
  AWAITING_UNSOLD_SWEEP: "Sweep unsold tokens to the Treasury Safe (2 owner signatures).",
  LAUNCH_COMPLETE: "Launch complete.",
  BLOCKED_DEPLOYMENT_FAILED: "The deployment attempt failed or was abandoned. Start a fresh, reviewed attempt.",
};

/** Exactly one state. Order = priority: uncertainty and stale policy always block progression. */
export function deriveCoordinatorState(s: P9Snapshot): P9Derivation {
  const blockers: string[] = [];
  if (!s.control || s.control.emergencyStopEngaged) blockers.push("EMERGENCY_STOP_ENGAGED");
  if (!s.control || !s.control.executionEnabled) blockers.push("EXECUTION_DISABLED");
  const out = (state: P9State): P9Derivation => ({ state, nextStep: NEXT[state], blockers, liveActionEnabled: false });

  const d = s.deployment;
  const uncertainClaim = s.sendClaims.some((c) => c.claimStatus === "AMBIGUOUS" || c.claimStatus === "CLAIMED");
  const uncertainDeploy = !!d && (d.status === "SUBMITTED" || d.status === "PENDING") && !d.txHash;
  if (uncertainClaim || uncertainDeploy) { blockers.push("UNCERTAIN_TRANSACTION"); return out("BLOCKED_UNCERTAIN_TRANSACTION"); }
  if (s.p8a !== "CURRENT" || s.p8b !== "CURRENT") { blockers.push("STALE_DEPENDENCY"); return out("BLOCKED_STALE_DEPENDENCY"); }

  if (!d || d.status === "DRAFT" || d.status == null) return out("AWAITING_DEPLOYMENT");
  if (d.status === "FAILED" || d.status === "ABANDONED") return out("BLOCKED_DEPLOYMENT_FAILED");
  if (d.status === "SUBMITTED" || d.status === "PENDING") return out("DEPLOYMENT_PENDING");
  if (d.status !== "CONFIRMED" || d.finalityState !== "FINALIZED") return out("AWAITING_FINALIZATION");
  const official = (s.launch.officialContractAddress ?? "").toLowerCase();
  if (!official || official !== (d.contractAddress ?? "").toLowerCase()) return out("AWAITING_REGISTRATION");

  const o = s.observed;
  if (o.unsoldSwept) return out("LAUNCH_COMPLETE");
  if (o.migrated || o.graduated === false) {
    return out(o.graduated === false ? "REFUND_PATH" : "AWAITING_UNSOLD_SWEEP");
  }
  if (o.preAuctionSafeTxExecuted && s.plan?.authoritativeStartBlock && o.currentBlock) {
    const cur = BigInt(o.currentBlock), start = BigInt(s.plan.authoritativeStartBlock);
    const end = s.plan.endBlock ? BigInt(s.plan.endBlock) : start + BigInt(P8B_DURATION_BLOCKS);
    if (cur < start) return out("AUCTION_SCHEDULED");
    if (cur < end) return out("AUCTION_OPEN");
    return out("AUCTION_ENDED_AWAITING_MIGRATE");
  }
  if (o.preAuctionSafeTxExecuted) return out("AUCTION_SCHEDULED");
  const ps = planStatus(s.plan);
  if (!ps.ok) return out("AWAITING_PROMOTION_PLAN");
  // Never auto-start: runway only shows the plan; Safe preparation is a separate explicit P9.3 step.
  const preparationOpensAt = Date.parse(s.plan!.intendedAuctionStartAt!) - 2 * DAY_MS;
  if (s.nowMs < preparationOpensAt) return out("PROMOTION_RUNWAY");
  return out("AWAITING_PRE_AUCTION_SAFE_TX");
}

export type P9Milestone = { key: string; label: string; done: boolean };
export function milestones(s: P9Snapshot): P9Milestone[] {
  const d = s.deployment;
  return [
    { key: "P8A", label: "P8A liquidity plan approved", done: s.p8a === "CURRENT" },
    { key: "P8B", label: "P8B fork rehearsal approved", done: s.p8b === "CURRENT" },
    { key: "P5", label: "Official PCART deployed", done: !!d?.txHash && (d.status === "CONFIRMED" || d.status === "PENDING" || d.status === "SUBMITTED") },
    { key: "P6", label: "Deployment verified and finalized", done: d?.status === "CONFIRMED" && d.finalityState === "FINALIZED" },
    { key: "P7", label: "Official contract registered", done: !!s.launch.officialContractAddress },
    { key: "PLAN", label: "Promotion plan set (≥21 days)", done: planStatus(s.plan).ok },
    { key: "PRE", label: "Pre-auction Safe transaction executed", done: s.observed.preAuctionSafeTxExecuted === true },
    { key: "MIGRATE", label: "Auction migrated", done: s.observed.migrated === true },
    { key: "SWEEP", label: "Unsold tokens swept", done: s.observed.unsoldSwept === true },
  ];
}
