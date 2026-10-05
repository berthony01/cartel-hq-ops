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
 * The operator's explicitly connected wallet is the ONLY signer. This module never requests,
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

/* ------------------------------------------------------------------ */
/* EXPLICITLY BOUND launcher provider (Testnet Lab)                    */
/* ------------------------------------------------------------------ */

/**
 * The ONE provider every launcher read, switch and broadcast goes through.
 * It is set ONLY by an explicit operator connect (chooser or injected) via
 * `testnet-wallet-connector.ts`, together with the account the operator
 * selected. There is deliberately NO fallback to `window.ethereum`: the UI
 * can never show WalletConnect account A while a send goes out through an
 * injected account B.
 */
let launcherProvider: Eip1193Provider | null = null;
let launcherAccount: string | null = null;

export function setLauncherProvider(provider: Eip1193Provider | null, account: string | null): void {
  launcherProvider = provider;
  launcherAccount = provider && account ? account.toLowerCase() : null;
}

export function getLauncherProvider(): Eip1193Provider | null {
  return launcherProvider;
}

export function getLauncherAccount(): string | null {
  return launcherAccount;
}

/** Strict chain-id normalization: injected wallets answer hex, WalletConnect may answer a number. */
export function parseChainId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (/^0x[0-9a-f]+$/.test(v)) return Number.parseInt(v, 16);
    if (/^eip155:[0-9]+$/.test(v)) return Number.parseInt(v.slice(7), 10);
    if (/^[0-9]+$/.test(v)) return Number.parseInt(v, 10);
  }
  return null;
}

/** Desktop-extension fallback: explicit click only. Binds the injected wallet. */
export async function connectWallet(): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) throw new WalletError("No browser wallet detected.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!address) throw new WalletError("Wallet returned no account.");
  setLauncherProvider(provider, address);
  return address.toLowerCase();
}

/**
 * Read-only: the SELECTED account, re-proven against the bound provider's
 * live approved accounts. Never prompts. Returns null when the selection is
 * no longer approved (account switched in the wallet).
 */
export async function readAccount(): Promise<string | null> {
  const provider = getLauncherProvider();
  const selected = launcherAccount;
  if (!provider || !selected) return null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
    if (!Array.isArray(accounts)) return null;
    const live = accounts.filter((a): a is string => typeof a === "string").map((a) => a.toLowerCase());
    return live.includes(selected) ? selected : null;
  } catch {
    return null;
  }
}

export async function readChainId(): Promise<number | null> {
  const provider = getLauncherProvider();
  if (!provider) return null;
  try {
    return parseChainId(await provider.request({ method: "eth_chainId" }));
  } catch {
    return null;
  }
}

export async function readBalanceWei(address: string): Promise<bigint | null> {
  const provider = getLauncherProvider();
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

export type TestnetSwitchOutcome = "SWITCHED" | "REJECTED" | "UNKNOWN_NETWORK" | "FAILED" | "NO_WALLET";

/** EXPLICIT CLICK ONLY. Switch the bound wallet to Robinhood Chain Testnet. Never adds. */
export async function requestTestnetSwitch(): Promise<TestnetSwitchOutcome> {
  const provider = getLauncherProvider();
  if (!provider) return "NO_WALLET";
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    return "SWITCHED";
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 4001) return "REJECTED";
    if (code === 4902) return "UNKNOWN_NETWORK";
    return "FAILED";
  }
}

/** Frozen official Robinhood Chain TESTNET parameters (chain 46630 only). */
export const TESTNET_ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [ROBINHOOD_TESTNET_RPC_URL],
  blockExplorerUrls: [ROBINHOOD_TESTNET_EXPLORER_URL],
} as const;

/** EXPLICIT CLICK ONLY, offered after the wallet reports the network unknown. */
export async function requestTestnetAdd(): Promise<TestnetSwitchOutcome> {
  const provider = getLauncherProvider();
  if (!provider) return "NO_WALLET";
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [TESTNET_ADD_CHAIN_PARAMS] });
    return "SWITCHED";
  } catch (error) {
    return (error as { code?: number } | null)?.code === 4001 ? "REJECTED" : "FAILED";
  }
}

/**
 * Broadcasts the fixed test artifact as a contract creation.
 * `to` is omitted (contract creation) and `value` is zero, both enforced again
 * server-side during verification.
 */
export async function broadcastTestDeployment(from: string): Promise<string> {
  const provider = getLauncherProvider();
  if (!provider) throw new WalletError("Connect a wallet first.");
  const liveAccount = await readAccount();
  if (!liveAccount || liveAccount !== from.toLowerCase()) {
    throw new WalletError("The connected wallet account changed. Reconnect and try again.");
  }

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

/* ------------------------------------------------------------------ */
/* C8.3 — fixed-supply ERC-20 test token (TESTNET ONLY)                */
/* ------------------------------------------------------------------ */

/**
 * The token intent the operator typed. There is no free-form Solidity or
 * bytecode input anywhere: only these four values are variable, and the
 * creation bytecode is the frozen, pre-compiled artifact.
 */
export type TokenIntentInput = {
  name: string;
  symbol: string;
  /** Whole tokens, as typed. Never base units. */
  supplyWhole: string;
  recipient: string;
};

export type TokenIntent = {
  name: string;
  symbol: string;
  supplyWhole: bigint;
  /** supplyWhole * 10^18. */
  totalSupply: bigint;
  recipient: string;
};

export const TOKEN_NAME_MAX = 32;
export const TOKEN_SUPPLY_MIN_WHOLE = 1n;
export const TOKEN_SUPPLY_MAX_WHOLE = 1_000_000_000_000n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Mirrors the server-side validation exactly. The server remains authoritative. */
export function normalizeTokenIntent(input: TokenIntentInput): TokenIntent {
  const name = input.name.trim();
  if (name.length < 1 || name.length > TOKEN_NAME_MAX) {
    fail(`Token name must be 1–${TOKEN_NAME_MAX} characters.`);
  }
  if (!/^[\x20-\x7e]+$/.test(name)) fail("Token name must be printable ASCII.");

  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,11}$/.test(symbol)) {
    fail("Symbol must be 2–11 characters, A–Z and 0–9 only.");
  }

  const rawSupply = input.supplyWhole.trim().replace(/[\s,]/g, "");
  if (!/^[0-9]+$/.test(rawSupply)) fail("Total supply must be a whole number of tokens.");
  const supplyWhole = BigInt(rawSupply);
  if (supplyWhole < TOKEN_SUPPLY_MIN_WHOLE || supplyWhole > TOKEN_SUPPLY_MAX_WHOLE) {
    fail("Total supply must be between 1 and 1,000,000,000,000 tokens.");
  }

  const recipient = input.recipient.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(recipient)) fail("Recipient must be a valid EVM address.");
  if (recipient === ZERO_ADDRESS) fail("Recipient cannot be the zero address.");

  return {
    name,
    symbol,
    supplyWhole,
    totalSupply: supplyWhole * 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS),
    recipient,
  };
}

/** Frozen creation bytecode + ABI-encoded constructor args. */
export function buildTokenInitCode(intent: TokenIntent): `0x${string}` {
  const args = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient as `0x${string}`],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

/**
 * C8.5 — broadcasts the EXACT init code that the operator reviewed in the
 * active simulation. The bytes are passed in; nothing is re-encoded or
 * re-derived here, so the wallet can only ever receive the reviewed payload.
 * `to` is omitted (contract creation) and `value` is zero; the server
 * re-derives and re-checks the init code independently during verification.
 */
export async function broadcastTokenDeployment(
  from: string,
  reviewedInitCode: `0x${string}`,
): Promise<string> {
  // The SAME explicitly bound connector the Testnet Lab displays. Live chain +
  // live selected account are re-read from it below before any send.
  const provider = getLauncherProvider();
  if (!provider) throw new WalletError("Connect a wallet first.");

  if (typeof reviewedInitCode !== "string" || !/^0x[0-9a-f]+$/i.test(reviewedInitCode)) {
    throw new WalletError("The reviewed deployment payload is not valid creation data.");
  }
  if (reviewedInitCode.length % 2 !== 0) {
    throw new WalletError("The reviewed deployment payload is not byte-aligned.");
  }

  const chainId = await readChainId();
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID) {
    throw new WalletError("Wallet is not on Robinhood Chain Testnet.");
  }

  const liveAccount = await readAccount();
  if (!liveAccount || liveAccount !== from.toLowerCase()) {
    throw new WalletError("The connected wallet account changed. Run the simulation again.");
  }

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, data: reviewedInitCode, value: "0x0" }],
  })) as string;

  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new WalletError("Wallet returned an invalid transaction hash.");
  }
  return hash.toLowerCase();
}

/** Strict validator for a 32-byte transaction hash, used by recovery paths. */
export function isValidTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

export async function createTokenDeploymentAttempt(input: {
  launchId: string;
  clientRequestId: string;
  deployerAddress: string;
  intent: TokenIntent;
}): Promise<DeploymentRow> {
  const { data, error } = await supabase.rpc("create_launch_chain_token_deployment_attempt", {
    _launch_id: input.launchId,
    _client_request_id: input.clientRequestId,
    _deployer_address: input.deployerAddress.toLowerCase(),
    _token_name: input.intent.name,
    _token_symbol: input.intent.symbol,
    // Sent as a decimal string: base units exceed IEEE-754 safe integers.
    // PostgREST casts the text to `numeric` for the RPC parameter.
    _token_total_supply: input.intent.totalSupply.toString() as unknown as number,
    _token_recipient: input.intent.recipient,
  });
  if (error) fail(error.message || "Could not start a token deployment attempt.");
  return data as unknown as DeploymentRow;
}

/**
 * Display helper for base-unit supplies. Only an exact decimal string is
 * treated as trustworthy: token rows must pass the generated
 * `token_total_supply_text` mirror, because the numeric column arrives over
 * JSON as an IEEE-754 double and is not exact above 2^53. Anything else is
 * shown as unavailable rather than as a rounded figure.
 */
export function formatWholeSupply(baseUnits: string | null | undefined): string {
  if (baseUnits === null || baseUnits === undefined || baseUnits === "") return "—";
  if (!/^[0-9]+$/.test(baseUnits)) return "—";
  const scale = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);
  return (BigInt(baseUnits) / scale).toLocaleString("en-US");
}

/**
 * Exact base-unit supply for a token attempt, taken from the generated text
 * mirror only. Never derived from the JSON numeric column.
 */
export function tokenSupplyText(row: DeploymentRow): string | null {
  if (row.deployment_kind !== "FIXED_SUPPLY_ERC20") return null;
  const text = row.token_total_supply_text;
  return typeof text === "string" && /^[0-9]+$/.test(text) ? text : null;
}
