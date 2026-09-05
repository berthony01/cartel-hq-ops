import { REQUIRED_CONFIRMATIONS, ROBINHOOD_TESTNET_CHAIN_ID } from "./chain-registry";

/**
 * Cartel Verified Launch — deployment evidence + official-registration
 * eligibility evaluator (C8.7A evidence model, C8.7B registration gating).
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
  /* Recorded intent, as stored on the deployment row. */
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  /** Exact-decimal generated text mirror. Never use the numeric JSON supply. */
  token_total_supply_text: string | null;
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
  officialContractDeploymentId: string | null;
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
 * No global chain-mapping schema. This knows only enough to fail closed:
 * anything it cannot positively match is UNKNOWN, and a declared non-EVM chain
 * can never match an EVM chain id.
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
  /**
   * True only when EVERY registration gate passed. The database re-derives all
   * of these inside `register_verified_launch_contract`; this flag only decides
   * what the operator is offered.
   */
  officialRegistrationEligible: boolean;
  registrationChecks: EvidenceCheck[];
  registrationBlockReasons: string[];
  /** Set when more than one deployment carries verified evidence. */
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

/** Canonical lowercase hex, mirroring `public.assert_launch_contract_evidence`. */
const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const CANONICAL_DIGITS_PATTERN = /^[0-9]+$/;

/** The only decimals an official Cartel fixed-supply ERC-20 may declare. */
const REQUIRED_TOKEN_DECIMALS = 18;

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function isCanonicalDigits(value: string | null | undefined): boolean {
  return typeof value === "string" && CANONICAL_DIGITS_PATTERN.test(value);
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
    isCanonicalDigits(row.verified_total_supply_text) &&
    isCanonicalDigits(row.verified_recipient_balance_text);
  evidenceChecks.push(
    check(
      "token_state",
      "On-chain token state read back",
      tokenStateOk ? "PASS" : "FAIL",
      isTokenKind
        ? tokenStateOk
          ? `Read back ${row.verified_token_name} (${row.verified_token_symbol}), ${row.verified_token_decimals} decimals, supply ${row.verified_total_supply_text}, recipient balance ${row.verified_recipient_balance_text}.`
          : "Verified token state is incomplete or not in canonical form for a token deployment."
        : "Token state cannot be established for an unrecognised deployment kind.",
    ),
  );

  /* Identity and supply parity with the recorded intent — mirrors the server
     predicates in `public.assert_launch_contract_evidence`. Fails closed. */
  if (isTokenKind) {
    const nameOk =
      !isBlank(row.token_name) && row.verified_token_name === row.token_name;
    evidenceChecks.push(
      check(
        "token_name_match",
        "Token name matches the recorded intent",
        nameOk ? "PASS" : "FAIL",
        isBlank(row.token_name)
          ? "No token name was recorded for this deployment."
          : nameOk
            ? `On-chain name matches the recorded name ${row.token_name}.`
            : `On-chain name ${row.verified_token_name ?? "unknown"} does not match the recorded name ${row.token_name}.`,
      ),
    );

    const symbolOk =
      !isBlank(row.token_symbol) && row.verified_token_symbol === row.token_symbol;
    evidenceChecks.push(
      check(
        "token_symbol_match",
        "Token symbol matches the recorded intent",
        symbolOk ? "PASS" : "FAIL",
        isBlank(row.token_symbol)
          ? "No token symbol was recorded for this deployment."
          : symbolOk
            ? `On-chain symbol matches the recorded symbol ${row.token_symbol}.`
            : `On-chain symbol ${row.verified_token_symbol ?? "unknown"} does not match the recorded symbol ${row.token_symbol}.`,
      ),
    );

    const decimalsOk =
      row.token_decimals === REQUIRED_TOKEN_DECIMALS &&
      row.verified_token_decimals === REQUIRED_TOKEN_DECIMALS;
    evidenceChecks.push(
      check(
        "token_decimals_match",
        "Token decimals match the recorded intent",
        decimalsOk ? "PASS" : "FAIL",
        decimalsOk
          ? `Recorded and on-chain decimals are both ${REQUIRED_TOKEN_DECIMALS}.`
          : `Recorded decimals ${row.token_decimals ?? "unknown"} and on-chain decimals ${row.verified_token_decimals ?? "unknown"} must both be ${REQUIRED_TOKEN_DECIMALS}.`,
      ),
    );

    const recordedSupplyOk = isCanonicalDigits(row.token_total_supply_text);
    const supplyOk =
      recordedSupplyOk &&
      isCanonicalDigits(row.verified_total_supply_text) &&
      row.verified_total_supply_text === row.token_total_supply_text;
    evidenceChecks.push(
      check(
        "token_supply_match",
        "Total supply matches the recorded intent",
        supplyOk ? "PASS" : "FAIL",
        !recordedSupplyOk
          ? "No exact recorded total supply is available for this deployment."
          : supplyOk
            ? `On-chain total supply matches the recorded exact supply ${row.token_total_supply_text}.`
            : `On-chain total supply ${row.verified_total_supply_text ?? "unknown"} does not match the recorded exact supply ${row.token_total_supply_text}.`,
      ),
    );

    const balanceOk =
      recordedSupplyOk &&
      isCanonicalDigits(row.verified_recipient_balance_text) &&
      row.verified_recipient_balance_text === row.token_total_supply_text;
    evidenceChecks.push(
      check(
        "token_recipient_balance_match",
        "Recipient holds the entire supply",
        balanceOk ? "PASS" : "FAIL",
        !recordedSupplyOk
          ? "No exact recorded total supply is available to compare the recipient balance against."
          : balanceOk
            ? "The recipient balance equals the full recorded supply."
            : `Recipient balance ${row.verified_recipient_balance_text ?? "unknown"} does not equal the recorded exact supply ${row.token_total_supply_text}.`,
      ),
    );
  }

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
