import { REQUIRED_CONFIRMATIONS, ROBINHOOD_TESTNET_CHAIN_ID } from "./chain-registry";

/**
 * Cartel Verified Launch — shared evidence primitives.
 *
 * Extracted from `launch-verified-eligibility.ts` (Hardening B) without any
 * behaviour change other than the production confirmation-depth correction
 * documented on `buildEvidenceChecks`.
 *
 * READ ONLY BY CONSTRUCTION: pure functions of their inputs. No I/O, no
 * Supabase client, no RPC, no writes, no transaction building.
 */

/** Environments that may host an officially registerable deployment. */
export const APPROVED_REGISTRATION_ENVIRONMENTS: readonly string[] = ["PRODUCTION"];

/** Deployment kinds that could ever represent an official project token. */
export const APPROVED_OFFICIAL_DEPLOYMENT_KINDS: readonly string[] = ["FIXED_SUPPLY_ERC20"];

/** The only frozen artifact whose deployment may become an official contract. */
export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;

/**
 * TESTNET-ONLY confirmation depth, mirroring the deployment verifier's floor.
 * Production official-contract registration is gated on managed FINALIZED
 * evidence instead; production `confirmations` is diagnostic.
 */
export const EVIDENCE_REQUIRED_CONFIRMATIONS = REQUIRED_CONFIRMATIONS;

/** The only decimals an official Cartel fixed-supply ERC-20 may declare. */
export const REQUIRED_TOKEN_DECIMALS = 18;

/** Canonical lowercase hex, mirroring `public.assert_launch_contract_evidence`. */
export const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const CANONICAL_DIGITS_PATTERN = /^[0-9]+$/;

export type CheckState = "PASS" | "FAIL" | "BLOCKED";

export type EvidenceCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
};

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function isCanonicalDigits(value: string | null | undefined): boolean {
  return typeof value === "string" && CANONICAL_DIGITS_PATTERN.test(value);
}

export function check(
  id: string,
  label: string,
  state: CheckState,
  detail: string,
): EvidenceCheck {
  return { id, label, state, detail };
}

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
  /* Managed production finality evidence (authoritative for production). */
  finality_state: string | null;
  finalized_block_hash_confirmed: boolean | null;
  finality_provider_kind: string | null;
  finalized_at: string | null;
  finalized_block_number: number | null;
  finalized_head_block_number: number | null;
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
 * module declares no mainnet RPC, no mainnet wallet target and no mainnet
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

/** Declared chain strings known to be non-EVM, never matched by an EVM chain id. */
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
/* Chain-evidence checks                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds the chain-evidence checks for one deployment row.
 *
 * `isProductionEnv` only changes the confirmation-depth check. On production,
 * observed confirmations are DIAGNOSTIC: managed finalized evidence (evaluated
 * separately in `launch-production-finality.ts`, and re-derived server side by
 * `public.assert_launch_contract_evidence`) is the authoritative depth signal.
 * Test networks keep the fixed 5-confirmation rule unchanged.
 */
export function buildEvidenceChecks(
  row: DeploymentEvidenceInput,
  context: { launchId: string; workspaceId: string },
  isProductionEnv: boolean,
): EvidenceCheck[] {
  const kind = row.deployment_kind;
  const checks: EvidenceCheck[] = [];

  const associationOk =
    row.launch_id === context.launchId && row.workspace_id === context.workspaceId;
  checks.push(
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
  checks.push(
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
  checks.push(
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
  checks.push(
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
  if (isProductionEnv) {
    checks.push(
      check(
        "confirmations",
        "Confirmation depth (diagnostic)",
        "PASS",
        `${confirmations} confirmation${confirmations === 1 ? "" : "s"} observed. On Robinhood Chain production this is diagnostic only — managed finalized evidence is the authoritative requirement.`,
      ),
    );
  } else {
    const confirmationsOk = confirmations >= EVIDENCE_REQUIRED_CONFIRMATIONS;
    checks.push(
      check(
        "confirmations",
        "Confirmation depth",
        confirmationsOk ? "PASS" : "FAIL",
        `${confirmations} of ${EVIDENCE_REQUIRED_CONFIRMATIONS} required confirmations.`,
      ),
    );
  }

  const noFailure = isBlank(row.failure_code) && isBlank(row.failure_detail);
  checks.push(
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
  checks.push(
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
  checks.push(
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
  checks.push(
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
  checks.push(
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
  checks.push(
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
    const nameOk = !isBlank(row.token_name) && row.verified_token_name === row.token_name;
    checks.push(
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

    const symbolOk = !isBlank(row.token_symbol) && row.verified_token_symbol === row.token_symbol;
    checks.push(
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
    checks.push(
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
    checks.push(
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
    checks.push(
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

  return checks;
}
