import { keccak256, stringToHex } from "viem";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import { NETWORK_ENVIRONMENT, ROBINHOOD_TESTNET_CHAIN_ID } from "./chain-registry";
import {
  ZERO_ADDRESS,
  buildTokenInitCode,
  getInjectedProvider,
  normalizeTokenIntent,
  type TokenIntent,
  type TokenIntentInput,
} from "./chain-launcher";

/**
 * C8.4 — Launch Simulation / Pre-Sign Preflight (TESTNET ONLY).
 *
 * Deterministic, zero-persistence review layer that must run before a
 * fixed-supply ERC-20 test deployment can be signed.
 *
 * Invariants enforced by construction in this module:
 *   - nothing here writes to the database, and no RPC/mutation is imported;
 *   - nothing here signs or broadcasts a transaction; every provider call is
 *     a read (`eth_chainId`, `eth_accounts`, `eth_getBalance`, `eth_call`,
 *     `eth_estimateGas`, `eth_gasPrice`, `eth_getBlockByNumber`);
 *   - the init code is derived only from the frozen creation bytecode plus
 *     ABI-encoded constructor arguments — there is no bytecode input surface;
 *   - every supply, balance, gas and fee value is handled as `bigint` or an
 *     exact decimal string. No base-unit value ever passes through `Number`;
 *   - all provider output is untrusted and strictly parsed before use, and
 *     no provider-supplied value can influence the intent fingerprint.
 */

/** Domain separator for the canonical fingerprint pre-image. */
export const SIMULATION_FINGERPRINT_DOMAIN = "cartel-sim-v1" as const;

/** Field separator (ASCII unit separator) — cannot appear in a normalized field. */
const FIELD_SEPARATOR = "\u001f";

/** Dynamic quote lifetime. The immutable intent fingerprint never expires. */
export const SIMULATION_QUOTE_TTL_MS = 90_000;

export type SimulationIntent = {
  environment: typeof NETWORK_ENVIRONMENT;
  chainId: typeof ROBINHOOD_TESTNET_CHAIN_ID;
  artifactId: typeof CARTEL_FIXED_ERC20_ARTIFACT_ID;
  runtimeBytecodeHash: string;
  /** Lowercase 0x address of the connected signer. */
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
  fingerprint: string;
  /** Retained for the pre-sign gate; the transaction reuses this object. */
  tokenIntent: TokenIntent;
};

export type PreflightCheckKey = "chain" | "account" | "recipient" | "call" | "estimate" | "balance";

export type PreflightResult = {
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
  errors: string[];
  quotedAtMs: number;
  /** True only when every hard check passed. */
  passed: boolean;
};

export type Simulation = {
  intent: SimulationIntent;
  preflight: PreflightResult;
};

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

/* ------------------------------------------------------------------ */
/* Intent + fingerprint (pure, deterministic)                          */
/* ------------------------------------------------------------------ */

function normalizeAddress(value: string, label: string): string {
  const address = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address))
    throw new SimulationError(`${label} is not a valid address.`);
  if (address === ZERO_ADDRESS) throw new SimulationError(`${label} cannot be the zero address.`);
  return address;
}

/**
 * Canonical fingerprint pre-image. Every field is normalized before it is
 * joined, the domain/version is first, and dynamic values (gas, fee, balance,
 * timestamps, nonce) are deliberately excluded so a still-correct intent is
 * never invalidated by chain conditions.
 */
export function fingerprintPreimage(fields: {
  environment: string;
  chainId: number;
  artifactId: string;
  runtimeBytecodeHash: string;
  deployer: string;
  recipient: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyBaseUnits: string;
  initCodeHash: string;
}): string {
  return [
    SIMULATION_FINGERPRINT_DOMAIN,
    fields.environment,
    String(fields.chainId),
    fields.artifactId,
    fields.runtimeBytecodeHash.toLowerCase(),
    fields.deployer.toLowerCase(),
    fields.recipient.toLowerCase(),
    fields.name.normalize("NFC"),
    fields.symbol.normalize("NFC"),
    String(fields.decimals),
    fields.totalSupplyBaseUnits,
    fields.initCodeHash.toLowerCase(),
  ].join(FIELD_SEPARATOR);
}

/**
 * Builds the frozen, deterministic simulation intent. Pure: no provider call,
 * no network access, no persistence.
 */
export function buildSimulationIntent(
  input: TokenIntentInput & { deployer: string },
): SimulationIntent {
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
    throw new SimulationError(error instanceof Error ? error.message : "Check the token details.");
  }

  const recipient = normalizeAddress(tokenIntent.recipient, "Initial recipient");
  const boundIntent: TokenIntent = { ...tokenIntent, recipient };

  const initCode = buildTokenInitCode(boundIntent);
  const initCodeHash = keccak256(initCode);

  const totalSupplyBaseUnits = boundIntent.totalSupply.toString();
  const supplyWhole = boundIntent.supplyWhole.toString();

  const preimage = fingerprintPreimage({
    environment: NETWORK_ENVIRONMENT,
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
    artifactId: CARTEL_FIXED_ERC20_ARTIFACT_ID,
    runtimeBytecodeHash: CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
    deployer,
    recipient,
    name: boundIntent.name,
    symbol: boundIntent.symbol,
    decimals: CARTEL_FIXED_ERC20_DECIMALS,
    totalSupplyBaseUnits,
    initCodeHash,
  });

  return {
    environment: NETWORK_ENVIRONMENT,
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
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
 * Runs every read-only chain check for an exact intent. Never signs, never
 * broadcasts, never writes. Fee data is required for the preflight to pass and
 * is excluded from the fingerprint.
 */
export async function runPreflight(intent: SimulationIntent): Promise<PreflightResult> {
  const errors: string[] = [];
  const provider = getInjectedProvider();

  const result: PreflightResult = {
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
    errors,
    quotedAtMs: Date.now(),
    passed: false,
  };

  if (!provider) {
    errors.push("No browser wallet detected.");
    return result;
  }

  // Chain
  try {
    const chainId = parseHexQuantity(await provider.request({ method: "eth_chainId" }));
    result.observedChainId = chainId === null ? null : Number(chainId);
  } catch {
    result.observedChainId = null;
  }
  result.chainOk = result.observedChainId === ROBINHOOD_TESTNET_CHAIN_ID;
  if (!result.chainOk) {
    errors.push(
      `Wallet is on chain ${result.observedChainId ?? "unknown"}. Switch to Robinhood Chain Testnet ${ROBINHOOD_TESTNET_CHAIN_ID}.`,
    );
  }

  // Account
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
    const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
    result.observedAccount = first ? first.toLowerCase() : null;
  } catch {
    result.observedAccount = null;
  }
  result.accountOk = result.observedAccount === intent.deployer;
  if (!result.accountOk) {
    errors.push("The connected wallet account no longer matches the simulated deployer.");
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

  // eth_call on the exact creation transaction
  try {
    await provider.request({ method: "eth_call", params: [tx, "latest"] });
    result.callOk = true;
  } catch {
    result.callOk = false;
    errors.push("Simulating the contract creation failed. The deployment would revert.");
  }

  // Gas estimate for the exact creation transaction
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
        if (!result.sufficientBalance)
          errors.push("Insufficient testnet ETH for the estimated gas cost.");
      }
    }
  } else {
    errors.push("Could not obtain a current fee estimate. Run the simulation again.");
  }

  result.passed =
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

/** Builds the intent and runs the preflight in one step. Never persists. */
export async function runSimulation(
  input: TokenIntentInput & { deployer: string },
): Promise<Simulation> {
  const intent = buildSimulationIntent(input);
  const preflight = await runPreflight(intent);
  return { intent, preflight };
}

/* ------------------------------------------------------------------ */
/* Freshness + pre-sign gate                                           */
/* ------------------------------------------------------------------ */

export function quoteAgeMs(preflight: PreflightResult, now = Date.now()): number {
  return now - preflight.quotedAtMs;
}

export function isQuoteFresh(preflight: PreflightResult, now = Date.now()): boolean {
  const age = quoteAgeMs(preflight, now);
  return age >= 0 && age < SIMULATION_QUOTE_TTL_MS;
}

export type PreSignGateInput = {
  simulation: Simulation;
  /** Current, unreviewed form values, re-normalized inside the gate. */
  current: TokenIntentInput & { deployer: string };
  liveChainId: number | null;
  liveAccount: string | null;
  now?: number;
};

/**
 * The C8.5 handoff contract. Must pass BEFORE any deployment attempt row is
 * created and before the wallet is asked to sign. Returns a plain reason
 * string on failure; the caller aborts without touching the database.
 */
export function evaluatePreSignGate(
  input: PreSignGateInput,
): { ok: true } | { ok: false; reason: string } {
  const { simulation, current } = input;
  const now = input.now ?? Date.now();

  if (!simulation.preflight.passed) {
    return { ok: false, reason: "Run a simulation and clear every check before deploying." };
  }
  if (!isQuoteFresh(simulation.preflight, now)) {
    return { ok: false, reason: "The simulation estimate expired. Run the simulation again." };
  }

  let rebuilt: SimulationIntent;
  try {
    rebuilt = buildSimulationIntent(current);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SimulationError ? error.message : "Check the token details.",
    };
  }
  if (rebuilt.fingerprint !== simulation.intent.fingerprint) {
    return {
      ok: false,
      reason: "The deployment details changed since the simulation. Run it again.",
    };
  }
  if (rebuilt.initCode !== simulation.intent.initCode) {
    return {
      ok: false,
      reason: "The deployment payload changed since the simulation. Run it again.",
    };
  }
  if (input.liveChainId !== ROBINHOOD_TESTNET_CHAIN_ID) {
    return {
      ok: false,
      reason: `Wallet is not on Robinhood Chain Testnet ${ROBINHOOD_TESTNET_CHAIN_ID}.`,
    };
  }
  if (!input.liveAccount || input.liveAccount.toLowerCase() !== simulation.intent.deployer) {
    return { ok: false, reason: "The wallet account changed since the simulation. Run it again." };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export function truncateHash(value: string, lead = 10, tail = 8): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Exact wei → ETH string. bigint arithmetic only. */
export function formatWeiExact(wei: string | null, fractionDigits = 6): string {
  if (wei === null || !/^[0-9]+$/.test(wei)) return "—";
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, fractionDigits);
  return `${whole.toString()}.${frac}`;
}

export function formatDecimalString(value: string | null): string {
  if (value === null || !/^[0-9]+$/.test(value)) return "—";
  return BigInt(value).toLocaleString("en-US");
}
