import { PCART_FIXED_INTENT } from "@/lib/launch-artifact-registry";

/**
 * L-S2 — PEPECARTEL launch setup readiness (pure, read-only).
 *
 * Derives the five-step PCART launch setup view from data the route already
 * loaded. It never queries Supabase, never writes, and never changes any gate.
 * "Ready" means every build/test prerequisite is complete; the mainnet launch
 * itself stays intentionally locked by the existing execution controls.
 */

export type PcartStepId = "token" | "auction" | "treasury" | "review" | "launch";
export type PcartStepState = "ready" | "needs_setup" | "pending_build" | "locked";

export const PCART_STEP_ORDER: readonly PcartStepId[] = [
  "token",
  "auction",
  "treasury",
  "review",
  "launch",
] as const;

export const PCART_STEP_LABELS: Record<PcartStepId, string> = {
  token: "Token",
  auction: "Auction",
  treasury: "Treasury",
  review: "Review",
  launch: "Launch",
};

export const PCART_AUCTION_AFTER_DEPLOYMENT = "Auction — after token deployment" as const;

export type PcartMainnetSummaryInput = {
  approved: boolean;
  executionLocked: boolean;
  draftSaved: boolean;
  /** P3: an active (unexpired, uncancelled) wallet-ready preparation authorization exists. */
  walletReady?: boolean;
  /** P4: an active (unexpired, uncancelled) READY TO SEND permit exists. */
  readyToSend?: boolean;
};

/** Mainnet row text, driven only by authoritative readiness/control/draft state. */
export function pcartMainnetSummary(i: PcartMainnetSummaryInput): string {
  if (!i.executionLocked) return "Execution control not locked — review required";
  if (!i.approved) return "Locked — not ready";
  if (i.draftSaved && i.readyToSend) return "Ready to send — no transaction sent";
  if (i.draftSaved && i.walletReady) return "Wallet ready — final send review next";
  if (i.draftSaved) return "Reviewed draft saved — wallet preparation next";
  return "Approved — deployment review next";
}

/** True when the saved schedule is in the past. Display-only: never mutates. */
export function isPcartLaunchScheduleExpired(
  launchAt: string | null | undefined,
  windowEnd: string | null | undefined,
  nowMs: number,
): boolean {
  const anchor = launchAt ?? windowEnd ?? null;
  if (!anchor) return false;
  const t = Date.parse(anchor);
  return Number.isFinite(t) && t < nowMs;
}

export type PcartRehearsalRowLike = {
  artifact_id: string | null;
  status: string;
  network_environment: string;
};

export type PcartReadinessInput = {
  /** Only true once a real auction integration exists. Always false today. */
  auctionIntegrated?: boolean;
  treasurySignersRecorded: boolean;
  /**
   * True only via isPcartTreasurySafeReady(): a persisted Safe address AND a
   * fresh server-side canonical verification against the saved owners.
   */
  treasurySafeVerified?: boolean;
  deploymentRows: readonly PcartRehearsalRowLike[];
  /** Existing mainnet execution lock. Defaults to locked. */
  mainnetLocked?: boolean;
};

/**
 * Treasury Safe readiness. Persisted evidence alone is NEVER enough: a fresh
 * server-side verification must pass the full canonical Safe v1.4.1 profile
 * AND match the exact saved owner set. Does not touch mainnet execution locks.
 */
export function isPcartTreasurySafeReady(input: {
  persistedSafeAddress: string | null | undefined;
  fresh:
    | { isCanonicalSafeV141: boolean; ownersMatchIntended: boolean | null; address: string }
    | null
    | undefined;
}): boolean {
  const persisted = (input.persistedSafeAddress ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(persisted)) return false;
  const f = input.fresh;
  if (!f) return false;
  return (
    f.isCanonicalSafeV141 === true &&
    f.ownersMatchIntended === true &&
    String(f.address ?? "").toLowerCase() === persisted
  );
}

export type PcartStep = {
  id: PcartStepId;
  label: string;
  state: PcartStepState;
  status: string;
  detail: string;
  nextAction: string | null;
};

export type PcartReadiness = {
  steps: PcartStep[];
  buildReady: boolean;
  overall: "Ready" | "Not Ready";
  mainnetLocked: boolean;
  next: { stepId: PcartStepId; action: string } | null;
};

export const PCART_AUCTION_DEFAULTS = [
  "Public auction anyone can join",
  "Runs for about 4 days",
  "Bids in ETH on Robinhood Chain",
  "Target Raise is separate from a lower Graduation Floor",
] as const;

/** Exact frozen PCART artifact, confirmed on testnet. Generic tokens never count. */
export function hasConfirmedPcartRehearsal(rows: readonly PcartRehearsalRowLike[]): boolean {
  return rows.some(
    (r) =>
      r.artifact_id === PCART_FIXED_INTENT.artifactId &&
      r.status === "CONFIRMED" &&
      r.network_environment === "TESTNET",
  );
}

export function derivePcartReadiness(input: PcartReadinessInput): PcartReadiness {
  const auctionReady = input.auctionIntegrated === true;
  const treasuryReady = input.treasurySignersRecorded && input.treasurySafeVerified === true;
  const reviewReady = hasConfirmedPcartRehearsal(input.deploymentRows);
  const mainnetLocked = input.mainnetLocked !== false;

  const steps: PcartStep[] = [
    {
      id: "token",
      label: PCART_STEP_LABELS.token,
      state: "ready",
      status: "Ready",
      detail: "PCART is fixed: 1,000,000,000 supply, no future minting, no transfer tax, no admin controls.",
      nextAction: null,
    },
    {
      id: "auction",
      label: PCART_STEP_LABELS.auction,
      state: auctionReady ? "ready" : "pending_build",
      status: auctionReady ? "Ready" : PCART_AUCTION_AFTER_DEPLOYMENT,
      detail: auctionReady
        ? "Auction setup is in place."
        : "Not required for deployment review. The auction is set up after the token is deployed.",
      // Never the operator's current blocker: distribution follows deployment.
      nextAction: null,
    },
    {
      id: "treasury",
      label: PCART_STEP_LABELS.treasury,
      state: treasuryReady ? "ready" : "needs_setup",
      status: treasuryReady ? "Ready" : "Needs setup",
      detail: treasuryReady
        ? "The 2-of-3 treasury Safe is set up and checked."
        : input.treasurySignersRecorded
          ? "Three signer wallets are saved. The 2-of-3 Safe still needs to be created and checked."
          : "Save three separate signer wallets, then create and check the 2-of-3 Safe.",
      nextAction: treasuryReady
        ? null
        : input.treasurySignersRecorded
          ? "Create and check the treasury Safe"
          : "Save the three treasury signer wallets",
    },
    {
      id: "review",
      label: PCART_STEP_LABELS.review,
      state: reviewReady ? "ready" : "needs_setup",
      status: reviewReady ? "Ready" : "Test launch needed",
      detail: reviewReady
        ? "PCART has passed a confirmed test launch on testnet."
        : "Run one test launch of PCART on testnet before launch day.",
      nextAction: reviewReady ? null : "Run the PCART test launch",
    },
    {
      id: "launch",
      label: PCART_STEP_LABELS.launch,
      state: "locked",
      status: "Locked until launch day",
      detail: "Mainnet stays safely locked until every step is finished and launch is approved.",
      nextAction: null,
    },
  ];

  // Auction/liquidity is a post-deployment distribution phase (safety contract
  // §8/§10/§16) and never counts against production-deployment readiness.
  void auctionReady;
  const buildReady = treasuryReady && reviewReady;
  // "Next" must be an action the operator can actually take: prefer the first
  // step needing setup. Only when no actionable setup remains may Next name a
  // pending build dependency.
  const firstActionable = steps.find((s) => s.state === "needs_setup");
  const firstPending = steps.find((s) => s.state === "pending_build");
  const nextStep = firstActionable ?? firstPending;
  return {
    steps,
    buildReady,
    overall: buildReady ? "Ready" : "Not Ready",
    mainnetLocked,
    next: nextStep && nextStep.nextAction ? { stepId: nextStep.id, action: nextStep.nextAction } : null,
  };
}
