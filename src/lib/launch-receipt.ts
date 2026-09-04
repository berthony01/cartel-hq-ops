import {
  REQUIRED_CONFIRMATIONS,
  ROBINHOOD_TESTNET_CHAIN_ID,
  explorerAddressUrl,
  explorerTxUrl,
} from "./chain-registry";
import { CARTEL_FIXED_ERC20_DECIMALS } from "./cartel-fixed-erc20.artifact";
import { formatWholeSupply, tokenSupplyText, type DeploymentRow } from "./chain-launcher";
import { buildSimulationIntent, type Simulation } from "./chain-simulation";

/**
 * C8.5 — Launch Receipt derivation (TESTNET ONLY, READ-ONLY).
 *
 * Pure derivation over the authoritative `launch_chain_deployments` row. This
 * module performs no write of any kind: it imports no RPC, no mutation, no
 * server function and no wallet call. It never registers an official contract
 * address and never changes a launch lifecycle status.
 *
 * The platform record (what the operator asked for) is kept strictly separate
 * from independently verified on-chain evidence (what the server verifier
 * observed on chain). Nothing the browser derives can promote a receipt to a
 * verified state: only `status === 'CONFIRMED'` from the server can.
 */

export type ReceiptState =
  | "ATTEMPT_CREATED"
  | "TX_SUBMITTED"
  | "CONFIRMATIONS_PENDING"
  | "VERIFIED"
  | "EVIDENCE_INCOMPLETE"
  | "FAILED"
  | "ABANDONED";

export type ReceiptFieldProvenance = "PLATFORM" | "ONCHAIN" | "DERIVED";

export type FingerprintProvenance = "SESSION" | "RE_DERIVED" | "UNAVAILABLE";

export type LaunchReceipt = {
  state: ReceiptState;
  stateLabel: string;
  /** True only when every required evidence field is present and consistent. */
  verified: boolean;
  /**
   * The raw platform status, kept available even when the receipt fails
   * closed and refuses to use verified-success language.
   */
  platformStatus: string;
  /** Reasons the receipt could not present verified-success semantics. */
  evidenceGaps: string[];
  /**
   * Derived ONLY from full verified success. The server verifier compares the
   * deployed runtime bytecode hash against the frozen artifact before it may
   * set CONFIRMED; no hash value is persisted, so none is displayed.
   */
  runtimeBytecodeVerified: boolean;
  isToken: boolean;
  header: string;

  /* Platform record */
  attemptNumber: number;
  attemptId: string;
  deploymentKind: string;
  artifactId: string | null;
  chainId: number;
  environment: string;
  deployer: string;
  requestedName: string | null;
  requestedSymbol: string | null;
  requestedDecimals: number | null;
  requestedSupplyBaseUnits: string | null;
  requestedSupplyWhole: string | null;
  recipient: string | null;
  createdAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;

  /* Independently verified on-chain evidence */
  txHash: string | null;
  txUrl: string | null;
  contractAddress: string | null;
  contractUrl: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  confirmations: number;
  requiredConfirmations: number;
  verifiedName: string | null;
  verifiedSymbol: string | null;
  verifiedDecimals: number | null;
  verifiedSupplyBaseUnits: string | null;
  verifiedSupplyWhole: string | null;
  verifiedRecipientBalanceBaseUnits: string | null;
  verifiedRecipientBalanceWhole: string | null;
  failureCode: string | null;
  failureDetail: string | null;

  /* Derived / re-derived */
  fingerprint: string | null;
  initCodeHash: string | null;
  fingerprintProvenance: FingerprintProvenance;
};

export const RECEIPT_HEADER = "TESTNET ONLY — NOT THE OFFICIAL PEPECARTEL TOKEN" as const;

const RECEIPT_STATE_BY_STATUS: Record<string, ReceiptState> = {
  DRAFT: "ATTEMPT_CREATED",
  SUBMITTED: "TX_SUBMITTED",
  PENDING: "CONFIRMATIONS_PENDING",
  CONFIRMED: "VERIFIED",
  FAILED: "FAILED",
  ABANDONED: "ABANDONED",
};

export const RECEIPT_STATE_LABEL: Record<ReceiptState, string> = {
  ATTEMPT_CREATED: "Attempt created",
  TX_SUBMITTED: "Transaction submitted",
  CONFIRMATIONS_PENDING: "Awaiting confirmations",
  VERIFIED: "Verified on testnet",
  EVIDENCE_INCOMPLETE: "Verification evidence incomplete",
  FAILED: "Failed",
  ABANDONED: "Abandoned",
};

export function receiptStateForStatus(status: string): ReceiptState {
  return RECEIPT_STATE_BY_STATUS[status] ?? "ATTEMPT_CREATED";
}

/** Strict 32-byte hash. */
function safeHash(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : null;
}

/** Strict 20-byte address. */
function safeAddress(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

/** Exact decimal digit string, or null. Never a rounded or exponential value. */
function safeDigits(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : null;
}

/**
 * Block numbers arrive as a JSON number. Only an exactly representable
 * non-negative integer is rendered, and always through `BigInt` so the output
 * can never be scientific notation.
 */
export function formatBlockNumber(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    return null;
  }
  if (value < 0) return null;
  return BigInt(value).toString();
}

function wholeFromBaseUnits(baseUnits: string | null, decimals: number | null): string | null {
  if (baseUnits === null) return null;
  const d = typeof decimals === "number" && decimals >= 0 && decimals <= 36 ? decimals : null;
  if (d === null) return null;
  if (d !== CARTEL_FIXED_ERC20_DECIMALS) return null;
  return formatWholeSupply(baseUnits);
}

export type ReceiptInput = {
  row: DeploymentRow;
  /** The active, matching simulation for this session, if any. */
  activeSimulation?: Simulation | null;
};

/**
 * Derives the read-only receipt. Pure: no network, no persistence, no writes.
 */
export function deriveLaunchReceipt({ row, activeSimulation }: ReceiptInput): LaunchReceipt {
  const isToken = row.deployment_kind === "FIXED_SUPPLY_ERC20";

  const txHash = safeHash(row.tx_hash);
  const contractAddress = safeAddress(row.contract_address);
  const requestedSupply = isToken ? tokenSupplyText(row) : null;
  const verifiedSupply = safeDigits(row.verified_total_supply_text);
  const verifiedBalance = safeDigits(row.verified_recipient_balance_text);
  const recipient = safeAddress(row.token_recipient);
  const confirmations = typeof row.confirmations === "number" ? row.confirmations : 0;

  // FAIL CLOSED. A receipt may present verified-success semantics only when
  // EVERY required piece of evidence is present and internally consistent.
  // A CONFIRMED row with incomplete or contradictory evidence is reported as
  // "Verification evidence incomplete"; no database state is changed here.
  const gaps: string[] = [];
  if (row.status !== "CONFIRMED") gaps.push("Server verification has not confirmed this attempt.");
  if (row.chain_id !== ROBINHOOD_TESTNET_CHAIN_ID) gaps.push("Recorded chain is not the testnet.");
  if (row.network_environment !== "TESTNET") gaps.push("Recorded environment is not TESTNET.");
  if (txHash === null) gaps.push("No valid transaction hash is recorded.");
  if (contractAddress === null) gaps.push("No valid contract address is recorded.");
  if (confirmations < REQUIRED_CONFIRMATIONS) {
    gaps.push(`Fewer than ${REQUIRED_CONFIRMATIONS} confirmations are recorded.`);
  }

  if (isToken) {
    if (!row.token_name || !row.verified_token_name || row.verified_token_name !== row.token_name) {
      gaps.push("Verified token name does not match the requested name.");
    }
    if (
      !row.token_symbol ||
      !row.verified_token_symbol ||
      row.verified_token_symbol !== row.token_symbol
    ) {
      gaps.push("Verified symbol does not match the requested symbol.");
    }
    if (
      row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      row.verified_token_decimals !== CARTEL_FIXED_ERC20_DECIMALS
    ) {
      gaps.push("Verified decimals do not match the frozen artifact.");
    }
    if (requestedSupply === null || verifiedSupply === null || verifiedSupply !== requestedSupply) {
      gaps.push("Verified total supply does not match the requested supply.");
    }
    // The frozen artifact mints 100% of the supply once, to the recorded
    // recipient, so the verified balance must equal the full supply exactly.
    if (
      verifiedBalance === null ||
      requestedSupply === null ||
      verifiedBalance !== requestedSupply
    ) {
      gaps.push("Verified recipient balance does not equal the full requested supply.");
    }
    if (recipient === null) gaps.push("No valid initial recipient is recorded.");
  }

  const verified = gaps.length === 0;
  const state: ReceiptState = verified
    ? "VERIFIED"
    : row.status === "CONFIRMED"
      ? "EVIDENCE_INCOMPLETE"
      : receiptStateForStatus(row.status);

  // Fingerprint / init-code hash are never persisted. They come from the
  // active session simulation when it matches this exact row, otherwise they
  // are re-derived from the immutable recorded intent and labelled as such.
  let fingerprint: string | null = null;
  let initCodeHash: string | null = null;
  let fingerprintProvenance: FingerprintProvenance = "UNAVAILABLE";

  if (isToken) {
    const sim = activeSimulation ?? null;
    const simMatches =
      !!sim &&
      sim.intent.deployer === row.deployer_address.toLowerCase() &&
      sim.intent.recipient === recipient &&
      sim.intent.name === row.token_name &&
      sim.intent.symbol === row.token_symbol &&
      sim.intent.totalSupplyBaseUnits === requestedSupply;

    if (simMatches && sim) {
      fingerprint = sim.intent.fingerprint;
      initCodeHash = sim.intent.initCodeHash;
      fingerprintProvenance = "SESSION";
    } else if (recipient && row.token_name && row.token_symbol && requestedSupply) {
      try {
        const scale = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);
        const base = BigInt(requestedSupply);
        if (base % scale === 0n) {
          const rebuilt = buildSimulationIntent({
            deployer: row.deployer_address,
            name: row.token_name,
            symbol: row.token_symbol,
            supplyWhole: (base / scale).toString(),
            recipient,
          });
          if (rebuilt.totalSupplyBaseUnits === requestedSupply) {
            fingerprint = rebuilt.fingerprint;
            initCodeHash = rebuilt.initCodeHash;
            fingerprintProvenance = "RE_DERIVED";
          }
        }
      } catch {
        fingerprintProvenance = "UNAVAILABLE";
      }
    }
  }

  return {
    state,
    stateLabel: RECEIPT_STATE_LABEL[state],
    verified,
    platformStatus: row.status,
    evidenceGaps: gaps,
    // Only full verified success may assert the runtime-bytecode comparison,
    // which the server verifier performs against the frozen artifact hash.
    runtimeBytecodeVerified: verified,
    isToken,
    header: RECEIPT_HEADER,

    attemptNumber: row.attempt_number,
    attemptId: row.id,
    deploymentKind: row.deployment_kind,
    artifactId: row.artifact_id,
    chainId: row.chain_id,
    environment: row.network_environment,
    deployer: row.deployer_address,
    requestedName: isToken ? row.token_name : null,
    requestedSymbol: isToken ? row.token_symbol : null,
    requestedDecimals: isToken ? row.token_decimals : null,
    requestedSupplyBaseUnits: requestedSupply,
    requestedSupplyWhole: wholeFromBaseUnits(requestedSupply, row.token_decimals),
    recipient,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,

    txHash,
    txUrl: txHash ? explorerTxUrl(txHash) : null,
    contractAddress,
    contractUrl: contractAddress ? explorerAddressUrl(contractAddress) : null,
    blockNumber: formatBlockNumber(row.block_number),
    blockHash: safeHash(row.block_hash),
    confirmations,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    verifiedName: row.verified_token_name,
    verifiedSymbol: row.verified_token_symbol,
    verifiedDecimals: row.verified_token_decimals,
    verifiedSupplyBaseUnits: verifiedSupply,
    verifiedSupplyWhole: wholeFromBaseUnits(verifiedSupply, row.verified_token_decimals),
    verifiedRecipientBalanceBaseUnits: verifiedBalance,
    verifiedRecipientBalanceWhole: wholeFromBaseUnits(verifiedBalance, row.verified_token_decimals),
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,

    fingerprint,
    initCodeHash,
    fingerprintProvenance,
  };
}

/** Guard for display code: the testnet is the only supported environment. */
export function isTestnetReceipt(receipt: LaunchReceipt): boolean {
  return receipt.chainId === ROBINHOOD_TESTNET_CHAIN_ID && receipt.environment === "TESTNET";
}

/* ------------------------------------------------------------------ */
/* C8.5 closeout — same-tab recovery record (sessionStorage only)      */
/* ------------------------------------------------------------------ */

/**
 * A broadcast transaction whose hash could not be persisted. This is kept in
 * `sessionStorage` (never `localStorage`) so it survives a same-tab refresh
 * but never outlives the tab, and it is scoped to one workspace + launch.
 *
 * It is a client-side reminder only: no database column, table or RPC is
 * added, and restoring it can only ever re-offer the EXISTING
 * `submit_launch_chain_deployment_tx` call for the SAME attempt.
 */
export type RecoveryRecord = {
  attemptId: string;
  attemptNumber: number;
  txHash: string;
  launchId: string;
  workspaceId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_RE = /^0x[0-9a-f]{64}$/;

export function recoveryStorageKey(workspaceId: string, launchId: string): string {
  return `cartel:c85-recovery:${workspaceId}:${launchId}`;
}

/** Structural + scope validation. Returns null on anything unexpected. */
export function parseRecoveryRecord(
  value: unknown,
  scope: { workspaceId: string; launchId: string },
): RecoveryRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<RecoveryRecord>;
  if (typeof r.attemptId !== "string" || !UUID_RE.test(r.attemptId)) return null;
  if (
    typeof r.attemptNumber !== "number" ||
    !Number.isSafeInteger(r.attemptNumber) ||
    r.attemptNumber <= 0
  ) {
    return null;
  }
  if (typeof r.txHash !== "string" || !TX_HASH_RE.test(r.txHash)) return null;
  if (typeof r.launchId !== "string" || r.launchId !== scope.launchId) return null;
  if (typeof r.workspaceId !== "string" || r.workspaceId !== scope.workspaceId) return null;
  return {
    attemptId: r.attemptId,
    attemptNumber: r.attemptNumber,
    txHash: r.txHash,
    launchId: r.launchId,
    workspaceId: r.workspaceId,
  };
}

/**
 * A stored record may only be restored when the referenced attempt is still
 * exactly the row it claims to be: present in the CURRENT launch's rows, same
 * attempt number, still DRAFT and with no server-side tx hash yet. Anything
 * else is stale and must be discarded.
 */
export function isRecoveryRestorable(
  record: RecoveryRecord,
  rows: Pick<DeploymentRow, "id" | "attempt_number" | "status" | "tx_hash" | "launch_id">[],
): boolean {
  const row = rows.find((r) => r.id === record.attemptId);
  if (!row) return false;
  if (row.launch_id !== record.launchId) return false;
  if (row.attempt_number !== record.attemptNumber) return false;
  if (row.status !== "DRAFT") return false;
  if (row.tx_hash) return false;
  return true;
}

export function saveRecoveryRecord(record: RecoveryRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      recoveryStorageKey(record.workspaceId, record.launchId),
      JSON.stringify(record),
    );
  } catch {
    /* storage unavailable — the in-memory panel still shows the hash */
  }
}

export function readRecoveryRecord(scope: {
  workspaceId: string;
  launchId: string;
}): RecoveryRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(
      recoveryStorageKey(scope.workspaceId, scope.launchId),
    );
    if (!raw) return null;
    return parseRecoveryRecord(JSON.parse(raw) as unknown, scope);
  } catch {
    return null;
  }
}

export function clearRecoveryRecord(scope: { workspaceId: string; launchId: string }): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(recoveryStorageKey(scope.workspaceId, scope.launchId));
  } catch {
    /* nothing further to do */
  }
}
