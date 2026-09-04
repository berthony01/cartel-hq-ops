import { encodeAbiParameters } from "viem";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  CHAIN_ID_HEX,
  ROBINHOOD_TESTNET_CHAIN_ID,
  ROBINHOOD_TESTNET_EXPLORER_URL,
  ROBINHOOD_TESTNET_RPC_URL,
  TEST_ARTIFACT_CREATION_BYTECODE,
} from "./chain-registry";
import {
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
} from "./cartel-fixed-erc20.artifact";

/**
 * C8.2 — Cartel Chain Launcher client layer (TESTNET ONLY).
 *
 * The user's injected wallet is the ONLY signer. This module never requests,
 * stores, derives or transmits a private key, seed phrase or signature
 * material, and there is no server-side signer anywhere in the system.
 *
 * It never writes `launches.official_contract_address` and never transitions
 * a launch lifecycle status.
 */

export type DeploymentRow = Database["public"]["Tables"]["launch_chain_deployments"]["Row"];
export type DeploymentStatus = DeploymentRow["status"];

export const chainDeploymentsQueryKey = (launchId: string | null) =>
  ["chain-deployments", launchId ?? "none"] as const;

/* ------------------------------------------------------------------ */
/* Injected EIP-1193 wallet                                            */
/* ------------------------------------------------------------------ */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

export class WalletError extends Error {
  code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/** EIP-1193 user rejection. */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("user rejected") || message.includes("user denied");
}

export async function connectWallet(): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("No browser wallet detected.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!address) throw new WalletError("Wallet returned no account.");
  return address.toLowerCase();
}

export async function readChainId(): Promise<number | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    const hex = (await provider.request({ method: "eth_chainId" })) as string;
    const parsed = Number.parseInt(hex, 16);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readBalanceWei(address: string): Promise<bigint | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    const hex = (await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    })) as string;
    return BigInt(hex);
  } catch {
    return null;
  }
}

export function formatEth(wei: bigint | null): string {
  if (wei === null) return "—";
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole.toString()}.${frac} ETH`;
}

/** Switches (or adds) the wallet to Robinhood Chain Testnet. Testnet only. */
export async function ensureTestnet(): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("No browser wallet detected.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Robinhood Chain Testnet",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [ROBINHOOD_TESTNET_RPC_URL],
            blockExplorerUrls: [ROBINHOOD_TESTNET_EXPLORER_URL],
          },
        ],
      });
      return;
    }
    throw error;
  }
}

/**
 * Broadcasts the fixed test artifact as a contract creation.
 * `to` is omitted (contract creation) and `value` is zero, both enforced again
 * server-side during verification.
 */
export async function broadcastTestDeployment(from: string): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("No browser wallet detected.");

  const chainId = await readChainId();
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID) {
    throw new WalletError("Wallet is not on Robinhood Chain Testnet.");
  }

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, data: TEST_ARTIFACT_CREATION_BYTECODE, value: "0x0" }],
  })) as string;

  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new WalletError("Wallet returned an invalid transaction hash.");
  }
  return hash.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Server state (all writes go through SECURITY DEFINER RPCs)          */
/* ------------------------------------------------------------------ */

function fail(message: string): never {
  throw new Error(message);
}

export async function listChainDeployments(launchId: string): Promise<DeploymentRow[]> {
  const { data, error } = await supabase.rpc("list_launch_chain_deployments", {
    _launch_id: launchId,
  });
  if (error) fail(error.message || "Could not load deployment attempts.");
  return (data ?? []) as DeploymentRow[];
}

export function newClientRequestId(): string {
  return `cr_${crypto.randomUUID()}`;
}

export async function createDeploymentAttempt(input: {
  launchId: string;
  clientRequestId: string;
  deployerAddress: string;
}): Promise<DeploymentRow> {
  const { data, error } = await supabase.rpc("create_launch_chain_deployment_attempt", {
    _launch_id: input.launchId,
    _client_request_id: input.clientRequestId,
    _deployer_address: input.deployerAddress.toLowerCase(),
  });
  if (error) fail(error.message || "Could not start a deployment attempt.");
  return data as unknown as DeploymentRow;
}

export async function submitDeploymentTx(
  deploymentId: string,
  txHash: string,
): Promise<DeploymentRow> {
  const { data, error } = await supabase.rpc("submit_launch_chain_deployment_tx", {
    _deployment_id: deploymentId,
    _tx_hash: txHash.toLowerCase(),
  });
  if (error) fail(error.message || "Could not record the transaction.");
  return data as unknown as DeploymentRow;
}

export async function abandonDeploymentAttempt(
  deploymentId: string,
  reason: string,
): Promise<DeploymentRow> {
  const { data, error } = await supabase.rpc("abandon_launch_chain_deployment_attempt", {
    _deployment_id: deploymentId,
    _reason: reason,
  });
  if (error) fail(error.message || "Could not abandon the attempt.");
  return data as unknown as DeploymentRow;
}

export const DEPLOYMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not broadcast",
  SUBMITTED: "Broadcast",
  PENDING: "Confirming",
  CONFIRMED: "Verified on testnet",
  FAILED: "Failed",
  ABANDONED: "Cancelled",
};

export function isTerminal(status: string): boolean {
  return status === "CONFIRMED" || status === "FAILED" || status === "ABANDONED";
}
