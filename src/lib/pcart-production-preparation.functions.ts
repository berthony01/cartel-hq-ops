/**
 * PCART P3 — owner-only final preparation check + wallet-ready authorization.
 *
 * Read-only managed-RPC revalidation of the SAVED production draft, then (for
 * the authorize call only) the owner-only DB RPC that records a 90-second
 * preparation authorization. No send window, canary permit, arming, signing,
 * broadcast, tx-hash write or execution-control change exists here.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mainnetChain } from "@/lib/chain-mainnet-verify-shape";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import {
  PCART_PRODUCTION_CHAIN_ID,
  PCART_PRODUCTION_TREASURY_SAFE,
  buildPcartProductionInitCode,
  normalizeAddress,
  pcartProductionInitCodeHash,
  pcartProductionReviewFingerprint,
  predictPcartProductionAddress,
} from "@/lib/pcart-production-intent";

export type PcartPreparationCheck = {
  ok: true;
  deploymentId: string;
  deployer: string;
  nonce: string;
  safeRecipient: string;
  predictedAddress: string;
  initCodeHash: string;
  reviewFingerprint: string;
  gasEstimate: string;
  maxFeePerGasWei: string;
  estimatedMaxCostWei: string;
  checkedAt: number;
  executionLocked: true;
};
export type PcartPreparationCheckResult = PcartPreparationCheck | { ok: false; reason: string };

export type PcartPreparationAuthorization = {
  id: string;
  deployment_id: string;
  wallet_account: string;
  predicted_contract_address: string;
  issued_at: string;
  expires_at: string;
  cancelled_at: string | null;
};
export type PcartAuthorizeResult = { ok: true; authorization: PcartPreparationAuthorization } | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { supabase: any; userId: string };

async function revalidate(ctx: Ctx, deploymentId: string, wallet: string): Promise<PcartPreparationCheckResult> {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
  if (isOwner !== true) return fail("NOT_PLATFORM_OWNER");

  const { data: d } = await ctx.supabase
    .from("launch_chain_deployments")
    .select("id, launch_id, status, chain_id, network_environment, artifact_id, deployer_address, deployer_nonce_before, token_recipient, tx_hash, submitted_at, contract_address, init_code_hash, review_fingerprint")
    .eq("id", deploymentId)
    .maybeSingle();
  if (!d) return fail("DRAFT_NOT_FOUND");
  if (d.status !== "DRAFT" || d.tx_hash || d.submitted_at || d.contract_address) return fail("DRAFT_NOT_UNSENT");
  if (d.chain_id !== PCART_PRODUCTION_CHAIN_ID || d.network_environment !== "PRODUCTION" || d.artifact_id !== "pepecartel-token-v1") {
    return fail("DRAFT_NOT_PCART_PRODUCTION");
  }
  const safe = normalizeAddress(d.token_recipient);
  const deployer = normalizeAddress(d.deployer_address);
  if (safe !== PCART_PRODUCTION_TREASURY_SAFE || !deployer || deployer === safe) return fail("DRAFT_CHANGED");
  if (normalizeAddress(wallet) !== deployer) return fail("WRONG_ACCOUNT");
  if (d.deployer_nonce_before === null || d.deployer_nonce_before === undefined || Number(d.deployer_nonce_before) < 0) return fail("DRAFT_CHANGED");
  const savedNonce = BigInt(d.deployer_nonce_before);

  const { data: readinessRaw } = await ctx.supabase.rpc("get_canonical_pcart_production_readiness", { _launch_id: d.launch_id });
  const readiness = (readinessRaw ?? {}) as {
    canonical?: boolean;
    execution_locked?: boolean;
    approval?: { safe_address?: string; evidence_still_matches?: boolean } | null;
  };
  if (readiness.canonical !== true) return fail("NOT_CANONICAL");
  if (readiness.execution_locked !== true) return fail("EXECUTION_NOT_LOCKED");
  if (!readiness.approval || readiness.approval.evidence_still_matches !== true) return fail("APPROVAL_MISSING_OR_STALE");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: approvalRow } = await supabaseAdmin
    .from("pcart_production_readiness_approvals")
    .select("readiness_fingerprint, safe_address")
    .eq("launch_id", d.launch_id)
    .eq("artifact_id", "pepecartel-token-v1")
    .maybeSingle();
  const readinessFingerprint = String(approvalRow?.readiness_fingerprint ?? "").toLowerCase();
  if (!readinessFingerprint || normalizeAddress(approvalRow?.safe_address) !== safe) return fail("APPROVAL_MISSING_OR_STALE");

  const initCodeHash = pcartProductionInitCodeHash(safe);
  if (String(d.init_code_hash ?? "").toLowerCase() !== initCodeHash) return fail("DRAFT_CHANGED");
  const expectedFp = pcartProductionReviewFingerprint({
    launchId: String(d.launch_id),
    safeAddress: safe,
    deployer,
    nonce: savedNonce,
    initCodeHash,
    readinessFingerprint,
  });
  if (String(d.review_fingerprint ?? "").toLowerCase() !== expectedFp) return fail("DRAFT_CHANGED");

  const [{ count: windows }, { count: permits }] = await Promise.all([
    supabaseAdmin.from("launch_chain_production_send_window_issuances").select("id", { count: "exact", head: true }).eq("deployment_id", d.id),
    supabaseAdmin.from("launch_chain_production_canary_permits").select("id", { count: "exact", head: true }).eq("deployment_id", d.id),
  ]);
  if ((windows ?? 0) > 0 || (permits ?? 0) > 0) return fail("SEND_STAGE_ALREADY_EXISTS");

  const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
  if (!endpoint) return fail("MANAGED_RPC_UNCONFIGURED");
  const client = createPublicClient({ chain: mainnetChain(endpoint), transport: http(endpoint) });
  try {
    if ((await client.getChainId()) !== PCART_PRODUCTION_CHAIN_ID) return fail("CHAIN_MISMATCH");
    const addr = deployer as `0x${string}`;
    const [latest, pending] = await Promise.all([
      client.getTransactionCount({ address: addr, blockTag: "latest" }),
      client.getTransactionCount({ address: addr, blockTag: "pending" }),
    ]);
    if (latest !== pending) return fail("NONCE_PENDING");
    if (BigInt(latest) !== savedNonce) return fail("NONCE_CHANGED");
    const predictedAddress = predictPcartProductionAddress(deployer, savedNonce);
    const [predictedCode, safeCode] = await Promise.all([
      client.getCode({ address: predictedAddress as `0x${string}` }),
      client.getCode({ address: safe as `0x${string}` }),
    ]);
    if (predictedCode && predictedCode !== "0x") return fail("PREDICTED_ADDRESS_HAS_CODE");
    if (!safeCode || safeCode === "0x") return fail("SAFE_HAS_NO_CODE");
    const gasEstimate = await client.estimateGas({ account: addr, data: buildPcartProductionInitCode(safe), value: 0n });
    let maxFee: bigint;
    try {
      const fees = await client.estimateFeesPerGas();
      maxFee = fees.maxFeePerGas ?? (await client.getGasPrice());
    } catch {
      maxFee = await client.getGasPrice();
    }
    return {
      ok: true,
      deploymentId: d.id,
      deployer,
      nonce: savedNonce.toString(),
      safeRecipient: safe,
      predictedAddress,
      initCodeHash,
      reviewFingerprint: expectedFp,
      gasEstimate: gasEstimate.toString(),
      maxFeePerGasWei: maxFee.toString(),
      estimatedMaxCostWei: (gasEstimate * maxFee).toString(),
      checkedAt: Date.now(),
      executionLocked: true,
    };
  } catch {
    return fail("MANAGED_RPC_READ_FAILED");
  }
}

const validate = (input: { deploymentId: string; wallet: string }) => {
  if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) throw new Error("Invalid draft");
  const wallet = normalizeAddress(input.wallet);
  if (!wallet) throw new Error("Invalid wallet");
  return { deploymentId: input.deploymentId.toLowerCase(), wallet };
};

export const checkPcartProductionPreparation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => revalidate(context as Ctx, data.deploymentId, data.wallet));

export const authorizePcartProductionPreparation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deploymentId: string; wallet: string; clientRequestId: string; observedChainId: number; observedLatestNonce: string; observedPendingNonce: string }) => {
    const base = validate(input);
    const rid = typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";
    if (rid.length < 8 || rid.length > 128) throw new Error("Invalid request");
    if (!/^\d+$/.test(String(input.observedLatestNonce)) || !/^\d+$/.test(String(input.observedPendingNonce))) throw new Error("Invalid nonce");
    return { ...base, clientRequestId: rid, observedChainId: Number(input.observedChainId), observedLatestNonce: String(input.observedLatestNonce), observedPendingNonce: String(input.observedPendingNonce) };
  })
  .handler(async ({ data, context }): Promise<PcartAuthorizeResult> => {
    // Fresh server-side revalidation immediately before recording the authorization.
    const check = await revalidate(context as Ctx, data.deploymentId, data.wallet);
    if (!check.ok) return check;
    if (data.observedChainId !== PCART_PRODUCTION_CHAIN_ID || data.observedLatestNonce !== check.nonce || data.observedPendingNonce !== check.nonce) {
      return { ok: false, reason: "WALLET_EVIDENCE_MISMATCH" };
    }
    const { data: row, error } = await (context as Ctx).supabase.rpc("issue_canonical_pcart_production_presign_authorization", {
      _deployment_id: data.deploymentId,
      _client_request_id: data.clientRequestId,
      _wallet_account: data.wallet,
      _observed_chain_id: data.observedChainId,
      _observed_latest_nonce: Number(data.observedLatestNonce),
      _observed_pending_nonce: Number(data.observedPendingNonce),
      _predicted_contract_address: check.predictedAddress,
    });
    if (error || !row) {
      const msg = String(error?.message ?? "");
      return { ok: false, reason: error?.code === "23505" || /already active/i.test(msg) ? "ALREADY_ACTIVE" : "AUTHORIZATION_REFUSED" };
    }
    const r = row as PcartPreparationAuthorization;
    return {
      ok: true,
      authorization: {
        id: r.id,
        deployment_id: r.deployment_id,
        wallet_account: r.wallet_account,
        predicted_contract_address: r.predicted_contract_address,
        issued_at: r.issued_at,
        expires_at: r.expires_at,
        cancelled_at: r.cancelled_at,
      },
    };
  });
