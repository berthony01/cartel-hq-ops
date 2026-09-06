import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, defineChain, encodeAbiParameters, http, keccak256, stringToHex } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";

/**
 * P3C-D2 — Robinhood Chain PRODUCTION (4663) RECONCILIATION EVIDENCE (read-only).
 *
 * SCOPE AND SAFETY
 * ----------------
 * Two authenticated server functions, both strictly observational:
 *
 *   1. `getMainnetDeploymentReconciliationSnapshot` — authoritative incident
 *      snapshot for ONE production deployment: deployment evidence, the FULL
 *      pre-sign authorization history with a derived effective-expiry marker,
 *      every durable final-send-window issuance, the runtime execution control
 *      singleton, its immutable event history, and a deterministic high-level
 *      classification. The RPC behind it performs no mutation.
 *
 *   2. `verifyMainnetCandidateTransaction` — managed-provider observation of a
 *      CANDIDATE transaction hash after an ambiguous send. It answers only
 *      "was the exact frozen production intent broadcast, and what happened to
 *      it". It NEVER persists the candidate hash and never promotes state.
 *
 * Deliberate omissions — absence, not a flag, is the safety property:
 *   - No database write of any kind. No RPC in this file mutates.
 *   - No signer, wallet, browser provider, transaction builder, send, retry,
 *     rebroadcast, or cancellation path.
 *   - No verifier apply, finality promotion, lifecycle transition,
 *     official-contract registration, notification, Telegram, or liquidity.
 *   - No testnet import; no public diagnostic RPC fallback. The managed
 *     endpoint is read by NAME inside the handler and is never returned,
 *     logged, or serialized.
 *
 * A reverted exact-intent transaction is still proof the exact transaction was
 * broadcast. It must never be reported as "no send". Provider silence is a
 * retryable observation, never proof of non-broadcast.
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


/** JSON-serializable snapshot payload returned verbatim from the read-only RPC. */
export type ReconciliationJson =
  | string
  | number
  | boolean
  | null
  | ReconciliationJson[]
  | { [key: string]: ReconciliationJson };

export type MainnetReconciliationSnapshotResult = {
  ok: boolean;
  notice: ReconciliationNotice | null;
  deploymentId: string;
  snapshot: ReconciliationJson | null;
};

export type MainnetCandidateVerificationResult = {
  ok: boolean;
  notice: CandidateNotice | null;
  classification: CandidateClassification;
  deploymentId: string;
  txHash: string;
  /** True only when sender, creation shape, zero value and init code all match. */
  exactIntentObserved: boolean;
  receiptStatus: "SUCCESS" | "REVERTED" | null;
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  /** Canonical block re-read by exact number. Evidence only — NOT finality. */
  blockHashConsistent: boolean | null;
  /** Always false. This module can never persist anything. */
  persisted: false;
};

/* ------------------------------------------------------------------ */
/* Frozen pure helpers — byte-identical intent reconstruction          */
/* ------------------------------------------------------------------ */

const FINGERPRINT_DOMAIN = "cartel-mainnet-sim-v1";
const FIELD_SEPARATOR = "\u001f";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;
const TOKEN_NAME = /^[\x20-\x7e]{1,32}$/;
const TOKEN_SYMBOL = /^[A-Z0-9]{2,11}$/;
const BASE_UNIT_SCALE = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);
const MANAGED_CALL_TIMEOUT_MS = 8_000;
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;

function lower(value: string): string {
  return value.trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Managed receipt read — provider failure is NEVER "unmined"          */
/* ------------------------------------------------------------------ */

type RawReceipt = {
  transactionHash: string;
  status: "0x0" | "0x1";
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
};

type ReceiptRead =
  /** Provider answered successfully and positively reported no receipt. */
  | { kind: "ABSENT" }
  /** Provider answered with a structurally valid receipt. */
  | { kind: "PRESENT"; receipt: RawReceipt }
  /** Transport/timeout/JSON-RPC error. Retryable — NOT proof of unmined. */
  | { kind: "UNAVAILABLE" }
  /** Successful transport but unusable payload. Retryable, never mined. */
  | { kind: "MALFORMED" };

function parseRawReceipt(value: unknown): ReceiptRead {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "MALFORMED" };
  const raw = value as Record<string, unknown>;

  const transactionHash = typeof raw.transactionHash === "string" ? lower(raw.transactionHash) : "";
  if (!HASH32.test(transactionHash)) return { kind: "MALFORMED" };

  const status = typeof raw.status === "string" ? lower(raw.status) : "";
  if (status !== "0x0" && status !== "0x1") return { kind: "MALFORMED" };

  let contractAddress: string | null = null;
  if (raw.contractAddress !== null && raw.contractAddress !== undefined) {
    if (typeof raw.contractAddress !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw.contractAddress);
    if (!ADDRESS.test(candidate)) return { kind: "MALFORMED" };
    contractAddress = candidate;
  }

  let blockNumber: string | null = null;
  if (raw.blockNumber !== null && raw.blockNumber !== undefined) {
    if (typeof raw.blockNumber !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw.blockNumber);
    if (!QUANTITY.test(candidate)) return { kind: "MALFORMED" };
    blockNumber = candidate;
  }

  let blockHash: string | null = null;
  if (raw.blockHash !== null && raw.blockHash !== undefined) {
    if (typeof raw.blockHash !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw.blockHash);
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
async function readManagedReceipt(endpoint: string, txHash: string): Promise<ReceiptRead> {
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
    if (body.error !== null && body.error !== undefined) return { kind: "UNAVAILABLE" };
    if (!("result" in body)) return { kind: "UNAVAILABLE" };
    if (body.result === null) return { kind: "ABSENT" };
    return parseRawReceipt(body.result);
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
function mainnetChain(rpcUrl: string) {
  return defineChain({
    id: ROBINHOOD_MAINNET_CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

type DeploymentRow = {
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

const DEPLOYMENT_COLUMNS =
  "id, workspace_id, launch_id, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, review_fingerprint, init_code_hash, status, tx_hash";

type IntentDerivation = {
  deployer: string;
  initCode: `0x${string}`;
  initCodeHash: string;
  fingerprint: string;
};

/**
 * Independent reconstruction from stored immutable intent + the frozen
 * artifact. Browser calldata, sender, recipient and economics are never used.
 */
function deriveIntent(row: DeploymentRow): IntentDerivation | CandidateNotice {
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

/* ------------------------------------------------------------------ */
/* 1. Read-only reconciliation snapshot                                */
/* ------------------------------------------------------------------ */

function snapshotFail(
  deploymentId: string,
  notice: ReconciliationNotice,
): MainnetReconciliationSnapshotResult {
  return { ok: false, notice, deploymentId, snapshot: null };
}

export const getMainnetDeploymentReconciliationSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deploymentId: string }) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    return { deploymentId: input.deploymentId };
  })
  .handler(async ({ data, context }): Promise<MainnetReconciliationSnapshotResult> => {
    const { deploymentId } = data;

    // Tenancy first, through the caller's own RLS-bound client.
    const { data: rawDeployment, error: deploymentError } = await context.supabase
      .from("launch_chain_deployments")
      .select("id, chain_id, network_environment")
      .eq("id", deploymentId)
      .maybeSingle();

    if (deploymentError || !rawDeployment) return snapshotFail(deploymentId, "NOT_AUTHORIZED");

    const row = rawDeployment as unknown as {
      chain_id: number;
      network_environment: string;
    };
    if (
      row.chain_id !== ROBINHOOD_MAINNET_CHAIN_ID ||
      row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT
    ) {
      return snapshotFail(deploymentId, "UNSUPPORTED_DEPLOYMENT");
    }

    // Only now go privileged, and only to call the read-only snapshot RPC.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: snapshot, error: snapshotError } = await supabaseAdmin.rpc(
      "get_launch_chain_production_reconciliation_snapshot",
      { _deployment_id: deploymentId, _operator_user_id: context.userId },
    );

    if (snapshotError) {
      // Raw DB text never escapes.
      const code = (snapshotError as { code?: string }).code;
      return snapshotFail(deploymentId, code === "42501" ? "NOT_AUTHORIZED" : "SNAPSHOT_UNAVAILABLE");
    }
    if (!snapshot || typeof snapshot !== "object") {
      return snapshotFail(deploymentId, "SNAPSHOT_UNAVAILABLE");
    }

    return { ok: true, notice: null, deploymentId, snapshot: snapshot as ReconciliationJson };
  });

/* ------------------------------------------------------------------ */
/* 2. Managed candidate transaction verification (observation only)    */
/* ------------------------------------------------------------------ */

function candidateBase(
  deploymentId: string,
  txHash: string,
): MainnetCandidateVerificationResult {
  return {
    ok: false,
    notice: null,
    classification: "REFUSED",
    deploymentId,
    txHash,
    exactIntentObserved: false,
    receiptStatus: null,
    contractAddress: null,
    blockNumber: null,
    blockHash: null,
    blockHashConsistent: null,
    persisted: false,
  };
}

function candidateFail(
  deploymentId: string,
  txHash: string,
  notice: CandidateNotice,
  classification: CandidateClassification,
): MainnetCandidateVerificationResult {
  return { ...candidateBase(deploymentId, txHash), notice, classification };
}

export const verifyMainnetCandidateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deploymentId: string; txHash: string }) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    if (typeof input.txHash !== "string") throw new Error("Invalid transaction hash");
    return { deploymentId: input.deploymentId, txHash: input.txHash };
  })
  .handler(async ({ data, context }): Promise<MainnetCandidateVerificationResult> => {
    const { deploymentId } = data;
    const txHash = lower(data.txHash);

    if (!HASH32.test(txHash)) {
      return candidateFail(deploymentId, txHash, "INVALID_TX_HASH", "REFUSED");
    }

    // Tenancy first, through the caller's own RLS-bound client.
    const { data: rawDeployment, error: deploymentError } = await context.supabase
      .from("launch_chain_deployments")
      .select(DEPLOYMENT_COLUMNS)
      .eq("id", deploymentId)
      .maybeSingle();

    if (deploymentError || !rawDeployment) {
      return candidateFail(deploymentId, txHash, "NOT_AUTHORIZED", "REFUSED");
    }
    const deployment = rawDeployment as unknown as DeploymentRow;

    // Independent reconstruction. Nothing from the browser is trusted.
    const derived = deriveIntent(deployment);
    if (typeof derived === "string") {
      return candidateFail(deploymentId, txHash, derived, "REFUSED");
    }

    // Managed endpoint only. No public diagnostic fallback, ever.
    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) {
      return candidateFail(deploymentId, txHash, "MANAGED_RPC_NOT_CONFIGURED", "REFUSED");
    }

    const client = createPublicClient({
      chain: mainnetChain(endpoint),
      transport: http(endpoint, { timeout: MANAGED_CALL_TIMEOUT_MS, retryCount: 0 }),
    });

    // Pin the chain before reading anything else.
    let observedChainId: number | null = null;
    try {
      observedChainId = await client.getChainId();
    } catch {
      observedChainId = null;
    }
    if (observedChainId === null) {
      return candidateFail(
        deploymentId,
        txHash,
        "MANAGED_RPC_UNAVAILABLE_RETRYABLE",
        "NOT_VISIBLE_RETRYABLE",
      );
    }
    if (observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      return candidateFail(deploymentId, txHash, "MANAGED_RPC_CHAIN_MISMATCH", "REFUSED");
    }

    const result = candidateBase(deploymentId, txHash);

    let tx: Awaited<ReturnType<typeof client.getTransaction>> | null = null;
    try {
      tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    } catch {
      tx = null;
    }
    if (!tx) {
      // Provider silence is NEVER proof that nothing was sent.
      return candidateFail(deploymentId, txHash, "NOT_VISIBLE_RETRYABLE", "NOT_VISIBLE_RETRYABLE");
    }

    if (lower(String(tx.hash)) !== txHash) {
      return candidateFail(deploymentId, txHash, "MISMATCH_RECEIPT_TX_HASH", "MISMATCH");
    }
    if (tx.to !== null && tx.to !== undefined) {
      return candidateFail(deploymentId, txHash, "MISMATCH_NOT_CONTRACT_CREATION", "MISMATCH");
    }
    if (tx.value !== 0n) {
      return candidateFail(deploymentId, txHash, "MISMATCH_NONZERO_VALUE", "MISMATCH");
    }
    if (lower(String(tx.from)) !== derived.deployer) {
      return candidateFail(deploymentId, txHash, "MISMATCH_SENDER", "MISMATCH");
    }
    if (lower(String(tx.input)) !== lower(derived.initCode)) {
      return candidateFail(deploymentId, txHash, "MISMATCH_INIT_CODE", "MISMATCH");
    }

    // From here the EXACT frozen production intent is proven broadcast.
    result.exactIntentObserved = true;

    // Receipt lookup via the same managed endpoint, read raw so that a
    // provider failure can never be confused with "positively no receipt".
    const receiptRead = await readManagedReceipt(endpoint, txHash);

    if (receiptRead.kind === "UNAVAILABLE") {
      return {
        ...candidateFail(
          deploymentId,
          txHash,
          "RECEIPT_UNAVAILABLE_RETRYABLE",
          "RECEIPT_UNAVAILABLE_RETRYABLE",
        ),
        exactIntentObserved: true,
      };
    }
    if (receiptRead.kind === "MALFORMED") {
      return {
        ...candidateFail(
          deploymentId,
          txHash,
          "RECEIPT_MALFORMED_RETRYABLE",
          "RECEIPT_UNAVAILABLE_RETRYABLE",
        ),
        exactIntentObserved: true,
      };
    }
    if (receiptRead.kind === "ABSENT") {
      // Provider answered successfully with result: null — genuinely unmined.
      result.ok = true;
      result.notice = "EXACT_INTENT_UNMINED";
      result.classification = "EXACT_INTENT_UNMINED";
      return result;
    }

    const receipt = receiptRead.receipt;
    if (receipt.transactionHash !== txHash) {
      return {
        ...candidateFail(deploymentId, txHash, "MISMATCH_RECEIPT_TX_HASH", "MISMATCH"),
        exactIntentObserved: true,
      };
    }

    const succeeded = receipt.status === "0x1";
    result.receiptStatus = succeeded ? "SUCCESS" : "REVERTED";
    result.contractAddress = receipt.contractAddress;

    const receiptBlockNumber = receipt.blockNumber === null ? null : BigInt(receipt.blockNumber);
    const receiptBlockHash = receipt.blockHash;
    result.blockNumber = receiptBlockNumber === null ? null : receiptBlockNumber.toString();
    result.blockHash = receiptBlockHash;

    // Canonical re-read by exact block number. Reconciliation evidence only:
    // this is NOT finality and never promotes verifier state.
    if (receiptBlockNumber !== null && receiptBlockHash !== null) {
      try {
        const block = await client.getBlock({ blockNumber: receiptBlockNumber });
        const canonicalHash = block?.hash ? lower(String(block.hash)) : null;
        result.blockHashConsistent = canonicalHash === null ? null : canonicalHash === receiptBlockHash;
      } catch {
        result.blockHashConsistent = null;
      }
    }


    // A revert is still proof of broadcast. It is never reported as "no send".
    result.ok = true;
    result.notice = succeeded ? "EXACT_INTENT_MINED_SUCCESS" : "EXACT_INTENT_MINED_REVERTED";
    result.classification = succeeded ? "EXACT_INTENT_MINED_SUCCESS" : "EXACT_INTENT_MINED_REVERTED";
    return result;
  });
