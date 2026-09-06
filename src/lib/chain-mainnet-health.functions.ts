import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
  ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL,
} from "./chain-mainnet-registry";

/**
 * P1 — Robinhood Chain PRODUCTION (4663) READ-ONLY capability probe.
 *
 * This authenticated server function performs JSON-RPC READS ONLY. It cannot
 * sign, broadcast, deploy, approve, add liquidity, mutate the database, call a
 * Supabase RPC, transition a lifecycle, or send a Telegram message. It exists
 * solely to answer: is a managed production provider configured and reachable,
 * does it report chain 4663, and does it ACCEPT the `safe` / `finalized` block
 * tags.
 *
 * Capability is NOT semantics. Even a fully healthy probe leaves
 * `productionFinalitySemanticsVerified` false and `finalityGate` "UNRESOLVED".
 *
 * Secret handling: the managed RPC URL is read from process.env inside the
 * handler only, is never returned, logged, or embedded in an error message,
 * and there is NO silent fallback from the managed provider to the public
 * diagnostic endpoint — the two observations stay strictly separate.
 */

const REQUEST_TIMEOUT_MS = 8_000;

type Notice =
  | "OK"
  | "NOT_CONFIGURED"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "RPC_ERROR"
  | "MALFORMED_RESPONSE"
  | "CHAIN_MISMATCH";

export type ProviderKind = "MANAGED" | "PUBLIC_DIAGNOSTIC_ONLY";

export type ChainProbeResult = {
  providerKind: ProviderKind;
  /** Managed only; always true for the public diagnostic endpoint. */
  configured: boolean;
  reachable: boolean;
  observedChainId: number | null;
  chainOk: boolean;
  latestBlockNumber: string | null;
  safeBlockNumber: string | null;
  finalizedBlockNumber: string | null;
  latestL1BlockNumber: string | null;
  safeL1BlockNumber: string | null;
  finalizedL1BlockNumber: string | null;
  safeTagSupported: boolean;
  finalizedTagSupported: boolean;
  orderingOk: boolean;
  notice: Notice;
};

export type MainnetHealthResult = {
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  managed: ChainProbeResult;
  publicDiagnostic: ChainProbeResult;
  managedReadReady: boolean;
  publicDiagnosticHealthy: boolean;
  /** ALWAYS false in P1. Tag acceptance is not proof of finality semantics. */
  productionFinalitySemanticsVerified: false;
  productionTransactionsEnabled: typeof MAINNET_DEPLOYMENT_TX_ENABLED;
  productionLiquidityEnabled: typeof MAINNET_LIQUIDITY_TX_ENABLED;
  finalityGate: "UNRESOLVED";
};

function emptyProbe(kind: ProviderKind, notice: Notice, configured: boolean): ChainProbeResult {
  return {
    providerKind: kind,
    configured,
    reachable: false,
    observedChainId: null,
    chainOk: false,
    latestBlockNumber: null,
    safeBlockNumber: null,
    finalizedBlockNumber: null,
    latestL1BlockNumber: null,
    safeL1BlockNumber: null,
    finalizedL1BlockNumber: null,
    safeTagSupported: false,
    finalizedTagSupported: false,
    orderingOk: false,
    notice,
  };
}

/** Strict hex quantity parser. Anything malformed yields null, never a guess. */
function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (!/^0x(0|[1-9a-f][0-9a-f]*)$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

type RpcOutcome<T> = { ok: true; value: T } | { ok: false; notice: Notice };

async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<RpcOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, notice: "RPC_ERROR" };
    const payload = (await response.json()) as { result?: unknown; error?: unknown };
    if (payload.error !== undefined && payload.error !== null) {
      return { ok: false, notice: "RPC_ERROR" };
    }
    if (payload.result === undefined) return { ok: false, notice: "MALFORMED_RESPONSE" };
    return { ok: true, value: payload.result as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    // Never surface the endpoint or the provider error text.
    return { ok: false, notice: aborted ? "TIMEOUT" : "UNREACHABLE" };
  } finally {
    clearTimeout(timer);
  }
}

type BlockShape = { number?: unknown; l1BlockNumber?: unknown };

async function readBlock(
  endpoint: string,
  tag: "latest" | "safe" | "finalized",
): Promise<{ number: bigint | null; l1: bigint | null; supported: boolean }> {
  const outcome = await rpcCall<BlockShape | null>(endpoint, "eth_getBlockByNumber", [tag, false]);
  if (!outcome.ok || outcome.value === null || typeof outcome.value !== "object") {
    return { number: null, l1: null, supported: false };
  }
  const number = parseHexQuantity(outcome.value.number);
  if (number === null) return { number: null, l1: null, supported: false };
  return { number, l1: parseHexQuantity(outcome.value.l1BlockNumber), supported: true };
}

/**
 * Read-only probe. Allowed methods only: eth_chainId, eth_blockNumber and
 * eth_getBlockByNumber(latest|safe|finalized, false).
 */
async function probeEndpoint(endpoint: string, kind: ProviderKind): Promise<ChainProbeResult> {
  const chainIdOutcome = await rpcCall<string>(endpoint, "eth_chainId", []);
  if (!chainIdOutcome.ok) return emptyProbe(kind, chainIdOutcome.notice, true);

  const observed = parseHexQuantity(chainIdOutcome.value);
  if (observed === null) return emptyProbe(kind, "MALFORMED_RESPONSE", true);

  const observedChainId = Number(observed);
  const chainOk = observedChainId === ROBINHOOD_MAINNET_CHAIN_ID;

  const base = emptyProbe(kind, chainOk ? "OK" : "CHAIN_MISMATCH", true);
  base.reachable = true;
  base.observedChainId = observedChainId;
  base.chainOk = chainOk;
  if (!chainOk) return base;

  const headOutcome = await rpcCall<string>(endpoint, "eth_blockNumber", []);
  const head = headOutcome.ok ? parseHexQuantity(headOutcome.value) : null;

  const [latest, safe, finalized] = await Promise.all([
    readBlock(endpoint, "latest"),
    readBlock(endpoint, "safe"),
    readBlock(endpoint, "finalized"),
  ]);

  const latestNumber = latest.number ?? head;
  base.latestBlockNumber = latestNumber === null ? null : latestNumber.toString();
  base.safeBlockNumber = safe.number === null ? null : safe.number.toString();
  base.finalizedBlockNumber = finalized.number === null ? null : finalized.number.toString();
  base.latestL1BlockNumber = latest.l1 === null ? null : latest.l1.toString();
  base.safeL1BlockNumber = safe.l1 === null ? null : safe.l1.toString();
  base.finalizedL1BlockNumber = finalized.l1 === null ? null : finalized.l1.toString();
  base.safeTagSupported = safe.supported;
  base.finalizedTagSupported = finalized.supported;
  base.orderingOk =
    latestNumber !== null &&
    safe.number !== null &&
    finalized.number !== null &&
    finalized.number <= safe.number &&
    safe.number <= latestNumber;

  if (latestNumber === null || !safe.supported || !finalized.supported) {
    base.notice = "MALFORMED_RESPONSE";
  }
  return base;
}

export const probeMainnetReadHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MainnetHealthResult> => {
    // Server-only. Never returned, logged, or included in any error.
    const managedEndpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();

    // No silent fallback: an unconfigured managed provider stays unconfigured.
    const managed = managedEndpoint
      ? await probeEndpoint(managedEndpoint, "MANAGED")
      : emptyProbe("MANAGED", "NOT_CONFIGURED", false);

    const publicDiagnostic = await probeEndpoint(
      ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL,
      "PUBLIC_DIAGNOSTIC_ONLY",
    );

    const managedReadReady =
      managed.configured &&
      managed.reachable &&
      managed.chainOk &&
      managed.latestBlockNumber !== null &&
      managed.safeTagSupported &&
      managed.finalizedTagSupported &&
      managed.orderingOk;

    const publicDiagnosticHealthy =
      publicDiagnostic.reachable && publicDiagnostic.chainOk && publicDiagnostic.orderingOk;

    return {
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      managed,
      publicDiagnostic,
      managedReadReady,
      publicDiagnosticHealthy,
      productionFinalitySemanticsVerified: false,
      productionTransactionsEnabled: MAINNET_DEPLOYMENT_TX_ENABLED,
      productionLiquidityEnabled: MAINNET_LIQUIDITY_TX_ENABLED,
      finalityGate: "UNRESOLVED",
    };
  });
