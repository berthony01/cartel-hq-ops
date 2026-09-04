import { keccak256, stringToHex } from "viem";
import {
  LIQUIDITY_TX_ENABLED,
  NETWORK_ENVIRONMENT,
  ROBINHOOD_TESTNET_CHAIN_ID,
} from "./chain-registry";

/**
 * C8.6A — Liquidity Readiness / Plan (TESTNET ONLY, PLAN ONLY).
 *
 * Pure, deterministic, zero-persistence. This module:
 *   - performs NO network access of any kind. Every live value (chain id,
 *     connected account, wallet balance, verified deployment evidence) is
 *     supplied by the caller from existing read-only helpers;
 *   - performs NO database read or write, and imports no Supabase client;
 *   - NEVER signs, approves, wraps, creates a pool or adds liquidity. There is
 *     no transaction surface here at all — no provider is imported;
 *   - handles every amount as `bigint` base units or an exact decimal string.
 *     No amount ever passes through IEEE-754 arithmetic.
 *
 * Execution remains BLOCKED by construction: official Uniswap / wrapped-native
 * deployment addresses for Robinhood Chain Testnet 46630 are not verified, and
 * `LIQUIDITY_TX_ENABLED` is a frozen `false` constant.
 */

/** Domain separator for the canonical fingerprint pre-image. */
export const LIQUIDITY_PLAN_FINGERPRINT_DOMAIN = "cartel-liq-plan-v1" as const;

/** ASCII unit separator — cannot appear in a normalized field. */
const FIELD_SEPARATOR = "\u001f";

/** Plan lifetime, matching the C8.4 preflight quote TTL. */
export const LIQUIDITY_PLAN_TTL_MS = 90_000;

/**
 * The pairing asset is described, never resolved. No wrapped-native address is
 * claimed, because no canonical WETH9 deployment is verified on 46630.
 */
export const LIQUIDITY_QUOTE_ASSET = "NATIVE_ETH" as const;
export const LIQUIDITY_QUOTE_ASSET_LABEL =
  "ETH (would require verified wrapped-native infrastructure at execution)" as const;

/** Why execution is blocked. Frozen for this phase. */
export const LIQUIDITY_INFRASTRUCTURE_STATE =
  "UNVERIFIED_TESTNET_LIQUIDITY_INFRASTRUCTURE" as const;

export const LIQUIDITY_INFRASTRUCTURE_BLOCKER =
  "Official wrapped-native, factory, router, position-manager and liquidity-launcher addresses for Robinhood Chain Testnet " +
  `${ROBINHOOD_TESTNET_CHAIN_ID} are not verified. Published Robinhood deployments target chain 4663, which is not this network and is not usable here.`;

/** Conservative planning bounds. */
export const SLIPPAGE_BPS_MIN = 10;
export const SLIPPAGE_BPS_MAX = 500;
export const DEADLINE_MINUTES_MIN = 1;
export const DEADLINE_MINUTES_MAX = 60;

/** Upper bound on the integer part of any typed amount. */
const MAX_INTEGER_DIGITS = 21;

export const LIQUIDITY_NATIVE_DECIMALS = 18;

export class LiquidityPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiquidityPlanError";
  }
}

/* ------------------------------------------------------------------ */
/* Exact decimal parsing (no floating point anywhere)                  */
/* ------------------------------------------------------------------ */

/**
 * Parses an exact decimal string into base units. Rejects empty values,
 * signs, exponent notation, thousands separators, hex, whitespace inside the
 * number, more fraction digits than the asset supports, absurd magnitudes and
 * zero. Returns a positive `bigint`.
 */
export function parseExactAmount(raw: string, decimals: number, label: string): bigint {
  if (typeof raw !== "string") throw new LiquidityPlanError(`${label} is required.`);
  const value = raw.trim();
  if (value.length === 0) throw new LiquidityPlanError(`${label} is required.`);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    throw new LiquidityPlanError(
      `${label} must be a plain decimal number. Exponent notation, separators and negative values are not accepted.`,
    );
  }

  const dot = value.indexOf(".");
  const wholePart = dot === -1 ? value : value.slice(0, dot);
  const fracPart = dot === -1 ? "" : value.slice(dot + 1);

  if (wholePart.length > MAX_INTEGER_DIGITS) {
    throw new LiquidityPlanError(`${label} is larger than this planner accepts.`);
  }
  if (fracPart.length > decimals) {
    throw new LiquidityPlanError(`${label} has more than ${decimals} decimal places.`);
  }

  const base = BigInt(wholePart + fracPart.padEnd(decimals, "0"));
  if (base <= 0n) throw new LiquidityPlanError(`${label} must be greater than zero.`);
  return base;
}

/** Exact base units → decimal string. bigint arithmetic only. */
export function formatBaseUnits(base: bigint, decimals: number, maxFractionDigits = 8): string {
  const scale = 10n ** BigInt(decimals);
  const whole = base / scale;
  const frac = (base % scale).toString().padStart(decimals, "0").slice(0, maxFractionDigits);
  const trimmed = frac.replace(/0+$/, "");
  return trimmed.length > 0
    ? `${whole.toLocaleString("en-US")}.${trimmed}`
    : whole.toLocaleString("en-US");
}

/**
 * Exact integer ratio rendered with 18 fraction digits: numerator / denominator
 * scaled by 1e18 and truncated. Purely informational.
 */
export function exactRatio18(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null;
  const scaled = (numerator * 10n ** 18n) / denominator;
  const whole = scaled / 10n ** 18n;
  const frac = (scaled % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Verified evidence for the CONFIRMED test-token deployment being planned against. */
export type LiquiditySourceDeployment = {
  deploymentId: string;
  status: string;
  deploymentKind: string;
  artifactId: string | null;
  chainId: number;
  contractAddress: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  /** Exact base-unit text mirror of the balance held by the operator. */
  availableTokenBaseUnits: string | null;
};

export type LiquidityPlanInput = {
  source: LiquiditySourceDeployment;
  /** Wallet the operator intends to provide liquidity from. */
  operator: string;
  /** Live, read-only values supplied by the route. */
  liveAccount: string | null;
  liveChainId: number | null;
  walletBalanceWei: string | null;
  /** Whole-token decimal string, as typed. */
  tokenAmount: string;
  /** Decimal ETH string, as typed. */
  ethAmount: string;
  slippageBps: number;
  deadlineMinutes: number;
  nowMs?: number;
};

export type LiquidityPlanIntent = {
  environment: typeof NETWORK_ENVIRONMENT;
  chainId: typeof ROBINHOOD_TESTNET_CHAIN_ID;
  infrastructureState: typeof LIQUIDITY_INFRASTRUCTURE_STATE;
  quoteAsset: typeof LIQUIDITY_QUOTE_ASSET;
  artifactId: string;
  sourceDeploymentId: string;
  tokenContract: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  operator: string;
  /** Exact base units, decimal strings. */
  tokenAmountBaseUnits: string;
  ethAmountWei: string;
  slippageBps: number;
  deadlineMinutes: number;
  /** Informational, exact, both directions. */
  impliedEthPerToken: string | null;
  impliedTokensPerEth: string | null;
  fingerprint: string;
};

export type LiquidityCheckStatus = "PASS" | "FAIL" | "BLOCKED";

export type LiquidityCheck = {
  key: string;
  label: string;
  status: LiquidityCheckStatus;
  detail: string;
};

export type LiquidityPlan = {
  intent: LiquidityPlanIntent;
  checks: LiquidityCheck[];
  /** Every non-blocked check passed. */
  planValid: boolean;
  /** ALWAYS false in C8.6A. */
  executionReady: false;
  blockers: string[];
  createdAtMs: number;
  expiresAtMs: number;
};

/* ------------------------------------------------------------------ */
/* Canonical fingerprint                                               */
/* ------------------------------------------------------------------ */

export function liquidityFingerprintPreimage(fields: {
  environment: string;
  chainId: number;
  infrastructureState: string;
  quoteAsset: string;
  artifactId: string;
  sourceDeploymentId: string;
  tokenContract: string;
  tokenSymbol: string;
  tokenDecimals: number;
  operator: string;
  tokenAmountBaseUnits: string;
  ethAmountWei: string;
  slippageBps: number;
  deadlineMinutes: number;
}): string {
  return [
    LIQUIDITY_PLAN_FINGERPRINT_DOMAIN,
    fields.environment,
    String(fields.chainId),
    fields.infrastructureState,
    fields.quoteAsset,
    fields.artifactId,
    fields.sourceDeploymentId.toLowerCase(),
    fields.tokenContract.toLowerCase(),
    fields.tokenSymbol.normalize("NFC"),
    String(fields.tokenDecimals),
    fields.operator.toLowerCase(),
    fields.tokenAmountBaseUnits,
    fields.ethAmountWei,
    String(fields.slippageBps),
    String(fields.deadlineMinutes),
  ].join(FIELD_SEPARATOR);
}

/* ------------------------------------------------------------------ */
/* Plan construction                                                   */
/* ------------------------------------------------------------------ */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddress(value: string | null | undefined, label: string): string {
  const address = (value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new LiquidityPlanError(`${label} is not a valid address.`);
  }
  if (address === ZERO_ADDRESS) throw new LiquidityPlanError(`${label} cannot be the zero address.`);
  return address;
}

function check(
  key: string,
  label: string,
  status: LiquidityCheckStatus,
  detail: string,
): LiquidityCheck {
  return { key, label, status, detail };
}

/**
 * Builds the deterministic plan. Structural problems (unparseable amounts,
 * out-of-range bounds, invalid addresses) throw; live-state problems (wrong
 * chain, wrong account, insufficient balance, non-CONFIRMED source) are
 * reported as failing checks so the operator can see exactly what to fix.
 */
export function buildLiquidityPlan(input: LiquidityPlanInput): LiquidityPlan {
  const now = input.nowMs ?? Date.now();
  const { source } = input;

  const tokenContract = normalizeAddress(source.contractAddress, "Token contract");
  const operator = normalizeAddress(input.operator, "Operator wallet");

  const decimals =
    typeof source.tokenDecimals === "number" && Number.isInteger(source.tokenDecimals)
      ? source.tokenDecimals
      : null;
  if (decimals === null || decimals < 0 || decimals > 36) {
    throw new LiquidityPlanError("The source deployment has no verified token decimals.");
  }

  if (!Number.isInteger(input.slippageBps)) {
    throw new LiquidityPlanError("Slippage must be a whole number of basis points.");
  }
  if (input.slippageBps < SLIPPAGE_BPS_MIN || input.slippageBps > SLIPPAGE_BPS_MAX) {
    throw new LiquidityPlanError(
      `Slippage must be between ${SLIPPAGE_BPS_MIN} and ${SLIPPAGE_BPS_MAX} basis points.`,
    );
  }
  if (!Number.isInteger(input.deadlineMinutes)) {
    throw new LiquidityPlanError("Deadline must be a whole number of minutes.");
  }
  if (
    input.deadlineMinutes < DEADLINE_MINUTES_MIN ||
    input.deadlineMinutes > DEADLINE_MINUTES_MAX
  ) {
    throw new LiquidityPlanError(
      `Deadline must be between ${DEADLINE_MINUTES_MIN} and ${DEADLINE_MINUTES_MAX} minutes.`,
    );
  }

  const tokenBase = parseExactAmount(input.tokenAmount, decimals, "Token amount");
  const ethWei = parseExactAmount(input.ethAmount, LIQUIDITY_NATIVE_DECIMALS, "ETH amount");

  const artifactId = source.artifactId ?? "unknown";
  const tokenSymbol = (source.tokenSymbol ?? "").trim();
  const tokenName = (source.tokenName ?? "").trim();

  const preimage = liquidityFingerprintPreimage({
    environment: NETWORK_ENVIRONMENT,
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
    infrastructureState: LIQUIDITY_INFRASTRUCTURE_STATE,
    quoteAsset: LIQUIDITY_QUOTE_ASSET,
    artifactId,
    sourceDeploymentId: source.deploymentId,
    tokenContract,
    tokenSymbol,
    tokenDecimals: decimals,
    operator,
    tokenAmountBaseUnits: tokenBase.toString(),
    ethAmountWei: ethWei.toString(),
    slippageBps: input.slippageBps,
    deadlineMinutes: input.deadlineMinutes,
  });

  const intent: LiquidityPlanIntent = {
    environment: NETWORK_ENVIRONMENT,
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
    infrastructureState: LIQUIDITY_INFRASTRUCTURE_STATE,
    quoteAsset: LIQUIDITY_QUOTE_ASSET,
    artifactId,
    sourceDeploymentId: source.deploymentId,
    tokenContract,
    tokenName,
    tokenSymbol,
    tokenDecimals: decimals,
    operator,
    tokenAmountBaseUnits: tokenBase.toString(),
    ethAmountWei: ethWei.toString(),
    slippageBps: input.slippageBps,
    deadlineMinutes: input.deadlineMinutes,
    impliedEthPerToken: exactRatio18(ethWei * 10n ** BigInt(decimals), tokenBase * 10n ** 18n),
    impliedTokensPerEth: exactRatio18(tokenBase * 10n ** 18n, ethWei * 10n ** BigInt(decimals)),
    fingerprint: keccak256(stringToHex(preimage)),
  };

  const available =
    typeof source.availableTokenBaseUnits === "string" &&
    /^[0-9]+$/.test(source.availableTokenBaseUnits)
      ? BigInt(source.availableTokenBaseUnits)
      : null;
  const balanceWei =
    typeof input.walletBalanceWei === "string" && /^[0-9]+$/.test(input.walletBalanceWei)
      ? BigInt(input.walletBalanceWei)
      : null;

  const checks: LiquidityCheck[] = [
    check(
      "chain",
      `Chain is Robinhood Chain Testnet ${ROBINHOOD_TESTNET_CHAIN_ID}`,
      input.liveChainId === ROBINHOOD_TESTNET_CHAIN_ID ? "PASS" : "FAIL",
      input.liveChainId === ROBINHOOD_TESTNET_CHAIN_ID
        ? `${NETWORK_ENVIRONMENT} ${ROBINHOOD_TESTNET_CHAIN_ID}`
        : `Wallet reports chain ${input.liveChainId ?? "unknown"}.`,
    ),
    check(
      "account",
      "Connected account matches the intended operator",
      input.liveAccount !== null && input.liveAccount.toLowerCase() === operator ? "PASS" : "FAIL",
      input.liveAccount ? input.liveAccount.toLowerCase() : "No wallet account connected.",
    ),
    check(
      "sourceStatus",
      "Source deployment is CONFIRMED",
      source.status === "CONFIRMED" ? "PASS" : "FAIL",
      `Status ${source.status}.`,
    ),
    check(
      "sourceKind",
      "Source deployment kind is FIXED_SUPPLY_ERC20",
      source.deploymentKind === "FIXED_SUPPLY_ERC20" ? "PASS" : "FAIL",
      `Kind ${source.deploymentKind}, artifact ${artifactId}.`,
    ),
    check(
      "sourceChain",
      "Source deployment is on the same testnet",
      Number(source.chainId) === ROBINHOOD_TESTNET_CHAIN_ID ? "PASS" : "FAIL",
      `Recorded chain ${source.chainId}.`,
    ),
    check("contract", "Token contract address is valid and non-zero", "PASS", tokenContract),
    check(
      "tokenAmount",
      "Token amount parses and is available",
      available !== null && tokenBase <= available ? "PASS" : "FAIL",
      available === null
        ? "No verified token balance evidence for this deployment."
        : `${tokenBase.toString()} of ${available.toString()} base units.`,
    ),
    check(
      "ethAmount",
      "ETH amount parses and the wallet balance covers it",
      balanceWei !== null && ethWei <= balanceWei ? "PASS" : "FAIL",
      balanceWei === null
        ? "Wallet balance unavailable."
        : `${ethWei.toString()} of ${balanceWei.toString()} wei (before gas).`,
    ),
    check(
      "slippage",
      "Slippage bound is within planning limits",
      "PASS",
      `${input.slippageBps} bps (allowed ${SLIPPAGE_BPS_MIN}–${SLIPPAGE_BPS_MAX}).`,
    ),
    check(
      "deadline",
      "Deadline bound is within planning limits",
      "PASS",
      `${input.deadlineMinutes} min (allowed ${DEADLINE_MINUTES_MIN}–${DEADLINE_MINUTES_MAX}).`,
    ),
    check("fingerprint", "Deterministic plan fingerprint generated", "PASS", intent.fingerprint),
    check(
      "infrastructure",
      "Execution infrastructure verified",
      "BLOCKED",
      LIQUIDITY_INFRASTRUCTURE_BLOCKER,
    ),
  ];

  const planValid = checks.every((c) => c.status !== "FAIL");
  const blockers = [LIQUIDITY_INFRASTRUCTURE_BLOCKER];

  return {
    intent,
    checks,
    planValid,
    // Frozen false. `LIQUIDITY_TX_ENABLED` is a literal `false` constant and
    // there is no branch anywhere that can promote this field.
    executionReady: false as const,
    blockers: LIQUIDITY_TX_ENABLED ? blockers : blockers,
    createdAtMs: now,
    expiresAtMs: now + LIQUIDITY_PLAN_TTL_MS,
  };
}

/* ------------------------------------------------------------------ */
/* Freshness                                                           */
/* ------------------------------------------------------------------ */

export function liquidityPlanAgeMs(plan: LiquidityPlan, now = Date.now()): number {
  return now - plan.createdAtMs;
}

export function isLiquidityPlanFresh(plan: LiquidityPlan, now = Date.now()): boolean {
  const age = liquidityPlanAgeMs(plan, now);
  return age >= 0 && age < LIQUIDITY_PLAN_TTL_MS;
}

/**
 * Fail-closed re-evaluation. A plan is usable for review only while it is
 * fresh, still valid, and still bound to the same account, chain, source
 * deployment and inputs. Anything else invalidates it.
 */
export function isLiquidityPlanCurrent(
  plan: LiquidityPlan,
  live: {
    liveAccount: string | null;
    liveChainId: number | null;
    sourceDeploymentId: string | null;
    currentFingerprint: string | null;
    now?: number;
  },
): boolean {
  const now = live.now ?? Date.now();
  if (!isLiquidityPlanFresh(plan, now)) return false;
  if (!plan.planValid) return false;
  if (live.liveChainId !== ROBINHOOD_TESTNET_CHAIN_ID) return false;
  if (!live.liveAccount || live.liveAccount.toLowerCase() !== plan.intent.operator) return false;
  if (live.sourceDeploymentId !== plan.intent.sourceDeploymentId) return false;
  if (live.currentFingerprint !== plan.intent.fingerprint) return false;
  return true;
}
