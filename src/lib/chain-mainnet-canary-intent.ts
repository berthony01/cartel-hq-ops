/**
 * P3C-F1 — PURE canary intent correctness helpers.
 *
 * No network, no database, no wallet, no environment access. These helpers
 * exist so the canary surface and the owner-only server wrapper agree on the
 * EXACT semantics the authoritative production RPC enforces.
 *
 * Token supply is handled ONLY as an exact decimal string through BigInt.
 * Number / parseInt / parseFloat are never used: an 18-decimal base-unit
 * supply is far outside the safe-integer range and any lossy conversion would
 * silently corrupt an immutable production attempt row.
 */

/** Fixed ERC-20 base-unit scale (1 whole token = 10^18 base units). */
export const CANARY_BASE_UNIT_SCALE = 10n ** 18n;

/** Authoritative RPC bounds for `_token_total_supply`, in BASE UNITS. */
export const CANARY_SUPPLY_BASE_UNITS_MIN = 10n ** 18n;
export const CANARY_SUPPLY_BASE_UNITS_MAX = 10n ** 30n;

/** Onchain symbol rule. Identical to the launcher's `normalizeTokenIntent`. */
export const CANARY_ONCHAIN_SYMBOL_PATTERN = /^[A-Z0-9]{2,11}$/;

/** The ONLY launch chain metadata value eligible for this production canary. */
export const CANARY_REQUIRED_LAUNCH_CHAIN = "Robinhood Chain";

export type BaseUnitSupplyNotice =
  | "NOT_A_DECIMAL_INTEGER"
  | "BELOW_MINIMUM"
  | "ABOVE_MAXIMUM"
  | "NOT_A_WHOLE_TOKEN_MULTIPLE";

export type BaseUnitSupplyCheck =
  | { ok: true; notice: null; exact: string }
  | { ok: false; notice: BaseUnitSupplyNotice; exact: null };

function fail(notice: BaseUnitSupplyNotice): BaseUnitSupplyCheck {
  return { ok: false, notice, exact: null };
}

/**
 * Validate a BASE-UNIT supply exactly, mirroring the production RPC contract:
 * an integer decimal string, >= 10^18, <= 10^30, divisible by 10^18.
 *
 * The returned `exact` value is the ORIGINAL string, never a re-serialized
 * number, so the value crossing PostgREST is byte-identical to the input.
 */
export function checkBaseUnitSupply(value: unknown): BaseUnitSupplyCheck {
  if (typeof value !== "string") return fail("NOT_A_DECIMAL_INTEGER");
  // No sign, no separators, no exponent, no decimal point, no leading zeros.
  if (!/^[1-9][0-9]*$/.test(value)) return fail("NOT_A_DECIMAL_INTEGER");
  if (value.length > 40) return fail("ABOVE_MAXIMUM");

  const amount = BigInt(value);
  if (amount < CANARY_SUPPLY_BASE_UNITS_MIN) return fail("BELOW_MINIMUM");
  if (amount > CANARY_SUPPLY_BASE_UNITS_MAX) return fail("ABOVE_MAXIMUM");
  if (amount % CANARY_BASE_UNIT_SCALE !== 0n) return fail("NOT_A_WHOLE_TOKEN_MULTIPLE");

  return { ok: true, notice: null, exact: value };
}

/**
 * Derive a SAFE default onchain symbol from a stored DISPLAY ticker.
 *
 * The stored launch ticker is never mutated by this. A single leading "$" is
 * removed ONLY when the remainder already satisfies the authoritative onchain
 * symbol rule. Anything else returns "" so the operator must correct it
 * explicitly and downstream validation fails closed.
 */
export function deriveCanaryOnchainSymbol(ticker: string | null | undefined): string {
  const raw = typeof ticker === "string" ? ticker.trim() : "";
  if (CANARY_ONCHAIN_SYMBOL_PATTERN.test(raw)) return raw;
  if (raw.startsWith("$")) {
    const remainder = raw.slice(1);
    if (CANARY_ONCHAIN_SYMBOL_PATTERN.test(remainder)) return remainder;
  }
  return "";
}

/**
 * Launch metadata eligibility. Fails CLOSED: anything that is not clearly
 * Robinhood Chain blocks the production attempt. This NEVER edits the launch.
 */
export function isRobinhoodChainLaunchMetadata(chain: string | null | undefined): boolean {
  return (
    typeof chain === "string" &&
    chain.trim().toLowerCase() === CANARY_REQUIRED_LAUNCH_CHAIN.toLowerCase()
  );
}
