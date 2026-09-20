import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_MANAGED_RPC_ENV,
} from "./chain-mainnet-registry";
import {
  encodeGetModulesPaginatedCall,
  evaluateSafeTreasury,
  isCandidateTreasuryAddress,
  normalizeTreasuryAddress,
  SAFE_GET_OWNERS_SELECTOR,
  SAFE_GET_THRESHOLD_SELECTOR,
  SAFE_GUARD_STORAGE_SLOT,
  SAFE_MASTER_COPY_SELECTOR,
  SAFE_NONCE_SELECTOR,
  SAFE_VERSION_SELECTOR,
  treasurySafeReadFailure,
  type TreasurySafeVerification,
} from "./treasury-safe-verify";

/**
 * PCART-L1B — authenticated, READ-ONLY canonical Safe v1.4.1 verification.
 *
 * Allowed JSON-RPC methods, and nothing else: `eth_chainId`, `eth_getCode`,
 * `eth_getStorageAt` (guard slot) and `eth_call` for the Safe READ selectors
 * masterCopy(), getOwners(), getThreshold(), VERSION(), nonce() and
 * getModulesPaginated(). There is no signing, no `eth_sendTransaction`, no
 * `eth_sendRawTransaction`, no wallet use, no database read or write, no
 * Supabase RPC, no lifecycle change and no persistence of any kind. The
 * result is ephemeral.
 *
 * The managed Robinhood mainnet RPC URL is read from process.env inside the
 * handler only. It is never returned, logged, or included in an error, and
 * there is NO fallback to the public diagnostic endpoint — an unverifiable
 * check stays unverified. Every failed or malformed read fails CLOSED.
 */

const REQUEST_TIMEOUT_MS = 8_000;

type RpcOutcome = { ok: true; value: unknown } | { ok: false; failed: true };

async function rpcCall(endpoint: string, method: string, params: unknown[]): Promise<RpcOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, failed: true };
    const payload = (await response.json()) as { result?: unknown; error?: unknown };
    if (payload.error !== undefined && payload.error !== null) return { ok: false, failed: true };
    if (payload.result === undefined) return { ok: false, failed: true };
    return { ok: true, value: payload.result };
  } catch {
    // Never surface the endpoint or the provider error text.
    return { ok: false, failed: true };
  } finally {
    clearTimeout(timer);
  }
}

function parseChainId(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    const parsed = Number(BigInt(value));
    return Number.isSafeInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const verifyTreasurySafe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) => ({ address: String(input?.address ?? "") }))
  .handler(async ({ data }): Promise<TreasurySafeVerification> => {
    const address = normalizeTreasuryAddress(data.address);
    if (!isCandidateTreasuryAddress(address)) {
      return treasurySafeReadFailure(
        address,
        "INVALID_ADDRESS",
        "That is not a usable wallet address.",
      );
    }

    // Server-only. Never returned, logged, or included in any error.
    const endpoint = process.env[ROBINHOOD_MAINNET_MANAGED_RPC_ENV]?.trim();
    if (!endpoint) {
      return treasurySafeReadFailure(
        address,
        "PROVIDER_NOT_CONFIGURED",
        "The Robinhood Chain connection is not configured, so nothing could be checked.",
      );
    }

    const chainOutcome = await rpcCall(endpoint, "eth_chainId", []);
    if (!chainOutcome.ok) {
      return treasurySafeReadFailure(
        address,
        "PROVIDER_UNREACHABLE",
        "Robinhood Chain could not be reached, so nothing was verified. Try again shortly.",
      );
    }
    const observedChainId = parseChainId(chainOutcome.value);
    if (observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
      return treasurySafeReadFailure(
        address,
        "CHAIN_MISMATCH",
        "The network did not identify itself as Robinhood Chain mainnet, so nothing was verified.",
      );
    }

    const [code, masterCopy, owners, threshold, version, nonce, modules, guard] = await Promise.all([
      rpcCall(endpoint, "eth_getCode", [address, "latest"]),
      rpcCall(endpoint, "eth_call", [{ to: address, data: SAFE_MASTER_COPY_SELECTOR }, "latest"]),
      rpcCall(endpoint, "eth_call", [{ to: address, data: SAFE_GET_OWNERS_SELECTOR }, "latest"]),
      rpcCall(endpoint, "eth_call", [{ to: address, data: SAFE_GET_THRESHOLD_SELECTOR }, "latest"]),
      rpcCall(endpoint, "eth_call", [{ to: address, data: SAFE_VERSION_SELECTOR }, "latest"]),
      rpcCall(endpoint, "eth_call", [{ to: address, data: SAFE_NONCE_SELECTOR }, "latest"]),
      rpcCall(endpoint, "eth_call", [
        { to: address, data: encodeGetModulesPaginatedCall() },
        "latest",
      ]),
      rpcCall(endpoint, "eth_getStorageAt", [address, SAFE_GUARD_STORAGE_SLOT, "latest"]),
    ]);

    // Any failed read is passed through as null and fails closed downstream.
    return evaluateSafeTreasury({
      address,
      observedChainId,
      codeHex: code.ok ? code.value : null,
      masterCopyData: masterCopy.ok ? masterCopy.value : null,
      ownersData: owners.ok ? owners.value : null,
      thresholdData: threshold.ok ? threshold.value : null,
      versionData: version.ok ? version.value : null,
      nonceData: nonce.ok ? nonce.value : null,
      modulesData: modules.ok ? modules.value : null,
      guardStorageData: guard.ok ? guard.value : null,
    });
  });
