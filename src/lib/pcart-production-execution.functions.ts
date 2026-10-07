/**
 * PCART P4 — owner-only FINAL SEND REVIEW + READY TO SEND permit.
 *
 * Read-only managed-RPC revalidation (reusing the P3 revalidation), builds the
 * exact unsigned CREATE envelope server-side, and — for the prepare call only —
 * records a 30-second PCART-specific permit through the owner-only DB RPC.
 * Global execution control is never changed. There is NO signing, broadcast,
 * send window, canary permit, generic presign, tx-hash write or registration.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http, keccak256 } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mainnetChain } from "@/lib/chain-mainnet-verify-shape";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { normalizeAddress } from "@/lib/pcart-production-intent";
import { revalidate } from "@/lib/pcart-production-preparation.functions";
import { attestP9_2Live } from "@/lib/pcart-p9-2-attestation.server";
import {
  buildPcartUnsignedEnvelope,
  decidePcartPermitFromFreshReview,
  pcartFinalReviewIntentFingerprint,
  pcartGasLimitFromEstimate,
  pcartMaxCostWei,
  pcartUnsignedTxFingerprint,
  PCART_FINAL_REVIEW_TTL_MS,
} from "@/lib/pcart-production-execution";

export type PcartFinalSendReview = {
  ok: true;
  deploymentId: string;
  preparationAuthorizationId: string;
  deployer: string;
  chainId: 4663;
  nonce: string;
  safeRecipient: string;
  predictedAddress: string;
  initCodeHash: string;
  envelopeDataHash: string;
  envelopeValue: "0x0";
  envelopeHasTo: false;
  gasEstimate: string;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  estimatedMaxCostWei: string;
  balanceWei: string;
  unsignedTxFingerprint: string;
  intentFingerprint: string;
  reviewFingerprint: string;
  readinessFingerprint: string;
  reviewedAt: number;
  expiresAt: number;
  globalExecutionLocked: true;
};
export type PcartFinalSendReviewResult = PcartFinalSendReview | { ok: false; reason: string };

export type PcartPrepareResult =
  | { ok: true; permit: { id: string; expires_at: string; issued_at: string; unsigned_tx_fingerprint: string } }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { supabase: any; userId: string };

async function finalReview(ctx: Ctx, deploymentId: string, authorizationId: string, wallet: string): Promise<PcartFinalSendReviewResult> {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const base = await revalidate(ctx, deploymentId, wallet);
  if (!base.ok) return base;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: d }, { data: p }, { count: presigns }] = await Promise.all([
    supabaseAdmin.from("launch_chain_deployments").select("id, launch_id").eq("id", deploymentId).maybeSingle(),
    supabaseAdmin
      .from("pcart_production_preparation_authorizations")
      .select("id, deployment_id, wallet_account, predicted_contract_address, review_fingerprint, init_code_hash, issued_at, expires_at, cancelled_at")
      .eq("id", authorizationId)
      .maybeSingle(),
    supabaseAdmin.from("launch_chain_production_presign_authorizations").select("id", { count: "exact", head: true }).eq("deployment_id", deploymentId),
  ]);
  if (!d) return fail("DRAFT_NOT_FOUND");
  const { data: approval } = await supabaseAdmin
    .from("pcart_production_readiness_approvals")
    .select("readiness_fingerprint, launch_id")
    .eq("launch_id", d.launch_id)
    .eq("artifact_id", "pepecartel-token-v1")
    .maybeSingle();
  if ((presigns ?? 0) > 0) return fail("SEND_STAGE_ALREADY_EXISTS");
  const now = Date.now();
  if (
    !p || p.deployment_id !== d.id || p.cancelled_at || Date.parse(p.expires_at) <= now ||
    normalizeAddress(p.wallet_account) !== base.deployer ||
    String(p.review_fingerprint).toLowerCase() !== base.reviewFingerprint ||
    String(p.init_code_hash).toLowerCase() !== base.initCodeHash ||
    normalizeAddress(p.predicted_contract_address) !== base.predictedAddress
  ) {
    return fail("PREPARATION_NOT_ACTIVE");
  }
  if (!approval || approval.launch_id !== d.launch_id) return fail("APPROVAL_MISSING_OR_STALE");
  const readinessFingerprint = String(approval.readiness_fingerprint).toLowerCase();

  const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
  if (!endpoint) return fail("MANAGED_RPC_UNCONFIGURED");
  const client = createPublicClient({ chain: mainnetChain(endpoint), transport: http(endpoint) });
  try {
    let maxFee: bigint;
    let maxPriority: bigint;
    try {
      const fees = await client.estimateFeesPerGas();
      if (fees.maxFeePerGas === undefined) throw new Error("legacy");
      maxFee = fees.maxFeePerGas;
      maxPriority = fees.maxPriorityFeePerGas ?? 0n;
    } catch {
      maxFee = await client.getGasPrice();
      maxPriority = 0n;
    }
    if (maxFee <= 0n || maxPriority > maxFee) return fail("FEE_UNAVAILABLE");
    const balance = await client.getBalance({ address: base.deployer as `0x${string}` });
    const gasEstimate = BigInt(base.gasEstimate);
    const gasLimit = pcartGasLimitFromEstimate(gasEstimate);
    const maxCost = pcartMaxCostWei(gasLimit, maxFee);
    if (balance < maxCost) return fail("INSUFFICIENT_BALANCE");

    const envelope = buildPcartUnsignedEnvelope(base.deployer, base.safeRecipient, gasLimit);
    if (keccak256(envelope.data) !== base.initCodeHash || "to" in envelope) return fail("DRAFT_CHANGED");
    const unsignedTxFingerprint = pcartUnsignedTxFingerprint({
      deploymentId: d.id,
      launchId: String(d.launch_id),
      from: envelope.from,
      nonce: BigInt(base.nonce),
      initCodeHash: base.initCodeHash,
      gasLimit,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriority,
      safe: base.safeRecipient,
      predicted: base.predictedAddress,
      reviewFingerprint: base.reviewFingerprint,
      readinessFingerprint,
    });
    const intentFingerprint = pcartFinalReviewIntentFingerprint({
      deploymentId: d.id,
      launchId: String(d.launch_id),
      from: envelope.from,
      nonce: BigInt(base.nonce),
      initCodeHash: base.initCodeHash,
      safe: base.safeRecipient,
      predicted: base.predictedAddress,
      reviewFingerprint: base.reviewFingerprint,
      readinessFingerprint,
    });
    return {
      ok: true,
      deploymentId: d.id,
      preparationAuthorizationId: p.id,
      deployer: base.deployer,
      chainId: 4663,
      nonce: base.nonce,
      safeRecipient: base.safeRecipient,
      predictedAddress: base.predictedAddress,
      initCodeHash: base.initCodeHash,
      envelopeDataHash: keccak256(envelope.data),
      envelopeValue: envelope.value,
      envelopeHasTo: false,
      gasEstimate: gasEstimate.toString(),
      gasLimit: gasLimit.toString(),
      maxFeePerGasWei: maxFee.toString(),
      maxPriorityFeePerGasWei: maxPriority.toString(),
      estimatedMaxCostWei: maxCost.toString(),
      balanceWei: balance.toString(),
      unsignedTxFingerprint,
      intentFingerprint,
      reviewFingerprint: base.reviewFingerprint,
      readinessFingerprint,
      reviewedAt: now,
      expiresAt: now + PCART_FINAL_REVIEW_TTL_MS,
      globalExecutionLocked: true,
    };
  } catch {
    return fail("MANAGED_RPC_READ_FAILED");
  }
}

const validate = (input: { deploymentId: string; preparationAuthorizationId: string; wallet: string }) => {
  if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) throw new Error("Invalid draft");
  if (typeof input.preparationAuthorizationId !== "string" || !UUID.test(input.preparationAuthorizationId)) throw new Error("Invalid preparation");
  const wallet = normalizeAddress(input.wallet);
  if (!wallet) throw new Error("Invalid wallet");
  return { deploymentId: input.deploymentId.toLowerCase(), preparationAuthorizationId: input.preparationAuthorizationId.toLowerCase(), wallet };
};

export const reviewPcartFinalSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => finalReview(context as Ctx, data.deploymentId, data.preparationAuthorizationId, data.wallet));

export const preparePcartFinalSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deploymentId: string; preparationAuthorizationId: string; wallet: string; reviewedIntentFingerprint: string; typedPredictedAddress: string }) => {
    const base = validate(input);
    const fp = String(input.reviewedIntentFingerprint ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(fp)) throw new Error("Invalid review");
    return { ...base, reviewedIntentFingerprint: fp, typedPredictedAddress: String(input.typedPredictedAddress ?? "") };
  })
  .handler(async ({ data, context }): Promise<PcartPrepareResult> => {
    // Fresh server-side review immediately before issuing the permit.
    const r = await finalReview(context as Ctx, data.deploymentId, data.preparationAuthorizationId, data.wallet);
    if (!r.ok) return r;
    // Stable deployment intent must be unchanged; normal fee/gas drift is allowed and the
    // permit is bound to the FRESH fee-bound unsigned fingerprint (DB recomputes it exactly).
    const decision = decidePcartPermitFromFreshReview(r, data.reviewedIntentFingerprint, data.typedPredictedAddress);
    if (!decision.ok) return decision;
    // P9.2: owner check + fresh server-side live re-attestation, then the bound (service-role-only) RPC.
    const ctx = context as Ctx;
    const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
    if (isOwner !== true) return { ok: false, reason: "NOT_PLATFORM_OWNER" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dep } = await supabaseAdmin.from("launch_chain_deployments").select("launch_id").eq("id", r.deploymentId).maybeSingle();
    if (!dep) return { ok: false, reason: "DRAFT_NOT_FOUND" };
    const att = await attestP9_2Live(String(dep.launch_id));
    if (!att.ok) return { ok: false, reason: `LIVE_ATTESTATION_${att.reason}` };
    const { data: row, error } = await (supabaseAdmin as any).rpc("issue_canonical_pcart_execution_permit_v2", {
      _actor: ctx.userId,
      _deployment_id: r.deploymentId,
      _preparation_authorization_id: r.preparationAuthorizationId,
      _unsigned_tx_fingerprint: decision.unsignedTxFingerprint,
      _gas_limit: Number(decision.gasLimit),
      _max_fee_per_gas: decision.maxFeePerGasWei,
      _max_priority_fee_per_gas: decision.maxPriorityFeePerGasWei,
      _dependency_attestation_fingerprint: att.dependencyFingerprint,
      _safe_nonce: att.safeNonce,
      _safe_attestation_fingerprint: att.safeFingerprint,
    });
    if (error || !row) {
      const msg = String(error?.message ?? "");
      return { ok: false, reason: error?.code === "23505" || /already active/i.test(msg) ? "ALREADY_ACTIVE" : "PERMIT_REFUSED" };
    }
    return { ok: true, permit: { id: row.id, issued_at: row.issued_at, expires_at: row.expires_at, unsigned_tx_fingerprint: row.unsigned_tx_fingerprint } };
  });
