import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import {
  buildSafeCreationPlan,
  decodeAbiBytes,
  evaluateSafeCreationReceipt,
  evaluateSafePreflight,
  FACTORY_GET_CHAIN_ID_CALL,
  FACTORY_PROXY_CREATION_CODE_CALL,
  predictSafeAddress,
  SAFE_CREATE_SINGLETON,
  SAFE_FALLBACK_HANDLER,
  SAFE_PROXY_FACTORY,
  type SafeCreationPlan,
  type SafePreflightResult,
} from "./treasury-safe-create";
import { type TreasurySafeVerification } from "./treasury-safe-verify";
import { parseChainId, readCanonicalSafeState, rpcCall } from "./treasury-safe-verify.functions";

/**
 * PCART treasury Safe creation — authenticated server side.
 *
 * Managed-RPC READS ONLY (eth_chainId, eth_blockNumber, eth_getCode, eth_call,
 * eth_getStorageAt, eth_getTransactionReceipt). This module never signs and
 * never sends; the single creation transaction is submitted by the user's own
 * wallet from the browser. It never reads or changes PCART token deployment
 * controls. Verified Safe evidence is persisted ONLY through the owner-only
 * `save_launch_treasury_safe_evidence` RPC, ONLY after a fresh canonical
 * verification against the saved intended owners passes at a pinned block.
 * The managed RPC URL is read inside handlers and never returned or logged.
 */

type SignerRow = {
  launch_id: string;
  signer_1: string;
  signer_2: string;
  signer_3: string;
  threshold: number;
};

type EvidenceRow = {
  safe_address: string | null;
  safe_salt_nonce: string | null;
  safe_creation_tx_hash: string | null;
  safe_verified_at: string | null;
  safe_verified_block: number | string | null;
};

type UntypedDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;

function launchIdInput(input: unknown): string {
  const id = String((input as { launchId?: unknown })?.launchId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error("A valid launch id is required.");
  return id;
}

async function loadSignerPlan(db: UntypedDb, launchId: string): Promise<SafeCreationPlan> {
  const { data, error } = await db
    .from("launch_treasury_signer_configs")
    .select("launch_id,signer_1,signer_2,signer_3,threshold")
    .eq("launch_id", launchId)
    .maybeSingle();
  if (error) throw new Error("Treasury signers could not be read.");
  const row = data as SignerRow | null;
  if (!row) throw new Error("Save the three treasury signer wallets first.");
  if (row.threshold !== 2) throw new Error("The saved signer threshold is not 2.");
  return buildSafeCreationPlan(launchId, [row.signer_1, row.signer_2, row.signer_3]);
}

function managedEndpoint(): string {
  // Server-only. Never returned, logged, or included in any error.
  const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
  if (!endpoint) throw new Error("The Robinhood Chain connection is not configured.");
  return endpoint;
}

async function pinChainAndBlock(
  endpoint: string,
): Promise<{ chainId: number | null; blockHex: string | null }> {
  const [chain, blockNumber] = await Promise.all([
    rpcCall(endpoint, "eth_chainId", []),
    rpcCall(endpoint, "eth_blockNumber", []),
  ]);
  const chainId = chain.ok ? parseChainId(chain.value) : null;
  const blockHex =
    blockNumber.ok && typeof blockNumber.value === "string" && /^0x[0-9a-fA-F]+$/.test(blockNumber.value)
      ? blockNumber.value
      : null;
  return { chainId, blockHex };
}

async function runPreflight(endpoint: string, plan: SafeCreationPlan): Promise<SafePreflightResult> {
  const { chainId, blockHex } = await pinChainAndBlock(endpoint);
  const blockNumber = blockHex ? BigInt(blockHex).toString(10) : null;
  if (chainId !== ROBINHOOD_MAINNET_CHAIN_ID || !blockHex) {
    return evaluateSafePreflight(plan, {
      observedChainId: chainId,
      blockNumber,
      singletonCode: null,
      factoryCode: null,
      fallbackHandlerCode: null,
      factoryGetChainIdData: null,
      proxyCreationCodeData: null,
      predictedAddressCode: null,
    });
  }
  const [singleton, factory, handler, factoryChain, pcc] = await Promise.all([
    rpcCall(endpoint, "eth_getCode", [SAFE_CREATE_SINGLETON, blockHex]),
    rpcCall(endpoint, "eth_getCode", [SAFE_PROXY_FACTORY, blockHex]),
    rpcCall(endpoint, "eth_getCode", [SAFE_FALLBACK_HANDLER, blockHex]),
    rpcCall(endpoint, "eth_call", [{ to: SAFE_PROXY_FACTORY, data: FACTORY_GET_CHAIN_ID_CALL }, blockHex]),
    rpcCall(endpoint, "eth_call", [{ to: SAFE_PROXY_FACTORY, data: FACTORY_PROXY_CREATION_CODE_CALL }, blockHex]),
  ]);
  const pccBytes = pcc.ok ? decodeAbiBytes(pcc.value) : null;
  const predicted = pccBytes
    ? predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), pccBytes)
    : null;
  const predictedCode = predicted
    ? await rpcCall(endpoint, "eth_getCode", [predicted, blockHex])
    : null;
  return evaluateSafePreflight(plan, {
    observedChainId: chainId,
    blockNumber,
    singletonCode: singleton.ok ? singleton.value : null,
    factoryCode: factory.ok ? factory.value : null,
    fallbackHandlerCode: handler.ok ? handler.value : null,
    factoryGetChainIdData: factoryChain.ok ? factoryChain.value : null,
    proxyCreationCodeData: pcc.ok ? pcc.value : null,
    predictedAddressCode: predictedCode && predictedCode.ok ? predictedCode.value : null,
  });
}

export type TreasurySafePreflightResponse = {
  plan: SafeCreationPlan;
  preflight: SafePreflightResult;
};

/** Read-only plan + managed-RPC preflight. Never sends. */
export const preflightTreasurySafeCreation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { launchId: string }) => ({ launchId: launchIdInput(input) }))
  .handler(async ({ data, context }): Promise<TreasurySafePreflightResponse> => {
    const db = context.supabase as unknown as UntypedDb;
    const plan = await loadSignerPlan(db, data.launchId);
    const endpoint = managedEndpoint();
    const preflight = await runPreflight(endpoint, plan);
    return { plan, preflight };
  });

export type TreasurySafeRecordResponse = {
  status: "PENDING_RECEIPT" | "RECEIPT_FAILED" | "NOT_VERIFIED" | "VERIFIED_SAVED" | "VERIFIED_SAVE_FAILED";
  predictedAddress: string | null;
  verification: TreasurySafeVerification | null;
  message: string;
};

/**
 * After the user's wallet returns (or when the predicted Safe already exists),
 * re-derive the predicted address server-side, optionally confirm the receipt,
 * run the canonical verifier with the exact saved owner set at a pinned block
 * and, only on full pass, persist the evidence through the owner-only RPC.
 * Never sends or resends anything.
 */
export const verifyAndRecordTreasurySafe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { launchId: string; txHash: string | null }) => {
    const launchId = launchIdInput(input);
    const raw = input?.txHash == null ? null : String(input.txHash).trim().toLowerCase();
    if (raw !== null && !HASH32.test(raw)) throw new Error("Invalid transaction hash.");
    return { launchId, txHash: raw };
  })
  .handler(async ({ data, context }): Promise<TreasurySafeRecordResponse> => {
    const db = context.supabase as unknown as UntypedDb;
    const plan = await loadSignerPlan(db, data.launchId);
    const endpoint = managedEndpoint();
    const { chainId, blockHex } = await pinChainAndBlock(endpoint);
    if (chainId !== ROBINHOOD_MAINNET_CHAIN_ID || !blockHex) {
      return { status: "NOT_VERIFIED", predictedAddress: null, verification: null, message: "Robinhood Chain could not be confirmed." };
    }
    const pcc = await rpcCall(endpoint, "eth_call", [
      { to: SAFE_PROXY_FACTORY, data: FACTORY_PROXY_CREATION_CODE_CALL },
      blockHex,
    ]);
    const pccBytes = pcc.ok ? decodeAbiBytes(pcc.value) : null;
    const predicted = pccBytes ? predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), pccBytes) : null;
    if (!predicted) {
      return { status: "NOT_VERIFIED", predictedAddress: null, verification: null, message: "The Safe factory's creation code did not match the official version." };
    }

    if (data.txHash) {
      const receipt = await rpcCall(endpoint, "eth_getTransactionReceipt", [data.txHash]);
      if (!receipt.ok) {
        return { status: "PENDING_RECEIPT", predictedAddress: predicted, verification: null, message: "The receipt could not be read yet. Check again shortly; nothing will be resent." };
      }
      const r = receipt.value as { status?: unknown; to?: unknown; blockNumber?: unknown } | null;
      if (r === null) {
        return { status: "PENDING_RECEIPT", predictedAddress: predicted, verification: null, message: "The transaction is not confirmed yet. Check again shortly; nothing will be resent." };
      }
      const provenance = evaluateSafeCreationReceipt(r, predicted);
      if (!provenance.ok) {
        const message =
          provenance.reason === "RECEIPT_REVERTED"
            ? "The transaction failed on chain, so no Safe was created by it. Nothing will be resent."
            : "The transaction went through, but it did not show the official Safe factory creating this Safe. Nothing was saved and nothing will be resent.";
        return { status: "RECEIPT_FAILED", predictedAddress: predicted, verification: null, message };
      }
      if (typeof r.blockNumber !== "string" || BigInt(r.blockNumber) > BigInt(blockHex)) {
        return { status: "PENDING_RECEIPT", predictedAddress: predicted, verification: null, message: "Waiting for the chain to catch up. Check again shortly." };
      }
    }

    const verification = await readCanonicalSafeState(endpoint, predicted, chainId, blockHex, plan.owners);
    if (!(verification.isCanonicalSafeV141 && verification.ownersMatchIntended === true)) {
      return { status: "NOT_VERIFIED", predictedAddress: predicted, verification, message: verification.message };
    }

    const { error } = await db.rpc("save_launch_treasury_safe_evidence", {
      _launch_id: data.launchId,
      _safe_address: predicted,
      _safe_salt_nonce: plan.saltNonce,
      _safe_creation_tx_hash: data.txHash,
      _safe_verified_block: BigInt(blockHex).toString(10),
    });
    if (error) {
      return { status: "VERIFIED_SAVE_FAILED", predictedAddress: predicted, verification, message: "The Safe was verified but could not be saved yet." };
    }
    return { status: "VERIFIED_SAVED", predictedAddress: predicted, verification, message: verification.message };
  });

export type TreasurySafeStatus = {
  schemaReady: boolean;
  persistedSafeAddress: string | null;
  persistedTxHash: string | null;
  persistedVerifiedAt: string | null;
  fresh: TreasurySafeVerification | null;
  /** Persisted address AND fresh exact verification against saved owners. */
  ready: boolean;
};

/** Readiness source: persisted evidence is never enough on its own. */
export const getTreasurySafeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { launchId: string }) => ({ launchId: launchIdInput(input) }))
  .handler(async ({ data, context }): Promise<TreasurySafeStatus> => {
    const db = context.supabase as unknown as UntypedDb;
    const empty: TreasurySafeStatus = {
      schemaReady: false,
      persistedSafeAddress: null,
      persistedTxHash: null,
      persistedVerifiedAt: null,
      fresh: null,
      ready: false,
    };
    const { data: row, error } = await db
      .from("launch_treasury_signer_configs")
      .select("signer_1,signer_2,signer_3,safe_address,safe_salt_nonce,safe_creation_tx_hash,safe_verified_at,safe_verified_block")
      .eq("launch_id", data.launchId)
      .maybeSingle();
    if (error) return empty; // evidence columns not applied yet, or no access
    const ev = row as (EvidenceRow & SignerRow) | null;
    if (!ev || !ev.safe_address) return { ...empty, schemaReady: true };
    const base = {
      schemaReady: true,
      persistedSafeAddress: ev.safe_address,
      persistedTxHash: ev.safe_creation_tx_hash,
      persistedVerifiedAt: ev.safe_verified_at,
    };
    let endpoint: string;
    try {
      endpoint = managedEndpoint();
    } catch {
      return { ...base, fresh: null, ready: false };
    }
    const { chainId, blockHex } = await pinChainAndBlock(endpoint);
    if (chainId !== ROBINHOOD_MAINNET_CHAIN_ID || !blockHex) return { ...base, fresh: null, ready: false };
    const fresh = await readCanonicalSafeState(endpoint, ev.safe_address, chainId, blockHex, [
      ev.signer_1,
      ev.signer_2,
      ev.signer_3,
    ]);
    return {
      ...base,
      fresh,
      ready: fresh.isCanonicalSafeV141 === true && fresh.ownersMatchIntended === true,
    };
  });
