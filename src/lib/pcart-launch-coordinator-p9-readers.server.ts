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
