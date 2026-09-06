import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPublicClient, defineChain, encodeAbiParameters, http, keccak256 } from "viem";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import {
  CARTEL_FIXED_ERC20_ABI,
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";

/**
 * P3B — PRODUCTION (Robinhood Chain 4663) deployment verifier + finality checker.
 *
 * SAFETY MODEL
 * ------------
 *  - Structurally separate from the testnet verifier. This module does NOT
 *    import `chain-verify.functions.ts`, `chain-registry.ts`, or
 *    `chain-launcher.ts`, so no testnet constant (notably the legacy fixed
 *    confirmation count) can ever leak in as authority here.
 *  - READ-ONLY. There is no signer, no wallet access, no transaction builder,
 *    no approval / liquidity path. Every chain call is an `eth_call`-class read.
 *  - The ONLY transport permitted is the server-only managed provider named by
 *    `ROBINHOOD_MAINNET_MANAGED_RPC_ENV`. The public diagnostic endpoint is
 *    deliberately NOT imported: a rate-limited public endpoint can be censored
 *    or lag, so it may never be authoritative for production evidence and may
 *    never act as a fallback. Absent managed provider => fail closed.
 *  - The managed endpoint value and raw provider error text are never returned,
 *    logged, or serialized. Callers receive deterministic non-secret codes.
 *  - Confirmations are OBSERVATIONAL ONLY. On an L2 a fixed confirmation depth
 *    is not a settlement proof; only the provider's `finalized` head is. No
 *    count anywhere in this file authorizes finality or CONFIRMED status.
 *
 * STATE-WRITE LOCK
 * ----------------
 * `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` is a local, independent lock
 * (separate from the registry's deployment/liquidity switches). While it is
 * false this module performs verification reads but mutates nothing. Enabling
 * it requires a separately authorized slice, after managed finality semantics
 * are proven live.
 */
const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const DIGITS = /^[0-9]+$/;

export type MainnetFinalityClassification =
  | "NOT_CHECKED"
  | "FINALITY_PENDING"
  | "FINALIZED_CANDIDATE"
  | "PROVIDER_INCONSISTENT";

export type MainnetVerifyResult = {
  /** Current DB status. Never promoted by this module while writes are locked. */
  status: string;
  /** Independently observed from the managed provider, never from the browser. */
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  /**
   * Diagnostic only. NEVER a gate: see the file header. Present purely for
   * display parity with the testnet console.
   */
  observationalConfirmations: number | null;
  finality: MainnetFinalityClassification;
  finalizedHeadBlockNumber: string | null;
  finalityAuthority: "MANAGED" | null;
  /** Deterministic, non-secret code. Includes retryable and mismatch codes. */
  notice: string | null;
  stateWritesEnabled: false;
};

const lower = (v: string) => v.toLowerCase();

function baseResult(status: string): MainnetVerifyResult {
  return {
    status,
    contractAddress: null,
    blockNumber: null,
    blockHash: null,
    observationalConfirmations: null,
    finality: "NOT_CHECKED",
    finalizedHeadBlockNumber: null,
    finalityAuthority: null,
    notice: null,
    stateWritesEnabled: false,
  };
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

/**
 * Rebuilds the frozen creation init code from stored intent. The transaction
 * input must equal this byte-for-byte: the browser never supplies bytecode.
 */
function buildInitCode(intent: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  recipient: `0x${string}`;
}): `0x${string}` {
  const args = encodeAbiParameters(
    [
      { type: "string", name: "name_" },
      { type: "string", name: "symbol_" },
      { type: "uint256", name: "totalSupply_" },
      { type: "address", name: "recipient_" },
    ],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

/* -------------------------------------------------------------------------
 * P3A service-role apply helpers — PRESENT BUT GUARDED OFF.
 *
 * Intended activation order in a later authorized slice:
 *   1. record PENDING mined + token evidence (production verification RPC);
 *   2. record FINALITY_PENDING / PROVIDER_INCONSISTENT / FINALIZED from
 *      managed evidence only (production finality RPC);
 *   3. only after FINALIZED, record CONFIRMED with the exact same immutable
 *      mined/token evidence.
 * All three are refused today by the local lock, before any admin import.
 * ---------------------------------------------------------------------- */

function assertStateWritesEnabled(): void {
  if (!MAINNET_VERIFICATION_STATE_WRITES_ENABLED) {
    throw new Error("STATE_WRITES_DISABLED");
  }
}

/**
 * Fail-closed bigint -> DB integer conversion. A block height outside the
 * IEEE-754 safe-integer range would silently lose precision on the way to the
 * RPC, so it is refused deterministically before any service-role call.
 */
function toSafeDbInteger(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`UNSAFE_DB_INTEGER:${field}`);
  }
  return Number(value);
}


async function applyProductionDeploymentVerification(payload: {
  deploymentId: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  observedConfirmations?: number;
  contractAddress?: string;
  blockNumber?: bigint;
  blockHash?: string;
  failureCode?: string;
  failureDetail?: string;
  verifiedToken?: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
    recipientBalance: bigint;
  };
}): Promise<void> {
  // Refuse BEFORE importing the service-role client or touching the network.
  assertStateWritesEnabled();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const args = {
    _deployment_id: payload.deploymentId,
    _status: payload.status,
    ...(payload.observedConfirmations !== undefined
      ? { _observed_confirmations: payload.observedConfirmations }
      : {}),
    ...(payload.contractAddress ? { _contract_address: payload.contractAddress } : {}),
    ...(payload.blockNumber !== undefined ? { _block_number: Number(payload.blockNumber) } : {}),
    ...(payload.blockHash ? { _block_hash: payload.blockHash } : {}),
    ...(payload.failureCode ? { _failure_code: payload.failureCode } : {}),
    ...(payload.failureDetail ? { _failure_detail: payload.failureDetail } : {}),
    ...(payload.verifiedToken
      ? {
          _verified_token_name: payload.verifiedToken.name,
          _verified_token_symbol: payload.verifiedToken.symbol,
          _verified_token_decimals: payload.verifiedToken.decimals,
          // Exact decimal strings: base units exceed IEEE-754 safe integers.
          _verified_total_supply: payload.verifiedToken.totalSupply.toString(),
          _verified_recipient_balance: payload.verifiedToken.recipientBalance.toString(),
        }
      : {}),
  } as unknown as Parameters<
    typeof supabaseAdmin.rpc<"apply_launch_chain_production_token_deployment_verification">
  >[1];

  const { error } = await supabaseAdmin.rpc(
    "apply_launch_chain_production_token_deployment_verification",
    args,
  );
  if (error) throw new Error("Verification could not be recorded");
}

async function applyProductionFinality(payload: {
  deploymentId: string;
  finalityState: "FINALITY_PENDING" | "FINALIZED" | "PROVIDER_INCONSISTENT";
  finalizedBlockNumber?: bigint;
  finalizedHeadBlockNumber?: bigint;
  finalizedBlockHashConfirmed?: boolean;
  finalityNotice?: string;
}): Promise<void> {
  // Refuse BEFORE importing the service-role client or touching the network.
  assertStateWritesEnabled();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("apply_launch_chain_production_finality", {
    _deployment_id: payload.deploymentId,
    _finality_state: payload.finalityState,
    // MANAGED is the only permitted finality authority.
    _finality_provider_kind: "MANAGED",
    ...(payload.finalizedBlockNumber !== undefined
      ? { _finalized_block_number: toSafeDbInteger(payload.finalizedBlockNumber, "finalized_block_number") }
      : {}),
    ...(payload.finalizedHeadBlockNumber !== undefined
      ? {
          _finalized_head_block_number: toSafeDbInteger(
            payload.finalizedHeadBlockNumber,
            "finalized_head_block_number",
          ),
        }
      : {}),
    ...(payload.finalizedBlockHashConfirmed !== undefined
      ? { _finalized_block_hash_confirmed: payload.finalizedBlockHashConfirmed }
      : {}),
    ...(payload.finalityNotice ? { _finality_notice: payload.finalityNotice } : {}),
  });
  if (error) throw new Error("Finality could not be recorded");
}

type VerifyInput = { deploymentId: string };

export const verifyMainnetChainDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VerifyInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    return { deploymentId: input.deploymentId };
  })
  .handler(async ({ data, context }): Promise<MainnetVerifyResult> => {
    // RLS (platform owner AND workspace operator) decides visibility. A missing
    // or cross-tenant row yields a generic error that leaks nothing.
    const { data: row, error } = await context.supabase
      .from("launch_chain_deployments")
      .select(
        "id, status, chain_id, network_environment, deployment_kind, artifact_id, deployer_address, tx_hash, confirmations, contract_address, block_number, block_hash, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient, finality_state, finalized_block_number, finalized_head_block_number, finalized_block_hash_confirmed",
      )
      .eq("id", data.deploymentId)
      .maybeSingle();

    if (error || !row) throw new Error("Not authorized");

    // Observed evidence fields stay null until this module reads them from the
    // managed provider itself. Stored DB values are never presented as
    // independently observed.
    const result = baseResult(String(row.status));

    // Safe early returns: no chain read, no write.
    if (
      row.status === "DRAFT" ||
      row.status === "ABANDONED" ||
      row.status === "FAILED" ||
      row.status === "CONFIRMED" ||
      !row.tx_hash
    ) {
      return result;
    }

    // Hard row pins. Wrong chain / environment / artifact fails closed.
    const supplyText =
      typeof row.token_total_supply_text === "string" ? row.token_total_supply_text : null;
    const recipient = typeof row.token_recipient === "string" ? lower(row.token_recipient) : null;
    const deployer = lower(String(row.deployer_address));

    if (
      Number(row.chain_id) !== ROBINHOOD_MAINNET_CHAIN_ID ||
      row.network_environment !== ROBINHOOD_MAINNET_ENVIRONMENT ||
      row.deployment_kind !== "FIXED_SUPPLY_ERC20" ||
      row.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID ||
      row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      !row.token_name ||
      !row.token_symbol ||
      supplyText === null ||
      !DIGITS.test(supplyText) ||
      recipient === null ||
      !ADDRESS.test(recipient) ||
      !ADDRESS.test(deployer)
    ) {
      throw new Error("Unsupported deployment artifact");
    }

    const txHashRaw = lower(String(row.tx_hash));
    if (!TX_HASH.test(txHashRaw)) {
      // A malformed recorded hash is never "retry later"; it is fail-closed.
      result.notice = "RECORDED_TX_HASH_MALFORMED";
      return result;
    }
    const txHash = txHashRaw as `0x${string}`;

    // MANAGED transport only. No fallback of any kind.
    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) {
      result.notice = "MANAGED_RPC_UNCONFIGURED";
      return result;
    }

    const client = createPublicClient({
      chain: mainnetChain(endpoint),
      transport: http(endpoint),
    });

    // Independently pin the managed endpoint's own chain id before any
    // evidence read. A misconfigured managed provider pointed at another
    // network must never produce production evidence. No fallback endpoint.
    let observedChainId: number | null = null;
    try {
      observedChainId = await client.getChainId();
    } catch {
      observedChainId = null;
    }
    if (observedChainId === null) {
      result.notice = "MANAGED_RPC_CHAIN_ID_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      result.notice = "MANAGED_RPC_CHAIN_MISMATCH";
      return result;
    }

    const expectedSupply = BigInt(supplyText);
    const expectedInitCode = lower(
      buildInitCode({
        name: String(row.token_name),
        symbol: String(row.token_symbol),
        totalSupply: expectedSupply,
        recipient: recipient as `0x${string}`,
      }),
    );

    // ---- Independent evidence. Nothing below originates from the browser. ----
    let tx: Awaited<ReturnType<typeof client.getTransaction>> | null = null;
    try {
      tx = await client.getTransaction({ hash: txHash });
    } catch {
      tx = null;
    }
    if (!tx) {
      // Not yet visible / provider hiccup: retryable, NEVER proof of failure.
      result.notice = "TX_NOT_VISIBLE_RETRYABLE";
      return result;
    }

    // Fatal shape checks (contract creation, zero value, correct sender).
    if (tx.to !== null && tx.to !== undefined) {
      result.notice = "MISMATCH_NOT_CONTRACT_CREATION";
      return result;
    }
    if (tx.value !== 0n) {
      result.notice = "MISMATCH_NONZERO_VALUE";
      return result;
    }
    if (lower(String(tx.from)) !== deployer) {
      result.notice = "MISMATCH_SENDER";
      return result;
    }
    if (lower(String(tx.input)) !== expectedInitCode) {
      result.notice = "MISMATCH_INIT_CODE";
      return result;
    }

    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | null = null;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      receipt = null;
    }
    if (!receipt) {
      result.notice = "RECEIPT_NOT_MINED_RETRYABLE";
      return result;
    }
    if (lower(String(receipt.transactionHash)) !== txHash) {
      result.notice = "MISMATCH_RECEIPT_TX_HASH";
      return result;
    }
    if (receipt.status !== "success") {
      result.notice = "MISMATCH_RECEIPT_REVERTED";
      return result;
    }
    const contractAddress = receipt.contractAddress ? lower(receipt.contractAddress) : null;
    if (!contractAddress || !ADDRESS.test(contractAddress)) {
      result.notice = "MISMATCH_NO_CREATED_CONTRACT";
      return result;
    }
    const receiptBlockNumber = receipt.blockNumber;
    const receiptBlockHash = receipt.blockHash ? lower(receipt.blockHash) : null;
    if (receiptBlockNumber === null || receiptBlockNumber === undefined || !receiptBlockHash) {
      result.notice = "RECEIPT_BLOCK_UNAVAILABLE_RETRYABLE";
      return result;
    }

    result.contractAddress = contractAddress;
    result.blockNumber = receiptBlockNumber.toString();
    result.blockHash = receiptBlockHash;

    // Stored mined evidence is immutable. It is compared to, never trusted
    // over, and never overwritten by this read-only module.
    if (row.contract_address && lower(String(row.contract_address)) !== contractAddress) {
      result.notice = "MISMATCH_RECORDED_CONTRACT_ADDRESS";
      return result;
    }
    if (
      row.block_number !== null &&
      row.block_number !== undefined &&
      BigInt(row.block_number) !== receiptBlockNumber
    ) {
      result.notice = "MISMATCH_RECORDED_BLOCK_NUMBER";
      return result;
    }
    if (row.block_hash && lower(String(row.block_hash)) !== receiptBlockHash) {
      result.finality = "PROVIDER_INCONSISTENT";
      result.finalityAuthority = "MANAGED";
      result.notice = "MISMATCH_RECORDED_BLOCK_HASH";
      return result;
    }

    // Re-read the deployment block by exact number: mined evidence is only
    // stable if the canonical block at that height still carries that hash.
    let minedBlockHash: string | null = null;
    try {
      const block = await client.getBlock({ blockNumber: receiptBlockNumber });
      minedBlockHash = block.hash ? lower(block.hash) : null;
    } catch {
      minedBlockHash = null;
    }
    if (!minedBlockHash) {
      result.notice = "BLOCK_READ_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (minedBlockHash !== receiptBlockHash) {
      // Immutable block-hash mismatch => reorg evidence. Fatal candidate.
      result.finality = "PROVIDER_INCONSISTENT";
      result.finalityAuthority = "MANAGED";
      result.notice = "MISMATCH_BLOCK_HASH_REORG";
      return result;
    }

    // Runtime artifact pin.
    let runtimeCode: `0x${string}` | undefined;
    try {
      runtimeCode = await client.getCode({ address: contractAddress as `0x${string}` });
    } catch {
      runtimeCode = undefined;
    }
    if (!runtimeCode || runtimeCode === "0x") {
      result.notice = "RUNTIME_CODE_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (lower(keccak256(runtimeCode)) !== lower(CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH)) {
      result.notice = "MISMATCH_RUNTIME_ARTIFACT";
      return result;
    }

    // Token state must equal stored intent exactly (bigint comparison).
    let token: {
      name: string;
      symbol: string;
      decimals: number;
      totalSupply: bigint;
      recipientBalance: bigint;
    } | null = null;
    try {
      const address = contractAddress as `0x${string}`;
      const [name, symbol, decimals, totalSupply, recipientBalance] = await Promise.all([
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "name" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "decimals" }),
        client.readContract({ address, abi: CARTEL_FIXED_ERC20_ABI, functionName: "totalSupply" }),
        client.readContract({
          address,
          abi: CARTEL_FIXED_ERC20_ABI,
          functionName: "balanceOf",
          args: [recipient as `0x${string}`],
        }),
      ]);
      token = {
        name: String(name),
        symbol: String(symbol),
        decimals: Number(decimals),
        totalSupply: BigInt(totalSupply),
        recipientBalance: BigInt(recipientBalance),
      };
    } catch {
      token = null;
    }
    if (!token) {
      result.notice = "TOKEN_READ_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (
      token.name !== String(row.token_name) ||
      token.symbol !== String(row.token_symbol) ||
      token.decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
      token.totalSupply !== expectedSupply ||
      token.recipientBalance !== expectedSupply
    ) {
      result.notice = "MISMATCH_TOKEN_STATE";
      return result;
    }

    // Observational confirmations from `latest`. DIAGNOSTIC DISPLAY ONLY —
    // deliberately computed after all evidence checks and never consulted by
    // any branch below. A depth count cannot settle an L2.
    try {
      const latest = await client.getBlockNumber();
      const diff = latest - receiptBlockNumber + 1n;
      result.observationalConfirmations = diff > 0n ? Number(diff) : 0;
    } catch {
      result.observationalConfirmations = null;
    }

    // ---- Finality: MANAGED provider `finalized` tag only. ----
    // No `safe`, no `latest - N`, no fixed confirmation count, no public
    // diagnostic endpoint, no timing heuristic.
    result.finalityAuthority = "MANAGED";
    let finalizedHead: bigint | null = null;
    try {
      const finalizedBlock = await client.getBlock({ blockTag: "finalized" });
      const n = finalizedBlock?.number;
      finalizedHead = typeof n === "bigint" && n >= 0n ? n : null;
    } catch {
      finalizedHead = null;
    }
    if (finalizedHead === null) {
      // Unsupported tag / malformed / provider error: retryable, no promotion.
      result.finality = "FINALITY_PENDING";
      result.notice = "FINALIZED_HEAD_UNAVAILABLE_RETRYABLE";
      return result;
    }
    result.finalizedHeadBlockNumber = finalizedHead.toString();

    const storedHead =
      row.finalized_head_block_number === null || row.finalized_head_block_number === undefined
        ? null
        : BigInt(row.finalized_head_block_number);
    if (storedHead !== null && finalizedHead < storedHead) {
      // A retreating finalized head is never legitimate.
      result.finality = "PROVIDER_INCONSISTENT";
      result.notice = "FINALIZED_HEAD_RETREATED";
      return result;
    }

    // Second canonical deployment-block re-read AFTER the finalized head was
    // obtained: closes the time-of-check / time-of-finality-check gap where a
    // reorg lands between the first continuity check and the head read.
    let finalityBlockHash: string | null = null;
    try {
      const reread = await client.getBlock({ blockNumber: receiptBlockNumber });
      finalityBlockHash = reread.hash ? lower(reread.hash) : null;
    } catch {
      finalityBlockHash = null;
    }
    if (!finalityBlockHash) {
      result.finality = "FINALITY_PENDING";
      result.notice = "FINALITY_BLOCK_REREAD_UNAVAILABLE_RETRYABLE";
      return result;
    }
    if (finalityBlockHash !== receiptBlockHash) {
      result.finality = "PROVIDER_INCONSISTENT";
      result.notice = "FINALITY_BLOCK_HASH_CHANGED";
      return result;
    }

    if (finalizedHead < receiptBlockNumber) {
      result.finality = "FINALITY_PENDING";
      result.notice = MAINNET_VERIFICATION_STATE_WRITES_ENABLED ? null : "STATE_WRITES_DISABLED";
      return result;
    }

    // Finalized head has passed the deployment block and the block hash still
    // matches. Under the local lock this is a CANDIDATE only: no DB promotion,
    // and never a claim of DEPLOYMENT_VERIFIED or CONFIRMED.
    result.finality = "FINALIZED_CANDIDATE";
    result.notice = MAINNET_VERIFICATION_STATE_WRITES_ENABLED ? null : "STATE_WRITES_DISABLED";
    return result;
  });

// Module-private, non-exported reference: keeps the guarded write path
// type-checked and audit-visible while the local lock keeps it unreachable.
// These helpers are deliberately NOT part of this module's public API.
const mainnetApplyHelpersInternal = {
  applyProductionDeploymentVerification,
  applyProductionFinality,
} as const;
void mainnetApplyHelpersInternal;
