import { REQUIRED_CONFIRMATIONS, ROBINHOOD_TESTNET_CHAIN_ID } from "./chain-registry";

/**
 * C8.7A — Cartel Verified Launch: deployment evidence + official-registration
 * eligibility evaluator.
 *
 * READ ONLY BY CONSTRUCTION. This module is a pure, deterministic function of
 * its inputs. It performs no I/O, imports no Supabase client, calls no RPC,
 * never writes `launches.official_contract_address` or `contract_registered_at`,
 * never transitions a launch lifecycle status, never enqueues a launch event,
 * notification or Telegram send, and never builds or signs a transaction.
 *
 * `registrationReady` is a frozen `false` for this phase: C8.7A can explain
 * evidence, it can never make official registration possible.
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

/**
 * Environments that may host an officially registerable deployment.
 * Test networks are never included.
 */
export const APPROVED_REGISTRATION_ENVIRONMENTS: readonly string[] = ["PRODUCTION"];

/** Deployment kinds that could ever represent an official project token. */
export const APPROVED_OFFICIAL_DEPLOYMENT_KINDS: readonly string[] = ["FIXED_SUPPLY_ERC20"];

/** The only frozen artifact whose deployment may become an official contract. */
export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;

/** Lifecycle status in which official contract registration is permitted. */
export const REGISTRATION_LIFECYCLE_STATUS = "CONTRACT_PENDING" as const;

/** Minimum confirmation depth, mirroring the deployment verifier's floor. */
export const EVIDENCE_REQUIRED_CONFIRMATIONS = REQUIRED_CONFIRMATIONS;

export const VERIFIED_DEPLOYMENT_DISCLAIMER =
  "Verified deployment means the recorded on-chain deployment evidence passed Cartel's verifier. " +
  "It is not an endorsement, audit, safety guarantee, or promise of legitimacy or value.";


/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export type DeploymentEvidenceInput = {
  id: string;
  attempt_number: number;
  launch_id: string | null;
  workspace_id: string | null;
  deployment_kind: string | null;
  network_environment: string | null;
  chain_id: number | null;
  status: string | null;
  tx_hash: string | null;
  contract_address: string | null;
  confirmations: number | null;
  block_number: number | null;
  submitted_at: string | null;
  verified_at: string | null;
  created_at: string | null;
  artifact_id: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  verified_token_name: string | null;
  verified_token_symbol: string | null;
  verified_token_decimals: number | null;
  verified_total_supply_text: string | null;
  verified_recipient_balance_text: string | null;
};

export type LaunchEvidenceContext = {
  launchId: string;
  workspaceId: string;
  declaredChain: string | null;
  launchStatus: string;
  officialContractAddress: string | null;
  contractRegisteredAt: string | null;
};

/* ------------------------------------------------------------------ */
/* Chain compatibility — conservative, fail closed                     */
/* ------------------------------------------------------------------ */

export type ChainCompatibility = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";

export type ChainCompatibilityResult = {
  result: ChainCompatibility;
  detail: string;
  /** True only for chain ids this build knows to be test networks. */
  isTestnet: boolean;
  networkLabel: string;
};

/**
 * Registration metadata only. Robinhood Chain mainnet is a LABEL here — this
 * project declares no mainnet RPC, no mainnet wallet target and no mainnet
 * deployment path. `src/lib/chain-registry.ts` remains testnet-only.
 */
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663 as const;

const KNOWN_CHAINS: Record<
  number,
  { label: string; testnet: boolean; aliases: readonly string[] }
> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: {
    label: "Robinhood Chain Testnet",
    testnet: true,
    aliases: ["robinhood chain testnet", "robinhood testnet", `${ROBINHOOD_TESTNET_CHAIN_ID}`],
  },
  [ROBINHOOD_MAINNET_CHAIN_ID]: {
    label: "Robinhood Chain",
    testnet: false,
    aliases: ["robinhood chain", "robinhood chain mainnet", `${ROBINHOOD_MAINNET_CHAIN_ID}`],
  },
};

/** Declared chain strings known to be non-EVM, and therefore never matched by an EVM chain id. */
const KNOWN_NON_EVM_CHAINS: readonly string[] = [
  "solana",
  "sol",
  "bitcoin",
  "btc",
  "sui",
  "aptos",
  "ton",
  "tron",
];

function normalizeChainName(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * C8.7A does not attempt a global chain-mapping schema. It knows only enough
 * to fail closed: anything it cannot positively match is UNKNOWN, and no
 * mainnet can ever be reported COMPATIBLE from this build.
 */
export function evaluateChainCompatibility(
  declaredChain: string | null,
  chainId: number | null,
): ChainCompatibilityResult {
  const declared = normalizeChainName(declaredChain);
  const known = chainId == null ? undefined : KNOWN_CHAINS[chainId];
  const networkLabel = known
    ? known.label
    : chainId == null
      ? "Unknown network"
      : `Chain ${chainId}`;
  const isTestnet = known ? known.testnet : false;

  if (chainId == null) {
    return {
      result: "UNKNOWN",
      detail: "The deployment has no recorded chain id.",
      isTestnet,
      networkLabel,
    };
  }
  if (!known) {
    return {
      result: "UNKNOWN",
      detail: `Chain ${chainId} is not a network this build recognises.`,
      isTestnet,
      networkLabel,
    };
  }
  if (declared === "") {
    return {
      result: "UNKNOWN",
      detail: "This launch has no declared chain.",
      isTestnet,
      networkLabel,
    };
  }
  if (KNOWN_NON_EVM_CHAINS.includes(declared)) {
    return {
      result: "INCOMPATIBLE",
      detail: `This launch declares ${declaredChain}, which is not an EVM network and cannot match ${known.label}.`,
      isTestnet,
      networkLabel,
    };
  }
  if (known.aliases.includes(declared)) {
    return {
      result: "COMPATIBLE",
      detail: `Declared chain matches ${known.label}.`,
      isTestnet,
      networkLabel,
    };
  }
  return {
    result: "INCOMPATIBLE",
    detail: `This launch declares ${declaredChain}, which does not match ${known.label}.`,
    isTestnet,
    networkLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export type CheckState = "PASS" | "FAIL" | "BLOCKED";

export type EvidenceCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
};

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
  /** Always false in C8.7A. */
  officialRegistrationEligible: false;
  registrationChecks: EvidenceCheck[];
  registrationBlockReasons: string[];
  /** Set when more than one deployment carries verified evidence. */
  ambiguous: boolean;
};

export type SummaryState =
  | "NO_DEPLOYMENTS"
  | "NO_VERIFIED_DEPLOYMENTS"
  | "VERIFIED_TEST_DEPLOYMENTS"
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
  eligibleForOfficialRegistration: 0;
  ambiguous: boolean;
  summaryState: SummaryState;
  summaryLabel: string;
  /** Frozen false for C8.7A. */
  registrationReady: false;
  deployments: DeploymentEvidenceResult[];
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function check(id: string, label: string, state: CheckState, detail: string): EvidenceCheck {
  return { id, label, state, detail };
}

function evaluateDeployment(
  row: DeploymentEvidenceInput,
  context: LaunchEvidenceContext,
): DeploymentEvidenceResult {
  const compatibility = evaluateChainCompatibility(context.declaredChain, row.chain_id);
  const environment = row.network_environment;
  const kind = row.deployment_kind;

  const evidenceChecks: EvidenceCheck[] = [];

  const associationOk =
    row.launch_id === context.launchId && row.workspace_id === context.workspaceId;
  evidenceChecks.push(
    check(
      "association",
      "Belongs to this launch and workspace",
      associationOk ? "PASS" : "FAIL",
      associationOk
        ? "Recorded against this launch inside this workspace."
        : "This record does not belong to this launch and workspace.",
    ),
  );

  const statusConfirmed = row.status === "CONFIRMED";
  evidenceChecks.push(
    check(
      "status",
      "Deployment verifier status",
      statusConfirmed ? "PASS" : "FAIL",
      statusConfirmed
        ? "The deployment verifier recorded CONFIRMED."
        : `Recorded status is ${row.status ?? "unknown"}, not CONFIRMED.`,
    ),
  );

  const txOk = !isBlank(row.tx_hash) && TX_HASH_PATTERN.test(row.tx_hash as string);
  evidenceChecks.push(
    check(
      "tx_hash",
      "Transaction hash recorded",
      txOk ? "PASS" : "FAIL",
      txOk
        ? "A well-formed transaction hash is recorded."
        : "No valid transaction hash is recorded.",
    ),
  );

  const addressOk =
    !isBlank(row.contract_address) && EVM_ADDRESS_PATTERN.test(row.contract_address as string);
  evidenceChecks.push(
    check(
      "contract_address",
      "Contract address recorded",
      addressOk ? "PASS" : "FAIL",
      addressOk
        ? "A well-formed contract address is recorded."
        : "No valid contract address is recorded.",
    ),
  );

  const confirmations = row.confirmations ?? 0;
  const confirmationsOk = confirmations >= EVIDENCE_REQUIRED_CONFIRMATIONS;
  evidenceChecks.push(
    check(
      "confirmations",
      "Confirmation depth",
      confirmationsOk ? "PASS" : "FAIL",
      `${confirmations} of ${EVIDENCE_REQUIRED_CONFIRMATIONS} required confirmations.`,
    ),
  );

  const noFailure = isBlank(row.failure_code) && isBlank(row.failure_detail);
  evidenceChecks.push(
    check(
      "failure_state",
      "No recorded failure",
      noFailure ? "PASS" : "FAIL",
      noFailure
        ? "No failure was recorded for this attempt."
        : `Failure recorded: ${row.failure_code ?? "see detail"}.`,
    ),
  );

  const artifactOk = !isBlank(row.artifact_id);
  evidenceChecks.push(
    check(
      "artifact",
      "Frozen artifact identified",
      artifactOk ? "PASS" : "FAIL",
      artifactOk
        ? `Artifact ${row.artifact_id}.`
        : "No frozen artifact is recorded for this attempt.",
    ),
  );

  const isTokenKind = kind != null && APPROVED_OFFICIAL_DEPLOYMENT_KINDS.includes(kind);
  evidenceChecks.push(
    check(
      "approved_kind",
      "Recognised deployment kind",
      isTokenKind ? "PASS" : "FAIL",
      isTokenKind
        ? `${kind} is a recognised deployment kind.`
        : `${kind ?? "Unknown kind"} is not a recognised deployment kind, so it cannot carry verified deployment evidence.`,
    ),
  );

  const verifiedAtOk = !isBlank(row.verified_at);
  evidenceChecks.push(
    check(
      "verified_at",
      "Verification timestamp recorded",
      verifiedAtOk ? "PASS" : "FAIL",
      verifiedAtOk
        ? `Verified at ${row.verified_at}.`
        : "No verification timestamp is recorded for this attempt.",
    ),
  );

  const blockNumberOk = row.block_number != null;
  evidenceChecks.push(
    check(
      "block_number",
      "Mined block recorded",
      blockNumberOk ? "PASS" : "FAIL",
      blockNumberOk
        ? `Recorded in block ${row.block_number}.`
        : "No block number is recorded for this attempt.",
    ),
  );

  const tokenStateOk =
    isTokenKind &&
    !isBlank(row.verified_token_name) &&
    !isBlank(row.verified_token_symbol) &&
    row.verified_token_decimals != null &&
    !isBlank(row.verified_total_supply_text) &&
    !isBlank(row.verified_recipient_balance_text);
  evidenceChecks.push(
    check(
      "token_state",
      "On-chain token state read back",
      tokenStateOk ? "PASS" : "FAIL",
      isTokenKind
        ? tokenStateOk
          ? `Read back ${row.verified_token_name} (${row.verified_token_symbol}), ${row.verified_token_decimals} decimals, supply ${row.verified_total_supply_text}, recipient balance ${row.verified_recipient_balance_text}.`
          : "Verified token state is incomplete for a token deployment."
        : "Token state cannot be established for an unrecognised deployment kind.",
    ),
  );

  const evidenceVerified = evidenceChecks.every((c) => c.state === "PASS");

  /* Official-registration gates — every one of these can only block. */
  const registrationChecks: EvidenceCheck[] = [];
  const registrationBlockReasons: string[] = [];

  const envApproved =
    environment != null && APPROVED_REGISTRATION_ENVIRONMENTS.includes(environment);
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

  registrationChecks.push(
    check(
      "phase_gate",
      "Registration path available",
      "BLOCKED",
      "Registering an official contract from chain evidence is not available in this release. This panel is read only.",
    ),
  );
  registrationBlockReasons.push("Evidence-based registration is not available in this release");

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
    officialRegistrationEligible: false,
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
  const ambiguous = verified.length > 1;
  if (ambiguous) {
    for (const d of verified) d.ambiguous = true;
  }

  const testnetVerifiedCount = verified.filter(
    (d) => d.environment === "TESTNET" || d.chainCompatibility.isTestnet,
  ).length;

  let summaryState: SummaryState;
  if (evaluated.length === 0) summaryState = "NO_DEPLOYMENTS";
  else if (verified.length === 0) summaryState = "NO_VERIFIED_DEPLOYMENTS";
  else if (ambiguous) summaryState = "MULTIPLE_VERIFIED_DEPLOYMENTS";
  else summaryState = "VERIFIED_TEST_DEPLOYMENTS";

  const summaryLabel =
    summaryState === "NO_DEPLOYMENTS"
      ? "No recorded deployments for this launch"
      : summaryState === "NO_VERIFIED_DEPLOYMENTS"
        ? `${evaluated.length} recorded deployment${evaluated.length === 1 ? "" : "s"}, none with complete evidence`
        : summaryState === "MULTIPLE_VERIFIED_DEPLOYMENTS"
          ? `Multiple confirmed deployments detected (${verified.length}). No candidate is selected.`
          : `${verified.length} verified deployment${verified.length === 1 ? "" : "s"} recorded`;

  return {
    launchId: context.launchId,
    declaredChain: context.declaredChain,
    launchStatus: context.launchStatus,
    officialContractAddress: context.officialContractAddress,
    contractRegisteredAt: context.contractRegisteredAt,
    totalDeployments: evaluated.length,
    verifiedCount: verified.length,
    testnetVerifiedCount,
    eligibleForOfficialRegistration: 0,
    ambiguous,
    summaryState,
    summaryLabel,
    registrationReady: REGISTRATION_READY,
    deployments: [...evaluated].sort(newestFirst),
  };
}
