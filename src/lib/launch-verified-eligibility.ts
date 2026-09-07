import {
  APPROVED_OFFICIAL_ARTIFACT_ID,
  APPROVED_OFFICIAL_DEPLOYMENT_KINDS,
  APPROVED_REGISTRATION_ENVIRONMENTS,
  buildEvidenceChecks,
  check,
  evaluateChainCompatibility,
  isBlank,
  type ChainCompatibilityResult,
  type DeploymentEvidenceInput,
  type EvidenceCheck,
} from "./launch-evidence-checks";
import { evaluateProductionFinality } from "./launch-production-finality";

/**
 * Cartel Verified Launch — deployment evidence + official-registration
 * eligibility evaluator (C8.7A evidence model, C8.7B registration gating,
 * Hardening B managed-finality correction).
 *
 * READ ONLY BY CONSTRUCTION. This module is a pure, deterministic function of
 * its inputs. It performs no I/O, imports no Supabase client, calls no RPC,
 * never writes `launches.official_contract_address`, `contract_registered_at`
 * or `official_contract_deployment_id`, never transitions a launch lifecycle
 * status, never enqueues a launch event, notification or Telegram send, and
 * never builds or signs a transaction.
 *
 * Since C8.7B, evidence-bound official contract registration IS possible, but
 * only through the separate `register_verified_launch_contract` RPC, which
 * re-derives every predicate below server side and is the sole write path.
 * What this evaluator produces only decides what an owner is OFFERED; the
 * database remains authoritative and fails closed independently.
 *
 * "Verified deployment" means only that the recorded on-chain deployment
 * evidence passed Cartel's deployment verifier. It is not an endorsement,
 * audit, safety guarantee, or promise of legitimacy or value.
 */

/**
 * C8.7B registration phase gate. Evidence-bound official contract registration
 * is available, but ONLY through `register_verified_launch_contract`, which
 * re-derives every predicate below server side. Nothing in this module writes.
 */
export const REGISTRATION_READY = true as const;

/** Lifecycle status in which official contract registration is permitted. */
export const REGISTRATION_LIFECYCLE_STATUS = "CONTRACT_PENDING" as const;

export const VERIFIED_DEPLOYMENT_DISCLAIMER =
  "Verified deployment means the recorded on-chain deployment evidence passed Cartel's verifier. " +
  "It is not an endorsement, audit, safety guarantee, or promise of legitimacy or value.";

/* Public API preserved across the Hardening B extraction. */
export {
  APPROVED_OFFICIAL_ARTIFACT_ID,
  APPROVED_OFFICIAL_DEPLOYMENT_KINDS,
  APPROVED_REGISTRATION_ENVIRONMENTS,
  EVIDENCE_REQUIRED_CONFIRMATIONS,
  ROBINHOOD_MAINNET_CHAIN_ID,
  evaluateChainCompatibility,
} from "./launch-evidence-checks";
export type {
  ChainCompatibility,
  ChainCompatibilityResult,
  CheckState,
  DeploymentEvidenceInput,
  EvidenceCheck,
} from "./launch-evidence-checks";

export type LaunchEvidenceContext = {
  launchId: string;
  workspaceId: string;
  declaredChain: string | null;
  launchStatus: string;
  officialContractAddress: string | null;
  officialContractDeploymentId: string | null;
  contractRegisteredAt: string | null;
};

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type EvidenceClass = "VERIFIED_DEPLOYMENT" | "INELIGIBLE";

export type DeploymentEvidenceResult = {
  deploymentId: string;
  attemptNumber: number;
  deploymentKind: string | null;
  environment: string | null;
  chainId: number | null;
  networkLabel: string;
  txHash: string | null;
  contractAddress: string | null;
  /** Diagnostic on production. Authoritative depth is managed finality. */
  confirmations: number | null;
  blockNumber: number | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string | null;
  artifactId: string | null;
  verifiedTokenName: string | null;
  verifiedTokenSymbol: string | null;
  verifiedTokenDecimals: number | null;
  verifiedTotalSupplyText: string | null;
  verifiedRecipientBalanceText: string | null;
  chainCompatibility: ChainCompatibilityResult;
  /** True when every chain-evidence check passed. Not a safety statement. */
  evidenceVerified: boolean;
  evidenceClass: EvidenceClass;
  evidenceChecks: EvidenceCheck[];
  /**
   * True only when EVERY registration gate passed. The database re-derives all
   * of these inside `register_verified_launch_contract`; this flag only decides
   * what the operator is offered.
   */
  officialRegistrationEligible: boolean;
  registrationChecks: EvidenceCheck[];
  registrationBlockReasons: string[];
  /** Set when more than one deployment is eligible for official registration. */
  ambiguous: boolean;
};

export type SummaryState =
  | "NO_DEPLOYMENTS"
  | "NO_VERIFIED_DEPLOYMENTS"
  | "VERIFIED_TEST_DEPLOYMENTS"
  | "VERIFIED_PRODUCTION_DEPLOYMENT"
  | "VERIFIED_DEPLOYMENT"
  | "MULTIPLE_VERIFIED_DEPLOYMENTS";

export type LaunchEvidenceEvaluation = {
  launchId: string;
  declaredChain: string | null;
  launchStatus: string;
  officialContractAddress: string | null;
  contractRegisteredAt: string | null;
  totalDeployments: number;
  verifiedCount: number;
  testnetVerifiedCount: number;
  eligibleForOfficialRegistration: number;
  /**
   * The single eligible candidate, or null. Never auto-selected when more than
   * one candidate qualifies — ambiguity blocks instead of guessing.
   */
  registrationCandidate: DeploymentEvidenceResult | null;
  ambiguous: boolean;
  summaryState: SummaryState;
  summaryLabel: string;
  registrationReady: boolean;
  /** True when the launch already carries a registered official contract. */
  alreadyRegistered: boolean;
  deployments: DeploymentEvidenceResult[];
};

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export function evaluateDeployment(
  row: DeploymentEvidenceInput,
  context: LaunchEvidenceContext,
): DeploymentEvidenceResult {
  const compatibility = evaluateChainCompatibility(context.declaredChain, row.chain_id);
  const environment = row.network_environment;
  const kind = row.deployment_kind;

  const envApproved =
    environment != null && APPROVED_REGISTRATION_ENVIRONMENTS.includes(environment);
  const isTokenKind = kind != null && APPROVED_OFFICIAL_DEPLOYMENT_KINDS.includes(kind);

  const evidenceChecks = buildEvidenceChecks(row, context, envApproved);
  const evidenceVerified = evidenceChecks.every((c) => c.state === "PASS");

  /* Official-registration gates — every one of these can only block. */
  const registrationChecks: EvidenceCheck[] = [];
  const registrationBlockReasons: string[] = [];

  registrationChecks.push(
    check(
      "environment",
      "Production environment",
      envApproved ? "PASS" : "BLOCKED",
      envApproved
        ? "Recorded on an eligible production environment."
        : `Recorded on ${environment ?? "an unrecorded environment"}. Test networks are never eligible for official registration.`,
    ),
  );
  if (!envApproved) {
    registrationBlockReasons.push(
      environment === "TESTNET"
        ? "Test network deployment"
        : `Environment ${environment ?? "unknown"} is not an eligible production environment`,
    );
  }

  const chainOk = compatibility.result === "COMPATIBLE";
  registrationChecks.push(
    check(
      "declared_chain",
      "Matches the declared launch chain",
      chainOk ? "PASS" : "BLOCKED",
      compatibility.detail,
    ),
  );
  if (!chainOk) {
    registrationBlockReasons.push(
      compatibility.result === "UNKNOWN"
        ? "Chain match could not be established"
        : "Network does not match the declared launch chain",
    );
  }

  registrationChecks.push(
    check(
      "deployment_kind",
      "Recognised official token kind",
      isTokenKind ? "PASS" : "BLOCKED",
      isTokenKind
        ? `${kind} is a recognised official token kind.`
        : `${kind ?? "Unknown kind"} is not a recognised official token kind.`,
    ),
  );
  if (!isTokenKind)
    registrationBlockReasons.push("Deployment kind is not a recognised official token kind");

  registrationChecks.push(
    check(
      "evidence",
      "Complete chain evidence",
      evidenceVerified ? "PASS" : "BLOCKED",
      evidenceVerified
        ? "All chain-evidence checks passed."
        : "One or more chain-evidence checks did not pass.",
    ),
  );
  if (!evidenceVerified) registrationBlockReasons.push("Chain evidence is incomplete");

  const approvedArtifact = row.artifact_id === APPROVED_OFFICIAL_ARTIFACT_ID;
  registrationChecks.push(
    check(
      "approved_artifact",
      "Approved frozen artifact",
      approvedArtifact ? "PASS" : "BLOCKED",
      approvedArtifact
        ? `Deployed from the approved frozen artifact ${APPROVED_OFFICIAL_ARTIFACT_ID}.`
        : `Artifact ${row.artifact_id ?? "unknown"} is not the approved official artifact.`,
    ),
  );
  if (!approvedArtifact)
    registrationBlockReasons.push("Deployment was not built from the approved frozen artifact");

  /* Hardening B: managed finalized evidence replaces the obsolete separate
     fixed five-confirmation registration requirement. Mirrors the server
     predicates in `public.assert_launch_contract_evidence`. */
  const finality = evaluateProductionFinality(row);
  if (envApproved) {
    registrationChecks.push(...finality.checks);
    registrationBlockReasons.push(...finality.blockReasons);
  }
  const finalityGateOk = !envApproved || finality.finalityOk;

  const lifecycleOk = context.launchStatus === REGISTRATION_LIFECYCLE_STATUS;
  registrationChecks.push(
    check(
      "lifecycle",
      "Launch is contract pending",
      lifecycleOk ? "PASS" : "BLOCKED",
      lifecycleOk
        ? "This launch is at Contract Pending, where registration is permitted."
        : `Registration is only permitted at Contract Pending. This launch is ${context.launchStatus}.`,
    ),
  );
  if (!lifecycleOk) registrationBlockReasons.push("Launch is not at Contract Pending");

  const notRegistered =
    isBlank(context.officialContractAddress) &&
    isBlank(context.officialContractDeploymentId) &&
    isBlank(context.contractRegisteredAt);
  registrationChecks.push(
    check(
      "not_registered",
      "No contract registered yet",
      notRegistered ? "PASS" : "BLOCKED",
      notRegistered
        ? "This launch has no registered official contract."
        : "This launch already carries official contract registration state. Registered contracts cannot be replaced.",
    ),
  );
  if (!notRegistered) registrationBlockReasons.push("An official contract is already registered");

  const officialRegistrationEligible =
    envApproved &&
    chainOk &&
    !compatibility.isTestnet &&
    isTokenKind &&
    evidenceVerified &&
    approvedArtifact &&
    finalityGateOk &&
    lifecycleOk &&
    notRegistered;

  return {
    deploymentId: row.id,
    attemptNumber: row.attempt_number,
    deploymentKind: kind,
    environment,
    chainId: row.chain_id,
    networkLabel: compatibility.networkLabel,
    txHash: row.tx_hash,
    contractAddress: row.contract_address,
    confirmations: row.confirmations,
    blockNumber: row.block_number,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    artifactId: row.artifact_id,
    verifiedTokenName: row.verified_token_name,
    verifiedTokenSymbol: row.verified_token_symbol,
    verifiedTokenDecimals: row.verified_token_decimals,
    verifiedTotalSupplyText: row.verified_total_supply_text,
    verifiedRecipientBalanceText: row.verified_recipient_balance_text,
    chainCompatibility: compatibility,
    evidenceVerified,
    evidenceClass: evidenceVerified ? "VERIFIED_DEPLOYMENT" : "INELIGIBLE",
    evidenceChecks,
    officialRegistrationEligible,
    registrationChecks,
    registrationBlockReasons,
    ambiguous: false,
  };
}

/**
 * Deterministic newest-first ordering: highest attempt number first, then the
 * newest creation timestamp, then deployment id. Ordering is applied AFTER
 * per-deployment evaluation and never changes an evaluation outcome.
 */
function newestFirst(a: DeploymentEvidenceResult, b: DeploymentEvidenceResult): number {
  if (a.attemptNumber !== b.attemptNumber) return b.attemptNumber - a.attemptNumber;
  const at = a.createdAt ?? "";
  const bt = b.createdAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.deploymentId < b.deploymentId ? 1 : -1;
}

export function evaluateLaunchDeploymentEvidence(
  context: LaunchEvidenceContext,
  rows: readonly DeploymentEvidenceInput[],
): LaunchEvidenceEvaluation {
  const evaluated = rows.map((row) => evaluateDeployment(row, context));

  const verified = evaluated.filter((d) => d.evidenceVerified);

  const testnetVerifiedCount = verified.filter(
    (d) => d.environment === "TESTNET" || d.chainCompatibility.isTestnet,
  ).length;

  // Ambiguity is a REGISTRATION CHOICE problem, not an evidence count problem.
  // Several verified rows are unremarkable when exactly one of them qualifies
  // for official registration. Only competing eligible production candidates
  // are ambiguous, and none of those is ever selected automatically: selection
  // is an explicit owner action and the database re-derives every predicate.
  const eligible = evaluated.filter((d) => d.officialRegistrationEligible);
  const ambiguous = eligible.length > 1;
  if (ambiguous) {
    for (const d of eligible) d.ambiguous = true;
  }
  const registrationCandidate =
    eligible.length === 1 ? (eligible[0] as DeploymentEvidenceResult) : null;
  const eligibleForOfficialRegistration = eligible.length;

  // A single verified deployment is described truthfully. A production record
  // is never labelled "test", and a record that is neither a known test network
  // nor an approved production environment gets the neutral verified state.
  const onlyVerified = verified.length === 1 ? (verified[0] as DeploymentEvidenceResult) : null;
  const onlyVerifiedIsTestnet =
    onlyVerified != null &&
    (onlyVerified.environment === "TESTNET" || onlyVerified.chainCompatibility.isTestnet);
  const onlyVerifiedIsProduction =
    onlyVerified != null &&
    onlyVerified.environment != null &&
    APPROVED_REGISTRATION_ENVIRONMENTS.includes(onlyVerified.environment) &&
    !onlyVerified.chainCompatibility.isTestnet;

  let summaryState: SummaryState;
  if (evaluated.length === 0) summaryState = "NO_DEPLOYMENTS";
  else if (verified.length === 0) summaryState = "NO_VERIFIED_DEPLOYMENTS";
  else if (verified.length > 1) summaryState = "MULTIPLE_VERIFIED_DEPLOYMENTS";
  else if (onlyVerifiedIsTestnet) summaryState = "VERIFIED_TEST_DEPLOYMENTS";
  else if (onlyVerifiedIsProduction) summaryState = "VERIFIED_PRODUCTION_DEPLOYMENT";
  else summaryState = "VERIFIED_DEPLOYMENT";

  const multipleVerifiedLabel = ambiguous
    ? `${verified.length} verified deployments recorded. ${eligibleForOfficialRegistration} qualify for official registration, so no candidate is selected automatically.`
    : eligibleForOfficialRegistration === 1
      ? `${verified.length} verified deployments recorded, of which exactly one qualifies for official registration.`
      : `${verified.length} verified deployments recorded, none of which qualifies for official registration.`;

  const summaryLabel =
    summaryState === "NO_DEPLOYMENTS"
      ? "No recorded deployments for this launch"
      : summaryState === "NO_VERIFIED_DEPLOYMENTS"
        ? `${evaluated.length} recorded deployment${evaluated.length === 1 ? "" : "s"}, none with complete evidence`
        : summaryState === "MULTIPLE_VERIFIED_DEPLOYMENTS"
          ? multipleVerifiedLabel
          : summaryState === "VERIFIED_TEST_DEPLOYMENTS"
            ? "1 verified test network deployment recorded"
            : summaryState === "VERIFIED_PRODUCTION_DEPLOYMENT"
              ? "1 verified production deployment recorded"
              : "1 verified deployment recorded";

  return {
    launchId: context.launchId,
    declaredChain: context.declaredChain,
    launchStatus: context.launchStatus,
    officialContractAddress: context.officialContractAddress,
    contractRegisteredAt: context.contractRegisteredAt,
    totalDeployments: evaluated.length,
    verifiedCount: verified.length,
    testnetVerifiedCount,
    eligibleForOfficialRegistration,
    registrationCandidate,
    alreadyRegistered:
      !isBlank(context.officialContractAddress) ||
      !isBlank(context.officialContractDeploymentId) ||
      !isBlank(context.contractRegisteredAt),
    ambiguous,
    summaryState,
    summaryLabel,
    registrationReady: REGISTRATION_READY,
    deployments: [...evaluated].sort(newestFirst),
  };
}
