/**
 * PCART P9.3B — owner-only server functions for Treasury Safe signatures + permit-bound pre-auction execution.
 * Every write path re-attests live facts server-side (P9.1/P9.3A readers) and calls a service-role-only RPC.
 * No server-held keys, no Safe Transaction Service, no control/lifecycle/official-contract mutation.
 * The browser only ever receives public data: typed data to sign, assembled execTransaction calldata.
 */
import { createServerFn } from "@tanstack/react-start";
import { encodeFunctionData, parseAbi } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import { dependencyFingerprintP93, effectiveActionStatus, ownersFingerprint, type P93CurrentFacts } from "@/lib/pcart-launch-coordinator-p9-3";
import { loadFacts, mapAction } from "@/lib/pcart-launch-coordinator-p9-3.functions";
import {
  assembleSafeSignatures, CANONICAL_OWNERS, classifyOwnerCode, executionGate, permitBindingFingerprint, rebuildBoundPreAuction, safeTypedDataV4Json,
  signatureSetFingerprint, signingGate, usableSignatures, validateOwnerSignature, verifyPreAuctionExecution, P9_3B_ACTION_TYPE, P9_3B_BINDING_VERSION,
  P9_3B_SMART_ACCOUNT_COPY, type P93bLive, type P93bPermitBinding, type StoredSig,
} from "@/lib/pcart-launch-coordinator-p9-3b";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/;
type Ctx = { supabase: any; userId: string };
const isOwner = async (ctx: Ctx) => (await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId })).data === true;
const actionInput = (i: { actionId: string }) => { if (!i || !UUID.test(String(i.actionId))) throw new Error("Invalid action"); return { actionId: i.actionId.toLowerCase() }; };
const SAFE_EXEC_ABI = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool)"]);

const REJECT_COPY: Record<string, string> = {
  SMART_ACCOUNT_SIGNATURE: P9_3B_SMART_ACCOUNT_COPY,
  ETH_SIGN_NOT_SUPPORTED: "This wallet signed a plain message instead of the Safe transaction. Use another Treasury signer.",
  CONTRACT_OWNER_NOT_SUPPORTED: "This Treasury owner is a contract account. P9.3B cannot accept its signature.",
  NOT_OWNER: "This wallet is not one of the three Treasury Safe owners.",
  SIGNER_MISMATCH: "The signature does not belong to the connected wallet.",
  WRONG_HASH: "The signature is for a different Safe transaction.",
  OWNER_CODE_UNKNOWN: "Could not read this owner's account on chain. Try again.",
  MALFORMED: "The wallet returned an unreadable signature.",
};

/** Full server-side attestation of one pre-auction action. */
async function attest(ctx: Ctx, actionId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await ctx.supabase.from("pcart_launch_coordinator_actions").select("*").eq("id", actionId).maybeSingle();
  if (!row || row.action_kind !== "PREAUCTION_SETUP") return null;
  const action = mapAction(row);
  const f = await loadFacts(ctx, row.launch_id);
  const readers = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
  const [live, ownerCodes, ctl, sigRows, permitRows] = await Promise.all([
    readers.readP9_3PrepareFacts(f.officialToken),
    readers.readP9_3bOwnerCodes(CANONICAL_OWNERS),
    (supabaseAdmin as any).from("launch_chain_production_execution_controls").select("execution_enabled, emergency_stop_engaged, revision").eq("control_key", "ROBINHOOD_MAINNET_DEPLOYMENT").maybeSingle(),
    (supabaseAdmin as any).from("pcart_launch_coordinator_signatures").select("signer_address, signature, safe_tx_hash, status, control_revision, owner_account_kind").eq("action_id", actionId),
    ctx.supabase.from("pcart_launch_coordinator_action_permits").select("id, expires_at, consumed_at, cancelled_at, control_revision").eq("action_id", actionId).order("issued_at", { ascending: false }).limit(1),
  ]);
  const depFp = dependencyFingerprintP93(live.observed);
  const current: P93CurrentFacts = {
    officialTokenAddress: f.officialToken, tokenRuntimeKeccak: live.tokenRuntimeKeccak, p8a: f.p8a, p8b: f.p8b, dependencyFingerprint: depFp,
    safeOwnersFingerprint: live.safe ? ownersFingerprint(live.safe.owners) : null, safeThreshold: live.safe?.threshold ?? null, safeNonce: live.safe?.nonce ?? null, plan: f.plan,
  };
  const eff = effectiveActionStatus(action, current);
  const control = ctl.data ? { executionEnabled: ctl.data.execution_enabled === true, emergencyStopEngaged: ctl.data.emergency_stop_engaged !== false, revision: Number(ctl.data.revision) } : null;
  const sigs: StoredSig[] = ((sigRows.data ?? []) as any[]).map((s) => ({ signerAddress: s.signer_address, signature: s.signature, safeTxHash: s.safe_tx_hash, status: s.status, controlRevision: Number(s.control_revision), ownerKind: s.owner_account_kind }));
  const usable = usableSignatures(sigs, { safeTxHash: action.safeTxHash, controlRevision: control?.revision ?? null });
  const liveGate: P93bLive = {
    nowMs: Date.now(), headBlock: live.head?.block ?? null, msPerBlock: live.head?.msPerBlock ?? null, control,
    safeNonce: live.safe?.nonce ?? null, staleReasons: eff.reasons, uncertainTransaction: f.uncertain,
  };
  const rebuilt = rebuildBoundPreAuction({ ...action, authoritativeStartBlock: action.authoritativeStartBlock!, endBlock: action.endBlock!, permit2Expiration: String(row.permit2_expiration),
    promotionStartAt: action.promotionStartAt!, intendedAuctionStartAt: action.intendedAuctionStartAt!, callBatchFingerprint: row.call_batch_fingerprint, safeTxDataKeccak: row.safe_tx_data_keccak,
    safeTxTarget: row.safe_tx_target, safeTxOperation: Number(row.safe_tx_operation) });
  const p = (permitRows.data ?? [])[0];
  const permit = p ? { id: String(p.id), expiresAtMs: Date.parse(p.expires_at), consumed: !!p.consumed_at, cancelled: !!p.cancelled_at, controlRevision: Number(p.control_revision) } : null;
  return { row, action, eff, control, sigs, usable, liveGate, rebuilt, ownerCodes, permit, f, depFp, live };
}
type Att = NonNullable<Awaited<ReturnType<typeof attest>>>;
const statusOf = (a: Att) => (a.eff.status === "STALE" ? "STALE" : a.action.status);
const gateAction = (a: Att) => ({ status: statusOf(a), safeNonce: a.action.safeNonce, authoritativeStartBlock: a.action.authoritativeStartBlock!, executionTxHash: a.row.execution_tx_hash ?? null });

async function safeValidation(a: Att): Promise<boolean | null> {
  const asm = assembleSafeSignatures(a.usable);
  if (!asm.ok) return null;
  const { safeAcceptsSignatures } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
  return safeAcceptsSignatures(a.action.safeTxHash as `0x${string}`, asm.signatures);
}

/** Passive, read-only. Never prompts a wallet, never writes. */
export const getPcartP9_3bSafeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(actionInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const a = await attest(ctx, data.actionId);
    if (!a) return { ok: false as const, reason: "ACTION_NOT_FOUND" };
    const signBlocks = signingGate(gateAction(a), a.liveGate, a.usable);
    if (!a.rebuilt.ok) signBlocks.push("ACTION_STALE");
    const validated = a.usable.length === 2 ? await safeValidation(a) : null;
    const execBlocks = executionGate(gateAction(a), a.liveGate, a.usable, validated, a.permit && !a.permit.consumed && !a.permit.cancelled ? a.permit : { expiresAtMs: Number.MAX_SAFE_INTEGER, consumed: false, cancelled: false, controlRevision: a.control?.revision ?? -1 })
      .filter((b) => b !== "NO_PERMIT");
    return {
      ok: true as const, status: statusOf(a), staleReasons: a.eff.reasons, safeTxHash: a.action.safeTxHash, txHash: a.row.execution_tx_hash ?? null, auctionAddress: a.row.auction_address ?? null,
      owners: CANONICAL_OWNERS.map((o) => ({ address: o, kind: classifyOwnerCode(a.ownerCodes[o]), signed: a.usable.some((s) => s.signerAddress === o) })),
      approvals: a.usable.length, safeValidated: validated,
      canSign: signBlocks.length === 0 && a.usable.length < 2, signBlocks: [...new Set(signBlocks)],
      canExecute: execBlocks.length === 0 && a.usable.length === 2, execBlocks,
      typedData: signBlocks.length === 0 && a.rebuilt.ok ? safeTypedDataV4Json(a.rebuilt.safe, a.rebuilt.tx) : null,
      startBlock: a.action.authoritativeStartBlock, endBlock: a.action.endBlock, safeNonce: a.action.safeNonce,
    };
  });

/** Explicit owner action after the wallet returned a signature. Server recovers + validates before storing. */
export const submitPcartSafeSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { actionId: string; signer: string; signature: string }) => {
    const b = actionInput(i);
    const signer = String(i.signer ?? "").toLowerCase(), signature = String(i.signature ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(signer) || !/^0x[0-9a-f]{2,4000}$/.test(signature)) throw new Error("Invalid signature input");
    return { ...b, signer, signature };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER", message: "Platform owner only." };
    const a = await attest(ctx, data.actionId);
    if (!a) return { ok: false as const, reason: "ACTION_NOT_FOUND", message: "Prepared action not found." };
    const blocks = signingGate(gateAction(a), a.liveGate, a.usable);
    if (!a.rebuilt.ok) blocks.push("ACTION_STALE");
    if (blocks.length) return { ok: false as const, reason: blocks.join(", "), message: "Signing is not allowed right now." };
    if (a.usable.some((s) => s.signerAddress === data.signer)) return { ok: false as const, reason: "DUPLICATE_SIGNER", message: "This owner already signed. Use a different Treasury signer." };
    const v = await validateOwnerSignature({ safeTxHash: a.rebuilt.ok ? a.rebuilt.safeTxHash : "", expectedSafeTxHash: a.action.safeTxHash, signature: data.signature, claimedSigner: data.signer, ownerCode: a.ownerCodes[data.signer] });
    if (!v.ok) return { ok: false as const, reason: v.reason, message: REJECT_COPY[v.reason] ?? "Signature rejected." };
    // For a delegated (EIP-7702) owner, or as the second signature, the Safe itself must accept the set before storing.
    const prospective = [...a.usable, { signerAddress: v.recovered, signature: v.normalized, safeTxHash: a.action.safeTxHash, status: "VALID", controlRevision: a.control!.revision, ownerKind: v.ownerKind }];
    if (prospective.length === 2 || v.ownerKind === "EIP7702_DELEGATED") {
      const { safeAcceptsSignatures } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
      if (prospective.length === 2) {
        const asm = assembleSafeSignatures(prospective);
        if (!asm.ok || (await safeAcceptsSignatures(a.action.safeTxHash as `0x${string}`, asm.signatures)) !== true) return { ok: false as const, reason: "SAFE_VALIDATION_FAILED", message: "The Treasury Safe did not accept this signature set. Use another Treasury signer." };
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await (supabaseAdmin as any).rpc("record_canonical_pcart_safe_signature", {
      _actor: ctx.userId, _action_id: data.actionId, _signer: v.recovered, _owner_kind: v.ownerKind, _safe_tx_hash: a.action.safeTxHash, _signature: v.normalized, _control_revision: a.control!.revision,
    });
    if (error) return { ok: false as const, reason: String(error.message ?? "RECORD_FAILED"), message: "Signature could not be recorded." };
    return { ok: true as const, validCount: Number(res?.valid_count ?? 0) };
  });

function bindingFor(a: Att): { binding: P93bPermitBinding; sigsetFp: string } | null {
  const asm = assembleSafeSignatures(a.usable);
  if (!asm.ok || !a.control) return null;
  const r = a.row;
  const sigsetFp = signatureSetFingerprint(a.usable);
  return { sigsetFp, binding: {
    bindingVersion: P9_3B_BINDING_VERSION, actionType: P9_3B_ACTION_TYPE, actionId: r.id, launchId: r.launch_id, chainId: 4663,
    officialTokenAddress: r.official_token_address, officialTokenCodeHash: r.official_token_code_hash, p8aReviewId: r.p8a_review_id, p8aManifestFingerprint: r.p8a_manifest_fingerprint,
    p8bReviewId: r.p8b_review_id, p8bManifestFingerprint: r.p8b_manifest_fingerprint, dependencyAttestationFingerprint: r.dependency_attestation_fingerprint,
    safeAddress: r.safe_address, safeOwnersFingerprint: r.safe_owners_fingerprint, safeThreshold: 2, safeNonce: Number(r.safe_nonce), safeTxHash: r.safe_tx_hash,
    callBatchFingerprint: r.call_batch_fingerprint, signer1: asm.signers[0], signer2: asm.signers[1], signatureSetFingerprint: sigsetFp, controlRevision: a.control.revision,
  } };
}
const liveMatchesBinding = (a: Att, b: P93bPermitBinding) =>
  a.depFp?.toLowerCase() === b.dependencyAttestationFingerprint && (a.live.tokenRuntimeKeccak ?? "").toLowerCase() === b.officialTokenCodeHash &&
  a.live.safe != null && ownersFingerprint(a.live.safe.owners) === b.safeOwnersFingerprint && a.live.safe.threshold === 2 && a.live.safe.nonce === b.safeNonce;

/** Explicit owner action. Fresh re-attestation, Safe validation, then a 30-second single-use permit. */
export const issuePcartPreAuctionPermit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(actionInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const a = await attest(ctx, data.actionId);
    if (!a || !a.rebuilt.ok) return { ok: false as const, reason: "ACTION_NOT_VALID" };
    const validated = await safeValidation(a);
    const blocks = executionGate(gateAction(a), a.liveGate, a.usable, validated, { expiresAtMs: Number.MAX_SAFE_INTEGER, consumed: false, cancelled: false, controlRevision: a.control?.revision ?? -1 });
    if (blocks.length) return { ok: false as const, reason: blocks.join(", ") };
    const bf = bindingFor(a);
    if (!bf || !liveMatchesBinding(a, bf.binding)) return { ok: false as const, reason: "LIVE_FACTS_CHANGED" };
    const fp = permitBindingFingerprint(bf.binding);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const b = bf.binding;
    const { data: res, error } = await (supabaseAdmin as any).rpc("issue_canonical_pcart_action_permit", { _actor: ctx.userId, _action_id: data.actionId, _b: {
      binding_version: b.bindingVersion, official_token_address: b.officialTokenAddress, official_token_code_hash: b.officialTokenCodeHash,
      p8a_review_id: b.p8aReviewId, p8a_manifest_fingerprint: b.p8aManifestFingerprint, p8b_review_id: b.p8bReviewId, p8b_manifest_fingerprint: b.p8bManifestFingerprint,
      dependency_attestation_fingerprint: b.dependencyAttestationFingerprint, safe_address: b.safeAddress, safe_owners_fingerprint: b.safeOwnersFingerprint, safe_nonce: b.safeNonce,
      safe_tx_hash: b.safeTxHash, call_batch_fingerprint: b.callBatchFingerprint, signer_1: b.signer1, signer_2: b.signer2, signature_set_fingerprint: b.signatureSetFingerprint,
      control_revision: b.controlRevision, binding_fingerprint: fp,
    } });
    if (error) return { ok: false as const, reason: String(error.message ?? "PERMIT_FAILED") };
    return { ok: true as const, permitId: String(res.permit_id), expiresAt: String(res.expires_at), bindingFingerprint: fp, signatureSetFingerprint: bf.sigsetFp };
  });

/**
 * Explicit owner action immediately before the wallet prompt: re-attests again, consumes the permit and moves the
 * action to UNCERTAIN (claim-before-send). Returns the exact execTransaction calldata for the canonical Safe.
 */
export const claimPcartPreAuctionExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { actionId: string; permitId: string; bindingFingerprint: string; signatureSetFingerprint: string; executor: string }) => {
    const b = actionInput(i);
    if (!UUID.test(String(i.permitId)) || !HASH.test(String(i.bindingFingerprint).toLowerCase()) || !HASH.test(String(i.signatureSetFingerprint).toLowerCase())) throw new Error("Invalid permit");
    const executor = String(i.executor ?? "").toLowerCase();
    if (!CANONICAL_OWNERS.includes(executor)) throw new Error("Executor must be a Treasury Safe owner");
    return { ...b, permitId: i.permitId.toLowerCase(), bindingFingerprint: i.bindingFingerprint.toLowerCase(), signatureSetFingerprint: i.signatureSetFingerprint.toLowerCase(), executor };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const a = await attest(ctx, data.actionId);
    if (!a || !a.rebuilt.ok) return { ok: false as const, reason: "ACTION_NOT_VALID" };
    const validated = await safeValidation(a);
    const blocks = executionGate(gateAction(a), a.liveGate, a.usable, validated, a.permit && a.permit.id === data.permitId ? a.permit : null);
    const bf = bindingFor(a);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (blocks.length || !bf || !liveMatchesBinding(a, bf.binding) || permitBindingFingerprint(bf.binding) !== data.bindingFingerprint || bf.sigsetFp !== data.signatureSetFingerprint) {
      if (a.permit && !a.permit.consumed && !a.permit.cancelled) {
        await (supabaseAdmin as any).from("pcart_launch_coordinator_action_permits").update({ cancelled_at: new Date().toISOString(), cancel_reason: "REATTESTATION_FAILED" }).eq("id", a.permit.id).is("consumed_at", null).is("cancelled_at", null);
      }
      return { ok: false as const, reason: blocks.join(", ") || "LIVE_FACTS_CHANGED" };
    }
    const { data: res, error } = await (supabaseAdmin as any).rpc("claim_canonical_pcart_action_permit", { _actor: ctx.userId, _permit_id: data.permitId, _binding_fingerprint: data.bindingFingerprint, _signature_set_fingerprint: data.signatureSetFingerprint });
    if (error || !res?.ok) return { ok: false as const, reason: String(error?.message ?? res?.reason ?? "CLAIM_FAILED") };
    const asm = assembleSafeSignatures(a.usable);
    if (!asm.ok) return { ok: false as const, reason: "SIGNATURES_INCOMPLETE" };
    const t = a.rebuilt.tx;
    const calldata = encodeFunctionData({ abi: SAFE_EXEC_ABI, functionName: "execTransaction", args: [t.to, t.value, t.data, t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, asm.signatures] });
    return { ok: true as const, tx: { from: data.executor, to: P8B_REAL_TREASURY_SAFE.address.toLowerCase(), data: calldata, value: "0x0" } };
  });

/** Records the hash only after the wallet/provider returned one. */
export const recordPcartPreAuctionTx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { actionId: string; txHash: string }) => { const b = actionInput(i); const h = String(i.txHash ?? "").toLowerCase(); if (!HASH.test(h)) throw new Error("Invalid hash"); return { ...b, txHash: h }; })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("record_canonical_pcart_action_tx", { _actor: ctx.userId, _action_id: data.actionId, _tx_hash: data.txHash });
    return error ? { ok: false as const, reason: String(error.message) } : { ok: true as const };
  });

/** Reconcile from chain evidence only: CONFIRMED, REVERTED, or still pending. Never resends. */
export const reconcilePcartPreAuction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { actionId: string; txHash?: string | null }) => {
    const b = actionInput(i); const h = i.txHash ? String(i.txHash).toLowerCase() : null;
    if (h && !HASH.test(h)) throw new Error("Invalid hash");
    return { ...b, txHash: h };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const { data: row } = await ctx.supabase.from("pcart_launch_coordinator_actions").select("*").eq("id", data.actionId).maybeSingle();
    if (!row || !["UNCERTAIN", "SUBMITTED"].includes(row.status)) return { ok: false as const, reason: "NOTHING_TO_RECONCILE" };
    const hash = (row.execution_tx_hash ?? data.txHash) as `0x${string}` | null;
    if (!hash) return { ok: false as const, reason: "TX_HASH_REQUIRED" };
    if (row.execution_tx_hash && data.txHash && data.txHash !== row.execution_tx_hash) return { ok: false as const, reason: "TX_HASH_DIFFERS" };
    const r = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const receipt = await r.readP9_3bReceipt(hash);
    if (!receipt) return { ok: true as const, outcome: "PENDING" as const };
    const nonceAfter = await r.readP9_3bSafeNonce();
    const { LBP_INITIALIZER_CREATED_TOPIC, LBP_STRATEGY_ADDRESS } = await import("@/lib/pcart-launch-coordinator-p9-3b");
    const created = receipt.logs.find((l) => l.address.toLowerCase() === LBP_STRATEGY_ADDRESS && l.topics[0]?.toLowerCase() === LBP_INITIALIZER_CREATED_TOPIC.toLowerCase());
    const auctionAddr = created?.topics[1] ? `0x${created.topics[1].slice(26)}` : null;
    const obs = auctionAddr ? await r.readP9_3Auction(auctionAddr) : null;
    const v = verifyPreAuctionExecution({
      receipt: { ...receipt, status: receipt.status === "success" ? "success" : "reverted" }, boundSafeTxHash: row.safe_tx_hash, boundNonce: Number(row.safe_nonce), nonceAfter,
      boundStartBlock: String(row.authoritative_start_block), boundEndBlock: String(row.end_block),
      auction: obs && obs.ok ? { ok: true, endBlock: obs.endBlock, tokensRecipient: obs.tokensRecipient, fundsRecipient: obs.fundsRecipient } : { ok: false },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!v.ok && v.reverted && nonceAfter === Number(row.safe_nonce)) {
      const { error } = await (supabaseAdmin as any).rpc("record_canonical_pcart_action_reverted", { _actor: ctx.userId, _action_id: data.actionId, _tx_hash: hash });
      return error ? { ok: false as const, reason: String(error.message) } : { ok: true as const, outcome: "REVERTED" as const };
    }
    if (!v.ok) return { ok: true as const, outcome: "UNVERIFIED" as const, reasons: v.reasons };
    const { error } = await (supabaseAdmin as any).rpc("confirm_canonical_pcart_action", { _actor: ctx.userId, _action_id: data.actionId, _tx_hash: hash, _block: Number(v.block), _auction_address: v.auctionAddress });
    return error ? { ok: false as const, reason: String(error.message) } : { ok: true as const, outcome: "CONFIRMED" as const };
  });

/** Owner explicitly confirms the wallet returned no hash; allowed only while the live Safe nonce is unchanged. */
export const releasePcartPreAuctionHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(actionInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!(await isOwner(ctx))) return { ok: false as const, reason: "NOT_PLATFORM_OWNER" };
    const { readP9_3bSafeNonce } = await import("@/lib/pcart-launch-coordinator-p9-readers.server");
    const nonce = await readP9_3bSafeNonce();
    if (nonce === null) return { ok: false as const, reason: "SAFE_NONCE_UNAVAILABLE" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("release_canonical_pcart_action_handoff", { _actor: ctx.userId, _action_id: data.actionId, _verified_safe_nonce: nonce });
    return error ? { ok: false as const, reason: String(error.message) } : { ok: true as const };
  });
