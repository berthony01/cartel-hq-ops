/**
 * PCART P2 — owner-only READ-ONLY production review over the managed
 * Robinhood Chain RPC. No signing, no broadcast, no wallet, no DB writes.
 *
 * Only read methods are used: eth_chainId, eth_getTransactionCount,
 * eth_getCode, eth_estimateGas, eth_call, eth_feeHistory/gasPrice.
 * The managed RPC URL is read inside the handler and never returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mainnetChain } from "@/lib/chain-mainnet-verify-shape";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { PEPECARTEL_TOKEN_ARTIFACT_ID } from "@/lib/pepecartel-token.artifact";
import {
  PCART_PRODUCTION_CHAIN_ID,
  PCART_PRODUCTION_REVIEW_TTL_MS,
  PCART_PRODUCTION_TREASURY_SAFE,
  buildPcartProductionInitCode,
  isAllowedPcartDeployer,
  normalizeAddress,
  pcartProductionInitCodeHash,
  pcartProductionReviewFingerprint,
  predictPcartProductionAddress,
} from "@/lib/pcart-production-intent";

export type PcartProductionReview = {
  ok: true;
  artifactId: string;
  chainId: number;
  launchId: string;
  deployer: string;
  nonce: string;
  safeRecipient: string;
  predictedAddress: string;
  initCodeHash: string;
  gasEstimate: string;
  maxFeePerGasWei: string;
  estimatedMaxCostWei: string;
  ethCall: "OK" | "UNSUPPORTED";
  readinessFingerprint: string;
  reviewFingerprint: string;
  reviewedAt: number;
  expiresAt: number;
  executionLocked: true;
};
export type PcartProductionReviewResult = PcartProductionReview | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (reason: string): PcartProductionReviewResult => ({ ok: false, reason });

export const reviewPcartProductionDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { launchId: string; deployer: string }) => {
    if (!input || typeof input.launchId !== "string" || !UUID.test(input.launchId)) throw new Error("Invalid launch");
    const deployer = normalizeAddress(input.deployer);
    if (!deployer) throw new Error("Invalid deployer");
    return { launchId: input.launchId.toLowerCase(), deployer };
  })
  .handler(async ({ data, context }): Promise<PcartProductionReviewResult> => {
    const { supabase, userId } = context;
    const { data: isOwner } = await supabase.rpc("is_platform_owner", { _user_id: userId });
    if (isOwner !== true) return fail("NOT_PLATFORM_OWNER");

    const { data: readinessRaw, error: rErr } = await supabase.rpc("get_canonical_pcart_production_readiness", {
      _launch_id: data.launchId,
    });
    if (rErr || !readinessRaw) return fail("READINESS_UNAVAILABLE");
    const readiness = readinessRaw as {
      canonical?: boolean;
      execution_locked?: boolean;
      approval?: { safe_address?: string; evidence_still_matches?: boolean } | null;
    };
    if (readiness.canonical !== true) return fail("NOT_CANONICAL");
    if (readiness.execution_locked !== true) return fail("EXECUTION_NOT_LOCKED");
    if (!readiness.approval || readiness.approval.evidence_still_matches !== true) return fail("APPROVAL_MISSING_OR_STALE");
    const safe = normalizeAddress(readiness.approval.safe_address);
    if (safe !== PCART_PRODUCTION_TREASURY_SAFE) return fail("SAFE_MISMATCH");

    const { data: signerRow, error: sErr } = await supabase
      .from("launch_treasury_signer_configs")
      .select("signer_1, signer_2, signer_3, safe_address, threshold")
      .eq("launch_id", data.launchId)
      .maybeSingle();
    if (sErr || !signerRow) return fail("SIGNERS_UNAVAILABLE");
    if (normalizeAddress(signerRow.safe_address) !== safe || signerRow.threshold !== 2) return fail("SAFE_MISMATCH");
    const signers = [signerRow.signer_1, signerRow.signer_2, signerRow.signer_3].map((s) => String(s ?? ""));
    if (!isAllowedPcartDeployer(data.deployer, signers, safe)) return fail("DEPLOYER_NOT_SIGNER");

    // Privileged READ of the immutable approval fingerprint, only after the
    // caller is proven to be the platform owner. No writes.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: approvalRow } = await supabaseAdmin
      .from("pcart_production_readiness_approvals")
      .select("readiness_fingerprint, safe_address")
      .eq("launch_id", data.launchId)
      .eq("artifact_id", PEPECARTEL_TOKEN_ARTIFACT_ID)
      .maybeSingle();
    const readinessFingerprint = String(approvalRow?.readiness_fingerprint ?? "").toLowerCase();
    if (!/^(0x)?[0-9a-f]{64}$/.test(readinessFingerprint) || normalizeAddress(approvalRow?.safe_address) !== safe) {
      return fail("APPROVAL_MISSING_OR_STALE");
    }

    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) return fail("MANAGED_RPC_UNCONFIGURED");
    const client = createPublicClient({ chain: mainnetChain(endpoint), transport: http(endpoint) });

    try {
      const chainId = await client.getChainId();
      if (chainId !== PCART_PRODUCTION_CHAIN_ID) return fail("CHAIN_MISMATCH");

      const deployer = data.deployer as `0x${string}`;
      const [latest, pending] = await Promise.all([
        client.getTransactionCount({ address: deployer, blockTag: "latest" }),
        client.getTransactionCount({ address: deployer, blockTag: "pending" }),
      ]);
      if (latest !== pending) return fail("NONCE_PENDING_MISMATCH");
      const nonce = BigInt(latest);

      const initCode = buildPcartProductionInitCode(safe);
      const initCodeHash = pcartProductionInitCodeHash(safe);
      const predictedAddress = predictPcartProductionAddress(deployer, nonce);

      const [predictedCode, safeCode] = await Promise.all([
        client.getCode({ address: predictedAddress as `0x${string}` }),
        client.getCode({ address: safe as `0x${string}` }),
      ]);
      if (predictedCode && predictedCode !== "0x") return fail("PREDICTED_ADDRESS_HAS_CODE");
      if (!safeCode || safeCode === "0x") return fail("SAFE_HAS_NO_CODE");

      const gasEstimate = await client.estimateGas({ account: deployer, data: initCode, value: 0n });
      let ethCall: "OK" | "UNSUPPORTED" = "OK";
      try {
        await client.call({ account: deployer, data: initCode, value: 0n });
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : "";
        if (msg.includes("revert")) return fail("CREATION_CALL_REVERTED");
        ethCall = "UNSUPPORTED";
      }

      let maxFeePerGas: bigint;
      try {
        const fees = await client.estimateFeesPerGas();
        maxFeePerGas = fees.maxFeePerGas ?? (await client.getGasPrice());
      } catch {
        maxFeePerGas = await client.getGasPrice();
      }

      const reviewFingerprint = pcartProductionReviewFingerprint({
        launchId: data.launchId,
        safeAddress: safe,
        deployer,
        nonce,
        initCodeHash,
        readinessFingerprint,
      });
      const reviewedAt = Date.now();
      return {
        ok: true,
        artifactId: PEPECARTEL_TOKEN_ARTIFACT_ID,
        chainId,
        launchId: data.launchId,
        deployer,
        nonce: nonce.toString(),
        safeRecipient: safe,
        predictedAddress,
        initCodeHash,
        gasEstimate: gasEstimate.toString(),
        maxFeePerGasWei: maxFeePerGas.toString(),
        estimatedMaxCostWei: (gasEstimate * maxFeePerGas).toString(),
        ethCall,
        readinessFingerprint,
        reviewFingerprint,
        reviewedAt,
        expiresAt: reviewedAt + PCART_PRODUCTION_REVIEW_TTL_MS,
        executionLocked: true,
      };
    } catch {
      return fail("MANAGED_RPC_READ_FAILED");
    }
  });
