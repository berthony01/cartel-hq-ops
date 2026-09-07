import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import type {
  CandidateClassification,
  CandidateNotice,
  DeploymentRow,
  ReconciliationNotice,
} from "./chain-mainnet-reconciliation.helpers";
import {
  DEPLOYMENT_COLUMNS,
  HASH32,
  MANAGED_CALL_TIMEOUT_MS,
  UUID,
  deriveIntent,
  lower,
  mainnetChain,
  readManagedReceipt,
} from "./chain-mainnet-reconciliation.helpers";

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
 *
 * Result codes, the frozen intent derivation, the raw managed receipt read and
 * the local production chain descriptor live in
 * `./chain-mainnet-reconciliation.helpers` and are re-exported here unchanged
 * so that existing importers of this module are unaffected.
 */

export type {
  ReconciliationNotice,
  CandidateNotice,
  CandidateClassification,
} from "./chain-mainnet-reconciliation.helpers";

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
      return candidateFail(deploymentId, txHash, "MISMATCH_TX_HASH", "MISMATCH");
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
