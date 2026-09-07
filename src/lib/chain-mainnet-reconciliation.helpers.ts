import { defineChain, encodeAbiParameters, keccak256, stringToHex } from "viem";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_MAINNET_ENVIRONMENT } from "./chain-mainnet-registry";

/**
 * P3C-D2 reconciliation support module — result codes, frozen pure intent
 * derivation, the raw managed receipt read and the local production chain
 * descriptor, extracted verbatim from `chain-mainnet-reconciliation.functions.ts`
 * for file-size hygiene only.
 *
 * Behaviour is unchanged and remains strictly observational: no write, no
 * signer, no rebroadcast, no testnet import, no public diagnostic fallback.
 * The managed endpoint is always supplied by the caller and never returned,
 * logged or serialized.
 */

/* ------------------------------------------------------------------ */
/* Deterministic, non-leaking codes                                    */
/* ------------------------------------------------------------------ */

export type ReconciliationNotice =
  | "NOT_AUTHORIZED"
  | "UNSUPPORTED_DEPLOYMENT"
  | "SNAPSHOT_UNAVAILABLE";

export type CandidateNotice =
  | "NOT_AUTHORIZED"
  | "UNSUPPORTED_DEPLOYMENT"
  | "INVALID_TX_HASH"
  | "INIT_CODE_HASH_MISMATCH"
  | "INTENT_FINGERPRINT_MISMATCH"
  | "MANAGED_RPC_NOT_CONFIGURED"
  | "MANAGED_RPC_UNAVAILABLE_RETRYABLE"
  | "MANAGED_RPC_CHAIN_MISMATCH"
  | "NOT_VISIBLE_RETRYABLE"
  | "MISMATCH_NOT_CONTRACT_CREATION"
  | "MISMATCH_NONZERO_VALUE"
  | "MISMATCH_SENDER"
  | "MISMATCH_INIT_CODE"
  | "MISMATCH_TX_HASH"
  | "MISMATCH_RECEIPT_TX_HASH"
  | "RECEIPT_UNAVAILABLE_RETRYABLE"
  | "RECEIPT_MALFORMED_RETRYABLE"
  | "EXACT_INTENT_UNMINED"
  | "EXACT_INTENT_MINED_SUCCESS"
  | "EXACT_INTENT_MINED_REVERTED";

export type CandidateClassification =
  | "NOT_VISIBLE_RETRYABLE"
  | "RECEIPT_UNAVAILABLE_RETRYABLE"
  | "EXACT_INTENT_UNMINED"
  | "EXACT_INTENT_MINED_SUCCESS"
  | "EXACT_INTENT_MINED_REVERTED"
  | "MISMATCH"
  | "REFUSED";

/* ------------------------------------------------------------------ */
/* Frozen pure helpers — byte-identical intent reconstruction          */
/* ------------------------------------------------------------------ */

const FINGERPRINT_DOMAIN = "cartel-mainnet-sim-v1";
const FIELD_SEPARATOR = "\u001f";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
export const HASH32 = /^0x[0-9a-f]{64}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;
const TOKEN_NAME = /^[\x20-\x7e]{1,32}$/;
const TOKEN_SYMBOL = /^[A-Z0-9]{2,11}$/;
const BASE_UNIT_SCALE = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);
export const MANAGED_CALL_TIMEOUT_MS = 8_000;
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;

export function lower(value: string): string {
  return value.trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Managed receipt read — provider failure is NEVER "unmined"          */
/* ------------------------------------------------------------------ */

export type RawReceipt = {
  transactionHash: string;
  status: "0x0" | "0x1";
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
};

export type ReceiptRead =
  /** Provider answered successfully and positively reported no receipt. */
  | { kind: "ABSENT" }
  /** Provider answered with a structurally valid receipt. */
  | { kind: "PRESENT"; receipt: RawReceipt }
  /** Transport/timeout/JSON-RPC error. Retryable — NOT proof of unmined. */
  | { kind: "UNAVAILABLE" }
  /** Successful transport but unusable payload. Retryable, never mined. */
  | { kind: "MALFORMED" };

export function parseRawReceipt(value: unknown): ReceiptRead {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "MALFORMED" };
  const raw = value as Record<string, unknown>;

  const transactionHash = typeof raw["transactionHash"] === "string" ? lower(raw["transactionHash"]) : "";
  if (!HASH32.test(transactionHash)) return { kind: "MALFORMED" };

  const status = typeof raw["status"] === "string" ? lower(raw["status"]) : "";
  if (status !== "0x0" && status !== "0x1") return { kind: "MALFORMED" };

  let contractAddress: string | null = null;
  if (raw["contractAddress"] !== null && raw["contractAddress"] !== undefined) {
    if (typeof raw["contractAddress"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["contractAddress"]);
    if (!ADDRESS.test(candidate)) return { kind: "MALFORMED" };
    contractAddress = candidate;
  }

  let blockNumber: string | null = null;
  if (raw["blockNumber"] !== null && raw["blockNumber"] !== undefined) {
    if (typeof raw["blockNumber"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["blockNumber"]);
    if (!QUANTITY.test(candidate)) return { kind: "MALFORMED" };
    blockNumber = candidate;
  }

  let blockHash: string | null = null;
  if (raw["blockHash"] !== null && raw["blockHash"] !== undefined) {
    if (typeof raw["blockHash"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["blockHash"]);
    if (!HASH32.test(candidate)) return { kind: "MALFORMED" };
    blockHash = candidate;
  }

  return {
    kind: "PRESENT",
    receipt: { transactionHash, status: status as "0x0" | "0x1", contractAddress, blockNumber, blockHash },
  };
}

/**
 * Raw managed `eth_getTransactionReceipt`. The ONLY way this reports "no
 * receipt" is a successful JSON-RPC response carrying `result: null`. Any
 * transport, timeout, HTTP or JSON-RPC error is UNAVAILABLE (retryable).
 * Raw provider text and the endpoint never escape this function.
 */
export async function readManagedReceipt(endpoint: string, txHash: string): Promise<ReceiptRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANAGED_CALL_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "UNAVAILABLE" };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "UNAVAILABLE" };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "UNAVAILABLE" };
    }
    const body = payload as Record<string, unknown>;
    if (body["error"] !== null && body["error"] !== undefined) return { kind: "UNAVAILABLE" };
    if (!("result" in body)) return { kind: "UNAVAILABLE" };
    if (body["result"] === null) return { kind: "ABSENT" };
    return parseRawReceipt(body["result"]);
  } catch {
    return { kind: "UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

/** Canonical P2 fingerprint pre-image. 14 fields, trailing tx value "0". */
function fingerprintPreimage(fields: {
  deployer: string;
  recipient: string;
  name: string;
  symbol: string;
  supplyWhole: string;
  totalSupplyBaseUnits: string;
  initCodeHash: string;
}): string {
  return [
    FINGERPRINT_DOMAIN,
    ROBINHOOD_MAINNET_ENVIRONMENT,
    String(ROBINHOOD_MAINNET_CHAIN_ID),
    CARTEL_FIXED_ERC20_ARTIFACT_ID,
    CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH.toLowerCase(),
    fields.deployer.toLowerCase(),
    fields.recipient.toLowerCase(),
    fields.name.normalize("NFC"),
    fields.symbol.normalize("NFC"),
    String(CARTEL_FIXED_ERC20_DECIMALS),
    fields.supplyWhole,
    fields.totalSupplyBaseUnits,
    fields.initCodeHash.toLowerCase(),
    "0",
  ].join(FIELD_SEPARATOR);
}

/** Frozen creation bytecode + ABI-encoded constructor args. */
function buildInitCode(intent: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  recipient: string;
}): `0x${string}` {
  const args = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient as `0x${string}`],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

/** Production chain descriptor built locally; no testnet registry import. */
export function mainnetChain(rpcUrl: string) {
  return defineChain({
    id: ROBINHOOD_MAINNET_CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export type DeploymentRow = {
  id: string;
  workspace_id: string;
  launch_id: string;
  chain_id: number;
  network_environment: string;
  deployment_kind: string;
  artifact_id: string | null;
  deployer_address: string;
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  token_total_supply_text: string | null;
  token_recipient: string | null;
  review_fingerprint: string | null;
  init_code_hash: string | null;
  status: string;
  tx_hash: string | null;
};

export const DEPLOYMENT_COLUMNS =
  "id, workspace_id, launch_id, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, review_fingerprint, init_code_hash, status, tx_hash";

export type IntentDerivation = {
  deployer: string;
  initCode: `0x${string}`;
  initCodeHash: string;
  fingerprint: string;
};

/**
 * Independent reconstruction from stored immutable intent + the frozen
 * artifact. Browser calldata, sender, recipient and economics are never used.
 */
export function deriveIntent(row: DeploymentRow): IntentDerivation | CandidateNotice {
  const deployer = typeof row.deployer_address === "string" ? lower(row.deployer_address) : "";
  const recipient = typeof row.token_recipient === "string" ? lower(row.token_recipient) : "";
  const supplyText =
    typeof row.token_total_supply_text === "string" ? row.token_total_supply_text.trim() : "";
  const storedInitCodeHash = typeof row.init_code_hash === "string" ? lower(row.init_code_hash) : "";
  const storedFingerprint =
    typeof row.review_fingerprint === "string" ? lower(row.review_fingerprint) : "";
  const tokenName = typeof row.token_name === "string" ? row.token_name : "";
  const tokenSymbol = typeof row.token_symbol === "string" ? row.token_symbol : "";

  if (
    row.chain_id !== ROBINHOOD_MAINNET_CHAIN_ID ||
    row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT ||
    row.deployment_kind !== "FIXED_SUPPLY_ERC20" ||
    row.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID ||
    !ADDRESS.test(deployer) ||
    deployer === ZERO_ADDRESS ||
    !ADDRESS.test(recipient) ||
    recipient === ZERO_ADDRESS ||
    row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
    !TOKEN_NAME.test(tokenName) ||
    !TOKEN_SYMBOL.test(tokenSymbol) ||
    !DIGITS.test(supplyText) ||
    !HASH32.test(storedFingerprint) ||
    !HASH32.test(storedInitCodeHash)
  ) {
    return "UNSUPPORTED_DEPLOYMENT";
  }

  const totalSupplyBaseUnits = BigInt(supplyText);
  if (totalSupplyBaseUnits <= 0n || totalSupplyBaseUnits % BASE_UNIT_SCALE !== 0n) {
    return "UNSUPPORTED_DEPLOYMENT";
  }
  const supplyWhole = totalSupplyBaseUnits / BASE_UNIT_SCALE;

  const initCode = buildInitCode({
    name: tokenName,
    symbol: tokenSymbol,
    totalSupply: totalSupplyBaseUnits,
    recipient,
  });
  const initCodeHash = lower(keccak256(initCode));
  if (initCodeHash !== storedInitCodeHash) return "INIT_CODE_HASH_MISMATCH";

  const fingerprint = lower(
    keccak256(
      stringToHex(
        fingerprintPreimage({
          deployer,
          recipient,
          name: tokenName,
          symbol: tokenSymbol,
          supplyWhole: supplyWhole.toString(),
          totalSupplyBaseUnits: totalSupplyBaseUnits.toString(),
          initCodeHash,
        }),
      ),
    ),
  );
  if (fingerprint !== storedFingerprint) return "INTENT_FINGERPRINT_MISMATCH";

  return { deployer, initCode, initCodeHash, fingerprint };
}
