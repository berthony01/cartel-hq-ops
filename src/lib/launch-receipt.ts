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
  | "FAILED"
  | "ABANDONED";

export type ReceiptFieldProvenance = "PLATFORM" | "ONCHAIN" | "DERIVED";

export type FingerprintProvenance = "SESSION" | "RE_DERIVED" | "UNAVAILABLE";

export type LaunchReceipt = {
  state: ReceiptState;
  stateLabel: string;
  /** True only when the row is CONFIRMED and the required evidence is present. */
  verified: boolean;
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
  const state = receiptStateForStatus(row.status);
  const isToken = row.deployment_kind === "FIXED_SUPPLY_ERC20";

  const txHash = safeHash(row.tx_hash);
  const contractAddress = safeAddress(row.contract_address);
  const requestedSupply = isToken ? tokenSupplyText(row) : null;
  const verifiedSupply = safeDigits(row.verified_total_supply_text);
  const verifiedBalance = safeDigits(row.verified_recipient_balance_text);
  const recipient = safeAddress(row.token_recipient);

  // A receipt may only present verified evidence when the server verifier put
  // the row in CONFIRMED and the required evidence for the kind is present.
  const tokenEvidenceComplete =
    !!row.verified_token_name &&
    !!row.verified_token_symbol &&
    row.verified_token_decimals === CARTEL_FIXED_ERC20_DECIMALS &&
    verifiedSupply !== null &&
    requestedSupply !== null &&
    verifiedSupply === requestedSupply &&
    row.verified_token_name === row.token_name &&
    row.verified_token_symbol === row.token_symbol;

  const verified =
    row.status === "CONFIRMED" &&
    contractAddress !== null &&
    txHash !== null &&
    (isToken ? tokenEvidenceComplete : true);

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
    confirmations: row.confirmations ?? 0,
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
