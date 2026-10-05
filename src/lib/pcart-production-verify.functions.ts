/**
 * PCART P6 — owner-only post-broadcast verification + managed finality.
 *
 * READ-ONLY against the chain: managed Robinhood Chain mainnet RPC only, no
 * browser provider, no signer, no send. Writes go only through the owner-gated
 * evidence RPCs `apply_canonical_pcart_production_verification` and
 * `apply_canonical_pcart_production_finality`. Never registers an official
 * contract, changes launch lifecycle, or touches execution controls.
 */
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mainnetChain } from "@/lib/chain-mainnet-verify-shape";
import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { PEPECARTEL_TOKEN_ABI } from "@/lib/pepecartel-token.artifact";
import {
  classifyPcartP6,
  classifyPcartP6Finality,
  isPcartP6Active,
  PCART_P6_SUPPLY,
  type PcartP6Contract,
  type PcartP6Intent,
  type PcartP6Observation,
  type PcartP6Tx,
} from "@/lib/pcart-production-verify";
import { PCART_RECOVERY_SCAN_BLOCKS } from "@/lib/pcart-production-send.functions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { supabase: any; userId: string };
type Client = ReturnType<typeof createPublicClient>;

export type PcartVerifyResult =
  | { ok: true; outcome: string; status: string; finalityState: string | null; reason?: string | undefined; failureCode?: string | undefined }
  | { ok: false; reason: string };

async function loadIntent(ctx: Ctx, deploymentId: string) {
  const { data: isOwner } = await ctx.supabase.rpc("is_platform_owner", { _user_id: ctx.userId });
  if (isOwner !== true) return { error: "NOT_PLATFORM_OWNER" as const };
  const { data: d } = await ctx.supabase
    .from("launch_chain_deployments")
    .select("id, status, chain_id, network_environment, artifact_id, deployer_address, deployer_nonce_before, tx_hash, init_code_hash, token_recipient, block_number, block_hash, finality_state, finalized_head_block_number")
    .eq("id", deploymentId)
    .maybeSingle();
  if (!d) return { error: "DEPLOYMENT_NOT_FOUND" as const };
  if (d.chain_id !== 4663 || d.network_environment !== "PRODUCTION" || d.artifact_id !== "pepecartel-token-v1") return { error: "NOT_CANONICAL_PCART" as const };
  if (!isPcartP6Active(d.status)) return { error: "STATUS_NOT_VERIFIABLE" as const };
  if (!d.tx_hash || d.deployer_nonce_before === null) return { error: "NO_BROADCAST" as const };
  const { data: c } = await ctx.supabase
    .from("pcart_production_send_claims")
    .select("predicted_contract_address, tx_hash, claim_status")
    .eq("deployment_id", d.id).eq("claim_status", "BROADCAST").eq("tx_hash", d.tx_hash)
    .maybeSingle();
  if (!c) return { error: "NO_BROADCAST_CLAIM" as const };
  const intent: PcartP6Intent = {
    status: d.status,
    txHash: String(d.tx_hash).toLowerCase(),
    deployer: String(d.deployer_address).toLowerCase(),
    nonce: BigInt(d.deployer_nonce_before),
    initCodeHash: String(d.init_code_hash).toLowerCase(),
    safe: String(d.token_recipient).toLowerCase(),
    claimPredictedAddress: String(c.predicted_contract_address).toLowerCase(),
  };
  return { d, intent };
}

function managedClient(): Client | null {
  const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
  if (!endpoint) return null;
  return createPublicClient({ chain: mainnetChain(endpoint), transport: http(endpoint) }) as Client;
}

const toTx = (t: any): PcartP6Tx => ({ hash: t.hash, from: t.from, to: t.to ?? null, nonce: BigInt(t.nonce), value: BigInt(t.value), input: t.input });

async function readTx(client: Client, hash: `0x${string}`): Promise<PcartP6Tx | undefined> {
  try { return toTx(await client.getTransaction({ hash })); }
  catch (e: any) { return /not be found|TransactionNotFound/i.test(String(e?.name ?? "") + String(e?.message ?? "")) ? null : undefined; }
}

async function readReceipt(client: Client, hash: `0x${string}`) {
  try {
    const r = await client.getTransactionReceipt({ hash });
    return { transactionHash: r.transactionHash, status: r.status, contractAddress: r.contractAddress ?? null, blockNumber: r.blockNumber, blockHash: r.blockHash } as const;
  } catch (e: any) {
    return /not be found|TransactionReceiptNotFound/i.test(String(e?.name ?? "") + String(e?.message ?? "")) ? null : undefined;
  }
}

/** Bounded nonce-transition scan (patterned after P5 recovery). */
async function scanNonceTx(client: Client, deployer: `0x${string}`, saved: bigint): Promise<PcartP6Tx | null | undefined> {
  try {
    const head = await client.getBlockNumber();
    let lo = head > PCART_RECOVERY_SCAN_BLOCKS ? head - PCART_RECOVERY_SCAN_BLOCKS : 0n;
    let hi = head;
    if (BigInt(await client.getTransactionCount({ address: deployer, blockNumber: lo })) > saved) return null;
    while (lo + 1n < hi) {
      const mid = (lo + hi) / 2n;
      if (BigInt(await client.getTransactionCount({ address: deployer, blockNumber: mid })) > saved) hi = mid;
      else lo = mid;
    }
    const block = await client.getBlock({ blockNumber: hi, includeTransactions: true });
    const t = block.transactions.find((x) => typeof x !== "string" && x.from.toLowerCase() === deployer && BigInt(x.nonce) === saved);
    return t && typeof t !== "string" ? toTx(t) : null;
  } catch {
    return undefined;
  }
}

async function readContractAt(client: Client, address: `0x${string}`, blockNumber: bigint, safe: string, deployer: string): Promise<PcartP6Contract | undefined> {
  try {
    const call = (functionName: string, args: readonly unknown[] = []) =>
      client.readContract({ address, abi: PEPECARTEL_TOKEN_ABI as any, functionName, args, blockNumber } as any);
    const [runtimeCode, name, symbol, decimals, totalSupply, safeBalance, deployerBalance] = await Promise.all([
      client.getCode({ address, blockNumber }),
      call("name"), call("symbol"), call("decimals"), call("totalSupply"),
      call("balanceOf", [safe]), call("balanceOf", [deployer]),
    ]);
    return {
      runtimeCode: runtimeCode ?? "0x",
      name: String(name), symbol: String(symbol), decimals: Number(decimals),
      totalSupply: BigInt(totalSupply as bigint), safeBalance: BigInt(safeBalance as bigint), deployerBalance: BigInt(deployerBalance as bigint),
    };
  } catch {
    return undefined;
  }
}

export const verifyPcartProductionDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { deploymentId: string }) => {
    if (!i || !UUID.test(String(i.deploymentId))) throw new Error("Invalid deployment");
    return { deploymentId: i.deploymentId.toLowerCase() };
  })
  .handler(async ({ data, context }): Promise<PcartVerifyResult> => {
    const ctx = context as Ctx;
    const loaded = await loadIntent(ctx, data.deploymentId);
    if ("error" in loaded) return { ok: false, reason: String(loaded.error) };
    const { d, intent } = loaded;
    const client = managedClient();
    if (!client) return { ok: false, reason: "MANAGED_RPC_UNCONFIGURED" };
    try { if ((await client.getChainId()) !== 4663) return { ok: false, reason: "CHAIN_MISMATCH" }; }
    catch { return { ok: true, outcome: "RETRYABLE", reason: "PROVIDER_UNAVAILABLE", status: d.status, finalityState: d.finality_state }; }

    const hash = intent.txHash as `0x${string}`;
    const dep = intent.deployer as `0x${string}`;
    const obs: PcartP6Observation = { tx: await readTx(client, hash), receipt: await readReceipt(client, hash), latestNonce: undefined };
    if (obs.tx === null) {
      try { obs.latestNonce = BigInt(await client.getTransactionCount({ address: dep, blockTag: "latest" })); } catch { obs.latestNonce = undefined; }
      if (obs.latestNonce !== undefined && obs.latestNonce > intent.nonce) obs.replacementTx = await scanNonceTx(client, dep, intent.nonce);
    }
    if (obs.receipt && obs.receipt.status === "success" && obs.receipt.contractAddress) {
      obs.contract = await readContractAt(client, obs.receipt.contractAddress as `0x${string}`, obs.receipt.blockNumber, intent.safe, intent.deployer);
      try { obs.latestBlock = await client.getBlockNumber(); } catch { obs.latestBlock = undefined; }
    }

    const out = classifyPcartP6(intent, obs);
    if (out.kind === "REFUSED" || out.kind === "RETRYABLE") {
      return { ok: true, outcome: out.kind, reason: out.reason, status: d.status, finalityState: d.finality_state };
    }
    if (d.status === "CONFIRMED" && out.kind !== "CONFIRMED") {
      // Never downgrade confirmed evidence; surface contradictions for manual incident review.
      return { ok: true, outcome: out.kind === "FAILED" ? "INCIDENT" : "UNCHANGED", failureCode: out.kind === "FAILED" ? out.code : undefined, status: d.status, finalityState: d.finality_state };
    }
    const args: Record<string, unknown> = { _deployment_id: d.id, _outcome: out.kind, _observed_tx_hash: intent.txHash };
    if (out.kind === "FAILED") {
      args["_failure_code"] = out.code;
      args["_failure_detail"] = `PCART P6 managed verification: ${out.code}`;
    } else if (out.kind === "CONFIRMED") {
      Object.assign(args, {
        _contract_address: out.contractAddress, _block_number: Number(out.blockNumber), _block_hash: out.blockHash,
        _confirmations: out.confirmations, _runtime_code_hash: out.runtimeHash,
        _verified_token_name: "PEPECARTEL", _verified_token_symbol: "PCART", _verified_token_decimals: 18,
        _verified_total_supply_text: PCART_P6_SUPPLY, _safe_balance_text: PCART_P6_SUPPLY, _deployer_balance_text: "0",
      });
    }
    const { data: row, error } = await ctx.supabase.rpc("apply_canonical_pcart_production_verification", args);
    if (error || !row) return { ok: false, reason: "APPLY_REFUSED" };
    return { ok: true, outcome: out.kind, failureCode: out.kind === "FAILED" ? out.code : undefined, status: row.status, finalityState: row.finality_state };
  });

export const checkPcartProductionFinality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { deploymentId: string }) => {
    if (!i || !UUID.test(String(i.deploymentId))) throw new Error("Invalid deployment");
    return { deploymentId: i.deploymentId.toLowerCase() };
  })
  .handler(async ({ data, context }): Promise<PcartVerifyResult> => {
    const ctx = context as Ctx;
    const loaded = await loadIntent(ctx, data.deploymentId);
    if ("error" in loaded) return { ok: false, reason: String(loaded.error) };
    const { d } = loaded;
    if (d.status !== "CONFIRMED" || d.block_number === null || !d.block_hash) return { ok: false, reason: "NOT_CONFIRMED" };
    if (d.finality_state === "FINALIZED") return { ok: true, outcome: "FINALIZED", status: d.status, finalityState: d.finality_state };
    const client = managedClient();
    if (!client) return { ok: false, reason: "MANAGED_RPC_UNCONFIGURED" };
    const blockNumber = BigInt(d.block_number);
    let finalizedHead: bigint | undefined;
    let reread: string | null | undefined;
    try {
      if ((await client.getChainId()) !== 4663) return { ok: false, reason: "CHAIN_MISMATCH" };
      const fb = await client.getBlock({ blockTag: "finalized" });
      finalizedHead = typeof fb?.number === "bigint" ? fb.number : undefined;
      // Re-read the deployment block by number AFTER the finalized head.
      const b = await client.getBlock({ blockNumber });
      reread = b?.hash ? b.hash.toLowerCase() : null;
    } catch {
      finalizedHead = undefined;
    }
    const out = classifyPcartP6Finality({
      blockNumber,
      blockHash: d.block_hash,
      storedHead: d.finalized_head_block_number === null ? null : BigInt(d.finalized_head_block_number),
      finalizedHead,
      rereadHash: reread,
    });
    if (out.kind === "RETRYABLE") return { ok: true, outcome: "RETRYABLE", reason: "PROVIDER_UNAVAILABLE", status: d.status, finalityState: d.finality_state };
    const args: Record<string, unknown> = { _deployment_id: d.id, _finality_state: out.kind };
    if (out.kind === "FINALIZED") Object.assign(args, { _finalized_block_number: Number(blockNumber), _finalized_head_block_number: Number(out.head), _reread_block_hash: out.rereadHash });
    else if (out.kind === "FINALITY_PENDING") Object.assign(args, { _finalized_head_block_number: Number(out.head), _reread_block_hash: d.block_hash });
    else Object.assign(args, { _finalized_head_block_number: out.head === null ? null : Number(out.head), _finality_notice: out.reason });
    const { data: row, error } = await ctx.supabase.rpc("apply_canonical_pcart_production_finality", args);
    if (error || !row) return { ok: false, reason: "APPLY_REFUSED" };
    return { ok: true, outcome: out.kind, status: row.status, finalityState: row.finality_state };
  });
