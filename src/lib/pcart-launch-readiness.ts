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

export type PcartRehearsalRowLike = {
  artifact_id: string | null;
  status: string;
  network_environment: string;
};

export type PcartReadinessInput = {
  /** Only true once a real auction integration exists. Always false today. */
  auctionIntegrated?: boolean;
  treasurySignersRecorded: boolean;
  /** Only true once the real Safe is created and verified. Always false today. */
  treasurySafeVerified?: boolean;
  deploymentRows: readonly PcartRehearsalRowLike[];
  /** Existing mainnet execution lock. Defaults to locked. */
  mainnetLocked?: boolean;
};

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
      status: auctionReady ? "Ready" : "Auction setup pending",
      detail: auctionReady
        ? "Auction setup is in place."
        : "The auction is not built yet. Planned defaults are shown below.",
      nextAction: auctionReady ? null : "Auction setup is being built",
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

  const buildReady = auctionReady && treasuryReady && reviewReady;
  const firstOpen = steps.find((s) => s.state !== "ready" && s.state !== "locked");
  return {
    steps,
    buildReady,
    overall: buildReady ? "Ready" : "Not Ready",
    mainnetLocked,
    next: firstOpen && firstOpen.nextAction ? { stepId: firstOpen.id, action: firstOpen.nextAction } : null,
  };
}
