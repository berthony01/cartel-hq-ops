/**
 * PCART P9.2 — guided deployment segment (pure, read-only).
 * Maps authoritative P2–P7 state (DB rows + P9.1 live reads) to exactly one deployment state,
 * one next action, and which EXISTING canonical panel (P2 review, P3 wallet, P4 final review,
 * P5 send/recovery, P6 verify/finality, P7 register) is the single active step.
 * Contains no wallet, signing, send, Safe, registration, auction, migrate or sweep capability.
 */
import { isAllowedPcartDeployer, pcartProductionInitCodeHash, predictPcartProductionAddress, PCART_PRODUCTION_TREASURY_SAFE } from "@/lib/pcart-production-intent";

export const P9_2_STATES = [
  "READY_FOR_FINAL_PREFLIGHT",
  "READY_FOR_DEPLOY_REVIEW",
  "READY_FOR_DEPLOY",
  "DEPLOY_SUBMITTED",
  "DEPLOY_UNCERTAIN",
  "DEPLOY_CONFIRMED",
  "READY_FOR_FINALIZATION",
  "READY_FOR_REGISTRATION",
  "OFFICIAL_CONTRACT_REGISTERED",
  "DEPLOY_FAILED",
] as const;
export type P92State = (typeof P9_2_STATES)[number];
export type P92Panel = "P2_REVIEW" | "P3_WALLET" | "P4_FINAL_REVIEW" | "P5_SEND" | "P6_VERIFY" | "P7_REGISTER" | null;

export const P9_2_STEPS = [
  "Final preflight", "Review deployment", "Prepare deployment", "Wallet sign / send", "Transaction submitted",
  "Wait for finality", "Verify deployed contract", "Finalize verified deployment", "Register official PCART",
  "Deployment complete", "Next: promotion / auction",
] as const;

export type P92Attempt = {
  status: string | null; txHash: string | null; submittedAt: string | null; contractAddress: string | null; finalityState: string | null;
  artifactId: string | null; chainId: number | null; networkEnvironment: string | null;
  deployerAddress: string | null; deployerNonceBefore: string | null; initCodeHash: string | null; reviewFingerprint: string | null;
} | null;

export type P92PreflightInput = {
  chain: { live: boolean; chainId: number | null };
  safe: { status: "READY" | "BLOCKED" | "UNAVAILABLE"; reasons: string[]; threshold: number | null; nonce: number | null; owners: string[] };
  configuredSigners: string[];
  dependencies: "VERIFIED" | "BLOCKED" | "UNAVAILABLE";
  p8a: string; p8b: string;
  attempt: P92Attempt;
  activeProductionAttempts: number;
  uncertainClaim: boolean;
  deployerLive: { nonce: string | null; balanceWei: string | null };
  control: { executionEnabled: boolean; emergencyStopEngaged: boolean } | null;
  /** Launch send window currently open (launches.launch_window_start/end). Null/false = closed. */
  sendWindowOpen?: boolean | null;
};

export type P92CheckStatus = "PASS" | "BLOCKED" | "AT_SEND_STEP";
export type P92Check = { key: string; label: string; status: P92CheckStatus; detail?: string | undefined };

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Read-only preflight. Controls are reported separately and never hide the other checks. */
export function derivePreflight(i: P92PreflightInput): { checks: P92Check[]; allPass: boolean; sendGateOpen: boolean; controlBlockers: string[] } {
  const a = i.attempt;
  const ck = (key: string, label: string, ok: boolean, detail?: string): P92Check => ({ key, label, status: ok ? "PASS" : "BLOCKED", detail });
  const safeOwners = i.safe.owners.map(lc).sort();
  const signers = i.configuredSigners.map(lc).sort();
  const deployer = lc(a?.deployerAddress);
  const unsent = !!a && a.status === "DRAFT" && !a.txHash && !a.submittedAt && !a.contractAddress;
  let predictedOk = false;
  let predicted: string | undefined;
  if (a?.deployerAddress && a.deployerNonceBefore != null && i.deployerLive.nonce != null) {
    try {
      predicted = predictPcartProductionAddress(a.deployerAddress, BigInt(a.deployerNonceBefore)).toLowerCase();
      predictedOk = predicted === predictPcartProductionAddress(a.deployerAddress, BigInt(i.deployerLive.nonce)).toLowerCase();
    } catch { predictedOk = false; }
  }
  let initOk = false;
  try { initOk = !!a?.initCodeHash && lc(a.initCodeHash) === lc(pcartProductionInitCodeHash(PCART_PRODUCTION_TREASURY_SAFE)); } catch { initOk = false; }
  const bal = i.deployerLive.balanceWei;
  const checks: P92Check[] = [
    ck("CHAIN", "Robinhood Chain = 4663", i.chain.live && i.chain.chainId === 4663),
    { key: "WALLET", label: "Connected wallet equals reviewed deployer", status: "AT_SEND_STEP", detail: "Checked by the existing wallet step; no wallet prompt on page load." },
    ck("DEPLOYER_SIGNER", "Deployer is one of the three Safe signers", !!deployer && isAllowedPcartDeployer(deployer, i.configuredSigners, PCART_PRODUCTION_TREASURY_SAFE) && signers.includes(deployer)),
    ck("SAFE_OWNERS", "Safe owners exactly match the signer set", safeOwners.length === 3 && signers.length === 3 && safeOwners.every((o, k) => o === signers[k])),
    ck("SAFE_THRESHOLD", "Safe threshold = 2", i.safe.threshold === 2),
    ck("SAFE_NONCE", "Safe nonce readable", i.safe.nonce != null),
    bal == null
      ? ck("BALANCE", "Deployer ETH balance", false, "Balance unreadable")
      : BigInt(bal) === 0n
        ? ck("BALANCE", "Deployer ETH balance", false, "Balance is 0")
        : { key: "BALANCE", label: "Deployer ETH balance covers max cost", status: "AT_SEND_STEP", detail: `${bal} wei — exact max-cost check runs in the existing final send review.` },
    ck("REVIEW", "P5 reviewed fingerprint present", !!a?.reviewFingerprint),
    ck("ARTIFACT", "Artifact = pepecartel-token-v1 (init code + Treasury Safe recipient)", a?.artifactId === "pepecartel-token-v1" && initOk),
    ck("NONCE", "Deployer nonce unchanged since review", unsent ? i.deployerLive.nonce != null && a!.deployerNonceBefore === i.deployerLive.nonce : !!a && !unsent),
    ck("PREDICTED", "Predicted contract address matches current nonce", unsent ? predictedOk : !!a && !unsent, predicted),
    ck("P8A", "P8A policy approval current", i.p8a === "CURRENT"),
    ck("P8B", "P8B policy approval current", i.p8b === "CURRENT"),
    ck("DEPS", "Pinned dependency hashes current", i.dependencies === "VERIFIED"),
    ck("ATTEMPT", "Canonical attempt is the active production row", !!a && a.chainId === 4663 && a.networkEnvironment === "PRODUCTION"),
    ck("NO_TX", "No transaction already recorded for an unsent draft", !a || a.status !== "DRAFT" || (!a.txHash && !a.submittedAt && !a.contractAddress)),
    ck("NO_UNCERTAIN", "No uncertain send claim", !i.uncertainClaim),
    ck("NO_DUPLICATE", "No duplicate active production deployment", i.activeProductionAttempts <= 1),
  ];
  const controlBlockers: string[] = [];
  // CANONICAL_PCART_PROTECTED: the narrow PCART path runs only while global controls stay locked;
  // the launch send window + bound short permit are the scoped authorization.
  if (!i.control || i.control.executionEnabled !== false) controlBlockers.push("Global mainnet execution must stay OFF (canonical protected)");
  if (!i.control || i.control.emergencyStopEngaged !== true) controlBlockers.push("Emergency stop must stay ON (canonical protected)");
  if (i.sendWindowOpen !== true) controlBlockers.push("Launch send window is not open");
  return { checks, allPass: checks.every((c) => c.status !== "BLOCKED"), sendGateOpen: controlBlockers.length === 0, controlBlockers };
}

export type P92Input = {
  attempt: P92Attempt;
  /** Latest send claim status (RELEASED counts as none). */
  claimStatus: string | null;
  readinessApproved: boolean;
  preparationActive: boolean;
  permitActive: boolean;
  launch: { status: string | null; officialContractAddress: string | null };
  /** null while the live snapshot is unavailable: pre-send steps then fail closed. */
  preflight: { allPass: boolean; sendGateOpen: boolean; controlBlockers: string[] } | null;
  planValid: boolean;
};
export type P92Derivation = { state: P92State; step: number; panel: P92Panel; nextAction: string; blockers: string[]; complete: boolean };

/** Exactly one deployment state + one action. Post-broadcast states never depend on the live snapshot. */
export function deriveDeploymentSegment(i: P92Input): P92Derivation {
  const a = i.attempt;
  const out = (state: P92State, step: number, panel: P92Panel, nextAction: string, blockers: string[] = []): P92Derivation =>
    ({ state, step, panel, nextAction, blockers, complete: state === "OFFICIAL_CONTRACT_REGISTERED" });
  const official = lc(i.launch.officialContractAddress);

  if (official) {
    if (a?.contractAddress && lc(a.contractAddress) !== official) return out("DEPLOY_FAILED", 9, "P7_REGISTER", "A different official binding exists. Stop and review — nothing is changed automatically.", ["OFFICIAL_BINDING_CONFLICT"]);
    return out("OFFICIAL_CONTRACT_REGISTERED", 10, null, i.planValid
      ? "Official PCART deployed and registered. Next: prepare the pre-auction Safe transaction when the promotion runway is satisfied."
      : "Official PCART deployed and registered. Next: set/confirm the promotion and auction plan.");
  }
  const claim = i.claimStatus && i.claimStatus !== "RELEASED" ? i.claimStatus : null;
  if (a && (a.status === "FAILED" || a.status === "ABANDONED")) return out("DEPLOY_FAILED", 4, a.txHash ? "P6_VERIFY" : null, "The deployment attempt failed or was abandoned. Do not retry blindly — review before any fresh attempt.", ["DEPLOYMENT_FAILED"]);
  if (a && (claim === "AMBIGUOUS" || claim === "CLAIMED") && !a.txHash) {
    return out("DEPLOY_UNCERTAIN", 4, "P5_SEND", "Transaction outcome uncertain. Use the existing recovery check — never resend.", ["UNCERTAIN_TRANSACTION"]);
  }
  if (a && (a.status === "SUBMITTED" || a.status === "PENDING")) {
    return out("DEPLOY_SUBMITTED", 4, "P6_VERIFY", "Waiting for confirmation. Then verify the deployment.");
  }
  if (a && a.status === "CONFIRMED") {
    if (a.finalityState === "FINALIZED") return out("READY_FOR_REGISTRATION", 8, "P7_REGISTER", "Register the verified address as the official PCART contract.");
    if (!a.finalityState) return out("DEPLOY_CONFIRMED", 5, "P6_VERIFY", "Deployment confirmed. Wait for finality.");
    return out("READY_FOR_FINALIZATION", 7, "P6_VERIFY", "Check finality to finalize the verified deployment.");
  }
  if (a && a.txHash) return out("DEPLOY_UNCERTAIN", 4, "P5_SEND", "A transaction hash exists on an unexpected state. Never resend — reconcile first.", ["UNCERTAIN_TRANSACTION"]);

  // Pre-send: fail closed on missing snapshot, readiness, preflight or controls.
  if (!i.preflight) return out("READY_FOR_FINAL_PREFLIGHT", 0, null, "Reading live preflight…", ["PREFLIGHT_UNAVAILABLE"]);
  if (!i.readinessApproved) return out("READY_FOR_FINAL_PREFLIGHT", 0, null, "Final production readiness approval is required first.", ["READINESS_NOT_APPROVED"]);
  if (!i.preflight.sendGateOpen) {
    const protectedOk = !i.preflight.controlBlockers.some((b) => /canonical protected/.test(b));
    return out("READY_FOR_FINAL_PREFLIGHT", 0, null, protectedOk ? "Deployment locked — launch send window is not open" : "Deployment locked — global controls are not in the canonical protected state", i.preflight.controlBlockers);
  }
  if (!i.preflight.allPass) return out("READY_FOR_FINAL_PREFLIGHT", 0, null, "Resolve the blocked preflight items before deployment.", ["PREFLIGHT_BLOCKED"]);
  if (!a || a.status !== "DRAFT") return out("READY_FOR_DEPLOY_REVIEW", 1, "P2_REVIEW", "Review deployment");
  if (!i.preparationActive) return out("READY_FOR_DEPLOY_REVIEW", 2, "P3_WALLET", "Prepare deployment wallet");
  if (!i.permitActive) return out("READY_FOR_DEPLOY_REVIEW", 2, "P4_FINAL_REVIEW", "Prepare final send");
  return out("READY_FOR_DEPLOY", 3, "P5_SEND", "Send the deployment from the reviewed wallet");
}
