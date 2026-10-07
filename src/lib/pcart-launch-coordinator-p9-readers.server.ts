/**
 * PCART P9.1 — server-only read-only chain readers (Robinhood Chain mainnet 4663).
 * Uses only eth_chainId, eth_getBlockByNumber, eth_gasPrice, eth_getCode and Safe view calls.
 * No wallet client, no signer, no transaction, no Safe proposal. RPC URL never leaves the server.
 */
import { createPublicClient, http, keccak256, parseAbi } from "viem";

import { ROBINHOOD_MAINNET_MANAGED_RPC_ENV } from "@/lib/chain-mainnet-registry";
import { P8A_MAINNET_DEPENDENCIES } from "@/lib/pcart-auction-liquidity-plan";
import { P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import { P9_CADENCE_SAMPLE_BLOCKS, type P9ChainObservation, type P9SafeObservation } from "@/lib/pcart-launch-coordinator-p9-live";

const PUBLIC_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const SAFE_ABI = parseAbi(["function VERSION() view returns (string)", "function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])", "function nonce() view returns (uint256)"]);

function client() {
  const url = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim() || PUBLIC_MAINNET_RPC;
  return createPublicClient({ transport: http(url, { timeout: 12_000 }) });
}
const codeHash = async (c: ReturnType<typeof client>, address: string): Promise<string | null | undefined> => {
  try { const code = await c.getCode({ address: address as `0x${string}` }); return code && code !== "0x" ? keccak256(code) : null; } catch { return undefined; }
};

export async function readP9Live(officialToken: string | null, deployer: string | null = null) {
  const c = client();
  const capturedAt = new Date().toISOString();
  let chain: P9ChainObservation;
  let chainId: number | null = null;
  try {
    const [id, latest, gas] = await Promise.all([c.getChainId(), c.getBlock({ blockTag: "latest" }), c.getGasPrice().catch(() => null)]);
    chainId = id;
    const sample = await c.getBlock({ blockNumber: latest.number - P9_CADENCE_SAMPLE_BLOCKS });
    chain = { ok: true, chainId: id, latestBlock: latest.number, latestTimestampSec: Number(latest.timestamp), sampleBlock: sample.number, sampleTimestampSec: Number(sample.timestamp), gasPriceWei: gas, capturedAt };
  } catch (e) {
    chain = { ok: false, error: e instanceof Error ? e.name : "CHAIN_READ_FAILED", capturedAt };
  }

  let safe: P9SafeObservation | null = null;
  try {
    const addr = P8B_REAL_TREASURY_SAFE.address as `0x${string}`;
    const [h, v, t, o, n] = await Promise.all([
      codeHash(c, addr),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "VERSION" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "getThreshold" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "getOwners" }),
      c.readContract({ address: addr, abi: SAFE_ABI, functionName: "nonce" }),
    ]);
    safe = { codePresent: h === undefined ? null : !!h, codeHash: h ?? null, version: String(v), threshold: Number(t), owners: (o as string[]).map(String), nonce: Number(n), chainId, capturedAt };
  } catch { safe = null; }

  const deps: Record<string, string | null | undefined> = {};
  await Promise.all(P8A_MAINNET_DEPENDENCIES.map(async (d) => { deps[d.key] = await codeHash(c, d.address); }));

  const officialTokenCodeHash = officialToken ? await codeHash(c, officialToken) : null;
  // P9.2: read-only deployer nonce (latest) + balance for preflight. No signer, no transaction.
  let deployerLive: { nonce: string | null; balanceWei: string | null } = { nonce: null, balanceWei: null };
  if (deployer && /^0x[0-9a-fA-F]{40}$/.test(deployer)) {
    const addr = deployer as `0x${string}`;
    const [n, b] = await Promise.all([c.getTransactionCount({ address: addr, blockTag: "latest" }).catch(() => null), c.getBalance({ address: addr }).catch(() => null)]);
    deployerLive = { nonce: n == null ? null : String(n), balanceWei: b == null ? null : b.toString() };
  }
  return { chain, safe, deps, officialTokenCodeHash: officialTokenCodeHash ?? null, deployerLive };
}

// ------------------------------------------------------------ P9.3A additions (read-only)
import { P8B_CODE_HASH_ATTESTATIONS } from "@/lib/pcart-auction-execution-p8b";
import { observedMsPerBlock } from "@/lib/pcart-launch-coordinator-p9-live";
import type { FreshHead, P93AuctionObservation } from "@/lib/pcart-launch-coordinator-p9-3";

/** Fresh head + every P8B-pinned code hash + official token runtime keccak + Safe. View calls only. */
export async function readP9_3PrepareFacts(officialToken: string | null) {
  const base = await readP9Live(officialToken, null);
  const c = client();
  const observed: Record<string, string | null | undefined> = { ...base.deps };
  await Promise.all(P8B_CODE_HASH_ATTESTATIONS.filter((a) => !(a.key in observed)).map(async (a) => { observed[a.key] = await codeHash(c, a.address); }));
  let head: FreshHead | null = null;
  if (base.chain.ok) {
    const ch = base.chain;
    head = { chainId: ch.chainId, block: ch.latestBlock, timestampSec: ch.latestTimestampSec, capturedAtMs: Date.parse(ch.capturedAt),
      msPerBlock: observedMsPerBlock(ch.latestBlock, ch.latestTimestampSec, ch.sampleBlock, ch.sampleTimestampSec) };
  }
  return { head, observed, safe: base.safe, tokenRuntimeKeccak: base.officialTokenCodeHash };
}

/** Auction views proven by the P8B fork rehearsal (ICCA): endBlock, currencyRaised, isGraduated, totalCleared, clearingPrice, tokensRecipient, fundsRecipient. */
const CCA_VIEW_ABI = parseAbi([
  "function endBlock() view returns (uint64)", "function currencyRaised() view returns (uint256)", "function isGraduated() view returns (bool)",
  "function totalCleared() view returns (uint256)", "function clearingPrice() view returns (uint256)",
  "function tokensRecipient() view returns (address)", "function fundsRecipient() view returns (address)",
]);
export async function readP9_3Auction(auctionAddress: string): Promise<P93AuctionObservation> {
  const capturedAt = new Date().toISOString();
  if (!/^0x[0-9a-fA-F]{40}$/.test(auctionAddress)) return { ok: false, capturedAt };
  const c = client();
  const address = auctionAddress as `0x${string}`;
  try {
    const [e, r, g, t, p, tr, fr] = await Promise.all((["endBlock", "currencyRaised", "isGraduated", "totalCleared", "clearingPrice", "tokensRecipient", "fundsRecipient"] as const)
      .map((fn) => c.readContract({ address, abi: CCA_VIEW_ABI, functionName: fn } as any)));
    return { ok: true, endBlock: BigInt(e as bigint), currencyRaisedWei: BigInt(r as bigint), isGraduated: g === true, totalClearedWei: BigInt(t as bigint), clearingPriceQ96: BigInt(p as bigint), tokensRecipient: String(tr), fundsRecipient: String(fr), capturedAt };
  } catch { return { ok: false, capturedAt }; }
}

// ------------------------------------------------------------ P9.3B additions (read-only; eth_call simulation only)
/** Owner account code for each canonical Treasury Safe owner (EOA / EIP-7702 designator / contract). */
export async function readP9_3bOwnerCodes(owners: readonly string[]): Promise<Record<string, string | null>> {
  const c = client();
  const out: Record<string, string | null> = {};
  await Promise.all(owners.map(async (o) => { try { out[o.toLowerCase()] = (await c.getCode({ address: o as `0x${string}` })) ?? "0x"; } catch { out[o.toLowerCase()] = null; } }));
  return out;
}
const SAFE_CHECK_ABI = parseAbi(["function checkSignatures(bytes32 dataHash, bytes data, bytes signatures) view"]);
/** Safe 1.4.1's own validation (reverts on any invalid/unsorted/insufficient set). Read-only eth_call. */
export async function safeAcceptsSignatures(safeTxHash: `0x${string}`, signatures: `0x${string}`): Promise<boolean | null> {
  const c = client();
  try {
    await c.readContract({ address: P8B_REAL_TREASURY_SAFE.address as `0x${string}`, abi: SAFE_CHECK_ABI, functionName: "checkSignatures", args: [safeTxHash, "0x", signatures] });
    return true;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return /ContractFunctionRevertedError|ContractFunctionExecutionError|CallExecutionError/.test(name) ? false : null;
  }
}
export async function readP9_3bReceipt(txHash: `0x${string}`) {
  const c = client();
  try {
    const r = await c.getTransactionReceipt({ hash: txHash });
    return { status: r.status, to: r.to ?? null, blockNumber: r.blockNumber, logs: r.logs.map((l) => ({ address: l.address, topics: l.topics as string[], data: l.data })) } as const;
  } catch { return null; }
}
export async function readP9_3bSafeNonce(): Promise<number | null> {
  try { return Number(await client().readContract({ address: P8B_REAL_TREASURY_SAFE.address as `0x${string}`, abi: SAFE_ABI, functionName: "nonce" })); } catch { return null; }
}
