import { keccak256, stringToHex } from "viem";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_ENVIRONMENT,
} from "./chain-mainnet-registry";
import {
  ZERO_ADDRESS,
  buildTokenInitCode,
  getInjectedProvider,
  normalizeTokenIntent,
  type TokenIntent,
  type TokenIntentInput,
} from "./chain-launcher";

/**
 * P2 — Robinhood Chain PRODUCTION (4663) deployment SIMULATION.
 *
 * SCOPE AND SAFETY
 * ----------------
 * This module is a deterministic, zero-persistence, read-only review layer for
 * the frozen fixed-supply ERC-20 creation transaction on production. It is a
 * separate module from the testnet simulation, which it neither imports nor
 * modifies.
 *
 * Invariants enforced by construction:
 *   - no data store, no server mutation, no lifecycle transition, no evidence
 *     write, and no pool/market code is imported or reachable from here;
 *   - every provider interaction is a read; nothing here prepares, authorizes,
 *     signs, or emits a transaction, and no wallet connection prompt or
 *     network-change request is ever issued;
 *   - the operator switches the wallet to production manually; a wrong network
 *     is reported as an error and never corrected programmatically;
 *   - the creation payload is derived only from the frozen artifact plus
 *     ABI-encoded constructor arguments — there is no free-form payload input;
 *   - all supply, balance, gas and fee values are `bigint` or exact decimal
 *     strings; no base-unit value passes through `Number`;
 *   - provider output is untrusted, strictly parsed, and can never influence
 *     the immutable intent fingerprint;
 *   - a passing simulation authorizes nothing. `deploymentAuthorized` is the
 *     literal `false`: read-only correctness is never execution permission,
 *     which remains with the runtime execution control, the canary permit and
 *     the server-issued final send window.
 */

/** Domain separator for the production fingerprint pre-image. */
export const MAINNET_SIMULATION_FINGERPRINT_DOMAIN = "cartel-mainnet-sim-v1" as const;

/** Field separator (ASCII unit separator) — cannot appear in a normalized field. */
const FIELD_SEPARATOR = "\u001f";

/** Production quote lifetime. The immutable intent fingerprint never expires. */
export const MAINNET_SIMULATION_QUOTE_TTL_MS = 60_000;

export type MainnetSimulationIntent = {
  environment: typeof ROBINHOOD_MAINNET_ENVIRONMENT;
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  artifactId: typeof CARTEL_FIXED_ERC20_ARTIFACT_ID;
  runtimeBytecodeHash: string;
  /** Lowercase 0x address of the reviewed deployer. */
  deployer: string;
  /** Lowercase 0x address that receives 100% of the supply. */
  recipient: string;
  name: string;
  symbol: string;
  decimals: typeof CARTEL_FIXED_ERC20_DECIMALS;
  /** Exact whole-token supply, decimal string. */
  supplyWhole: string;
  /** Exact base-unit supply, decimal string. Never a JS number. */
  totalSupplyBaseUnits: string;
  /** Exact creation transaction `data`. */
  initCode: `0x${string}`;
  initCodeHash: string;
  txValueWei: "0";
  fingerprint: string;
  /** Retained only so the exact payload can be rebuilt and re-reviewed. */
  tokenIntent: TokenIntent;
};

export type MainnetPreflightResult = {
  observedChainId: number | null;
  chainOk: boolean;
  observedAccount: string | null;
  accountOk: boolean;
  recipientOk: boolean;
  callOk: boolean;
  /** Decimal strings — exact, never floating point. */
  balanceWei: string | null;
  gasEstimate: string | null;
  feeWeiPerGas: string | null;
  feeSource: "eth_gasPrice" | "baseFee+priority" | null;
  estimatedCostWei: string | null;
  sufficientBalance: boolean | null;
  txValueWei: "0";
  /**
   * Compile-time capability mirror only: whether the production deployment
   * transaction code path is compiled in. It is NOT permission and it is NOT
   * part of `simulationPassed`.
   */
  deploymentTxCapabilityEnabled: boolean;
  errors: string[];
  quotedAtMs: number;
  /**
   * True only when every hard READ-ONLY check passed: chain, account,
   * recipient, init-code call, gas, fees and balance. It is correctness only
   * and it authorizes nothing.
   */
  simulationPassed: boolean;
  /** Always literal false in this module. Simulation never authorizes. */
  deploymentAuthorized: false;
  /**
   * The gates that still stand between a passing simulation and a send. Never
   * claims the compile-time capability switch is the blocker.
   */
  authorizationBlockedBy: "RUNTIME_EXECUTION_CONTROL_AND_SEND_WINDOW";
};

export type MainnetSimulation = {
  intent: MainnetSimulationIntent;
  preflight: MainnetPreflightResult;
};

export class MainnetSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainnetSimulationError";
  }
}

/* ------------------------------------------------------------------ */
/* Intent + fingerprint (pure, deterministic)                          */
/* ------------------------------------------------------------------ */

function normalizeAddress(value: string, label: string): string {
  const address = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new MainnetSimulationError(`${label} is not a valid address.`);
  }
  if (address === ZERO_ADDRESS) {
    throw new MainnetSimulationError(`${label} cannot be the zero address.`);
  }
  return address;
}

/**
 * Canonical production fingerprint pre-image. Domain/version first, every
 * field normalized, and all dynamic chain-derived values deliberately
 * excluded so chain conditions can never alter the reviewed identity.
 */
export function mainnetFingerprintPreimage(fields: {
  environment: string;
  chainId: number;
  artifactId: string;
  runtimeBytecodeHash: string;
  deployer: string;
  recipient: string;
  name: string;
  symbol: string;
  decimals: number;
  supplyWhole: string;
  totalSupplyBaseUnits: string;
  initCodeHash: string;
  txValueWei: string;
}): string {
  return [
    MAINNET_SIMULATION_FINGERPRINT_DOMAIN,
    fields.environment,
    String(fields.chainId),
    fields.artifactId,
    fields.runtimeBytecodeHash.toLowerCase(),
    fields.deployer.toLowerCase(),
    fields.recipient.toLowerCase(),
    fields.name.normalize("NFC"),
    fields.symbol.normalize("NFC"),
    String(fields.decimals),
    fields.supplyWhole,
    fields.totalSupplyBaseUnits,
    fields.initCodeHash.toLowerCase(),
    fields.txValueWei,
  ].join(FIELD_SEPARATOR);
}

/**
 * Builds the frozen, deterministic production intent. Pure: no provider call,
 * no network access, no persistence.
 */
export function buildMainnetSimulationIntent(
  input: TokenIntentInput & { deployer: string },
): MainnetSimulationIntent {
  const deployer = normalizeAddress(input.deployer, "Deployer wallet");

  let tokenIntent: TokenIntent;
  try {
    tokenIntent = normalizeTokenIntent({
      name: input.name,
      symbol: input.symbol,
      supplyWhole: input.supplyWhole,
      recipient: input.recipient,
    });
  } catch (error) {
    throw new MainnetSimulationError(
      error instanceof Error ? error.message : "Check the token details.",
    );
  }

  const recipient = normalizeAddress(tokenIntent.recipient, "Initial recipient");
  const boundIntent: TokenIntent = { ...tokenIntent, recipient };

  const initCode = buildTokenInitCode(boundIntent);
  const initCodeHash = keccak256(initCode);

  const supplyWhole = boundIntent.supplyWhole.toString();
  const totalSupplyBaseUnits = boundIntent.totalSupply.toString();

  const preimage = mainnetFingerprintPreimage({
    environment: ROBINHOOD_MAINNET_ENVIRONMENT,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    artifactId: CARTEL_FIXED_ERC20_ARTIFACT_ID,
    runtimeBytecodeHash: CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
    deployer,
    recipient,
    name: boundIntent.name,
    symbol: boundIntent.symbol,
    decimals: CARTEL_FIXED_ERC20_DECIMALS,
    supplyWhole,
    totalSupplyBaseUnits,
    initCodeHash,
    txValueWei: "0",
  });

  return {
    environment: ROBINHOOD_MAINNET_ENVIRONMENT,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    artifactId: CARTEL_FIXED_ERC20_ARTIFACT_ID,
    runtimeBytecodeHash: CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
    deployer,
    recipient,
    name: boundIntent.name,
    symbol: boundIntent.symbol,
    decimals: CARTEL_FIXED_ERC20_DECIMALS,
    supplyWhole,
    totalSupplyBaseUnits,
    initCode,
    initCodeHash,
    txValueWei: "0",
    fingerprint: keccak256(stringToHex(preimage)),
    tokenIntent: boundIntent,
  };
}

/* ------------------------------------------------------------------ */
/* Read-only preflight                                                 */
/* ------------------------------------------------------------------ */

/** Strict hex-quantity parser. Any malformed provider response fails closed. */
function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function readFeeWeiPerGas(provider: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): Promise<{ fee: bigint; source: "eth_gasPrice" | "baseFee+priority" } | null> {
  // Preferred: EIP-1559 base fee plus a conservative priority tip.
  try {
    const block = (await provider.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    })) as { baseFeePerGas?: unknown } | null;
    const baseFee = parseHexQuantity(block?.baseFeePerGas);
    if (baseFee !== null) {
      let priority = 0n;
      try {
        priority =
          parseHexQuantity(await provider.request({ method: "eth_maxPriorityFeePerGas" })) ?? 0n;
      } catch {
        priority = 0n;
      }
      return { fee: baseFee * 2n + priority, source: "baseFee+priority" };
    }
  } catch {
    /* fall through to the legacy field */
  }
  try {
    const gasPrice = parseHexQuantity(await provider.request({ method: "eth_gasPrice" }));
    if (gasPrice !== null) return { fee: gasPrice, source: "eth_gasPrice" };
  } catch {
    /* no fee data available */
  }
  return null;
}

/**
 * Runs every read-only production check for an exact intent. Reads only; the
 * result never becomes permission to proceed.
 */
export async function runMainnetPreflight(
  intent: MainnetSimulationIntent,
): Promise<MainnetPreflightResult> {
  const errors: string[] = [];
  const provider = getInjectedProvider();

  const result: MainnetPreflightResult = {
    observedChainId: null,
    chainOk: false,
    observedAccount: null,
    accountOk: false,
    recipientOk: /^0x[0-9a-f]{40}$/.test(intent.recipient) && intent.recipient !== ZERO_ADDRESS,
    callOk: false,
    balanceWei: null,
    gasEstimate: null,
    feeWeiPerGas: null,
    feeSource: null,
    estimatedCostWei: null,
    sufficientBalance: null,
    txValueWei: "0",
    deploymentTxCapabilityEnabled: MAINNET_DEPLOYMENT_TX_ENABLED === true,
    errors,
    quotedAtMs: Date.now(),
    simulationPassed: false,
    deploymentAuthorized: false,
    authorizationBlockedBy: "RUNTIME_EXECUTION_CONTROL_AND_SEND_WINDOW",
  };

  if (!provider) {
    errors.push("No browser wallet detected.");
    return result;
  }

  // Chain — observed only. The operator changes networks themselves.
  try {
    const chainId = parseHexQuantity(await provider.request({ method: "eth_chainId" }));
    result.observedChainId = chainId === null ? null : Number(chainId);
  } catch {
    result.observedChainId = null;
  }
  result.chainOk = result.observedChainId === ROBINHOOD_MAINNET_CHAIN_ID;
  if (!result.chainOk) {
    errors.push(
      `Wallet is on chain ${result.observedChainId ?? "unknown"}. Manually switch your wallet to Robinhood Chain Mainnet ${ROBINHOOD_MAINNET_CHAIN_ID} and run the review again.`,
    );
  }

  // Account — inspected from the already-connected provider only.
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
    const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
    result.observedAccount = first ? first.toLowerCase() : null;
  } catch {
    result.observedAccount = null;
  }
  result.accountOk = result.observedAccount === intent.deployer;
  if (!result.accountOk) {
    errors.push("The connected wallet account does not match the reviewed deployer.");
  }

  if (!result.recipientOk) errors.push("The initial recipient address is not valid.");

  // Balance
  if (result.observedAccount) {
    try {
      const balance = parseHexQuantity(
        await provider.request({
          method: "eth_getBalance",
          params: [result.observedAccount, "latest"],
        }),
      );
      result.balanceWei = balance === null ? null : balance.toString();
      if (balance === null) errors.push("The wallet returned a malformed balance.");
    } catch {
      errors.push("Could not read the wallet balance.");
    }
  }

  const tx = { from: intent.deployer, data: intent.initCode, value: "0x0" };

  // Read-only execution of the exact creation payload.
  try {
    await provider.request({ method: "eth_call", params: [tx, "latest"] });
    result.callOk = true;
  } catch {
    result.callOk = false;
    errors.push("Simulating the contract creation failed. The deployment would revert.");
  }

  // Gas estimate for the exact creation payload.
  let gas: bigint | null = null;
  try {
    gas = parseHexQuantity(await provider.request({ method: "eth_estimateGas", params: [tx] }));
    if (gas === null) errors.push("The wallet returned a malformed gas estimate.");
  } catch {
    errors.push("Gas estimation failed for this deployment.");
  }
  result.gasEstimate = gas === null ? null : gas.toString();

  // Fee data — required. Without it, cost coverage cannot be established.
  const fee = await readFeeWeiPerGas(provider);
  if (fee) {
    result.feeWeiPerGas = fee.fee.toString();
    result.feeSource = fee.source;
    if (gas !== null) {
      const cost = gas * fee.fee;
      result.estimatedCostWei = cost.toString();
      if (result.balanceWei !== null) {
        result.sufficientBalance = BigInt(result.balanceWei) >= cost;
        if (!result.sufficientBalance) {
          errors.push("Insufficient ETH for the estimated gas cost on Robinhood Chain.");
        }
      }
    }
  } else {
    errors.push("Could not obtain a current fee estimate. Run the review again.");
  }

  result.simulationPassed =
    result.chainOk === true &&
    result.accountOk === true &&
    result.recipientOk === true &&
    result.callOk === true &&
    result.balanceWei !== null &&
    gas !== null &&
    result.gasEstimate !== null &&
    result.feeWeiPerGas !== null &&
    result.estimatedCostWei !== null &&
    result.sufficientBalance === true;

  return result;
}

/** Builds the intent and runs the read-only preflight. Never persists. */
export async function runMainnetSimulation(
  input: TokenIntentInput & { deployer: string },
): Promise<MainnetSimulation> {
  const intent = buildMainnetSimulationIntent(input);
  const preflight = await runMainnetPreflight(intent);
  return { intent, preflight };
}

/* ------------------------------------------------------------------ */
/* Quote freshness                                                     */
/* ------------------------------------------------------------------ */

export function mainnetQuoteAgeMs(preflight: MainnetPreflightResult, now = Date.now()): number {
  return now - preflight.quotedAtMs;
}

export function isMainnetQuoteFresh(
  preflight: MainnetPreflightResult,
  now = Date.now(),
): boolean {
  const age = mainnetQuoteAgeMs(preflight, now);
  return age >= 0 && age < MAINNET_SIMULATION_QUOTE_TTL_MS;
}
