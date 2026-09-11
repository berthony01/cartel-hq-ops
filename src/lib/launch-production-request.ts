import { supabase } from "@/integrations/supabase/client";

/**
 * Launcher-B2 — typed client wrappers over the ALREADY EXISTING B1 RPCs.
 *
 * This module holds NO authority. Every eligibility rule, ownership rule,
 * lifecycle rule, supply bound and recipient rule is re-derived and enforced
 * by the database. The helpers below exist only so the browser can:
 *   - read the latest request for one launch,
 *   - submit or withdraw a request through the owner-only RPCs,
 *   - render honest guidance without guessing.
 *
 * NOTHING here deploys, signs, broadcasts, arms, claims, issues a send window,
 * registers a contract, transitions lifecycle, notifies Telegram or touches
 * liquidity. A request is a record of intent only.
 */

export const PRODUCTION_REQUEST_CHAIN_ID = 4663;
export const PRODUCTION_REQUEST_DECIMALS = 18;
export const PRODUCTION_REQUEST_MIN_SUPPLY_WHOLE = 1n;
export const PRODUCTION_REQUEST_MAX_SUPPLY_WHOLE = 1_000_000_000_000n;
const BASE_UNIT_MULTIPLIER = 10n ** BigInt(PRODUCTION_REQUEST_DECIMALS);

/** Physical row status. `COMPLETED` is never a physical status. */
export const PRODUCTION_REQUEST_STATUSES = [
  "REQUESTED",
  "IN_REVIEW",
  "APPROVED",
  "EXECUTING",
  "DECLINED",
  "WITHDRAWN",
] as const;

export type ProductionRequestStatus = (typeof PRODUCTION_REQUEST_STATUSES)[number];

/**
 * Effective status as returned by the database. `COMPLETED` is derived from
 * managed-finalized contract evidence server-side and can never be set by hand.
 */
export type ProductionRequestEffectiveStatus = ProductionRequestStatus | "COMPLETED";

/** Physical statuses that still occupy the one-open-request-per-launch slot. */
export const PRODUCTION_REQUEST_OPEN_STATUSES: readonly ProductionRequestStatus[] = [
  "REQUESTED",
  "IN_REVIEW",
  "APPROVED",
  "EXECUTING",
];

/** Physical statuses the owner may withdraw, per the B1 withdraw RPC. */
export const PRODUCTION_REQUEST_WITHDRAWABLE_STATUSES: readonly ProductionRequestStatus[] = [
  "REQUESTED",
  "IN_REVIEW",
  "APPROVED",
];

/** Launch lifecycle states the B1 submit RPC accepts. */
export const PRODUCTION_REQUEST_ELIGIBLE_LAUNCH_STATUSES: readonly string[] = [
  "WATCHLIST_OPEN",
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
];

export type ProductionDeploymentRequest = {
  id: string;
  workspaceId: string;
  projectProfileId: string;
  launchId: string;
  status: ProductionRequestStatus;
  effectiveStatus: ProductionRequestEffectiveStatus;
  chainId: number;
  networkEnvironment: string;
  declaredChain: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  /** Exact integer text. Never parsed through `Number`. */
  tokenSupplyWhole: string;
  /** Exact integer text of base units. Never parsed through `Number`. */
  tokenTotalSupplyBaseUnits: string;
  tokenRecipient: string;
  requestedBy: string;
  requestedAt: string;
  assignedOperatorId: string | null;
  decisionNote: string | null;
  executionDeploymentId: string | null;
  statusChangedAt: string;
  updatedAt: string;
};

function rethrow(error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "Unexpected error.";
  throw new Error(message);
}

function toStatus(raw: unknown): ProductionRequestStatus {
  const value = String(raw ?? "");
  return (PRODUCTION_REQUEST_STATUSES as readonly string[]).includes(value)
    ? (value as ProductionRequestStatus)
    : "REQUESTED";
}

function toEffectiveStatus(raw: unknown, fallback: ProductionRequestStatus) {
  const value = String(raw ?? "");
  if (value === "COMPLETED") return "COMPLETED" as const;
  return (PRODUCTION_REQUEST_STATUSES as readonly string[]).includes(value)
    ? (value as ProductionRequestStatus)
    : fallback;
}

/** Presentation-only shape normaliser. No rule is inferred here. */
export function toProductionDeploymentRequest(row: Record<string, unknown>): ProductionDeploymentRequest {
  const status = toStatus(row["status"]);
  return {
    id: String(row["id"] ?? ""),
    workspaceId: String(row["workspace_id"] ?? ""),
    projectProfileId: String(row["project_profile_id"] ?? ""),
    launchId: String(row["launch_id"] ?? ""),
    status,
    effectiveStatus: toEffectiveStatus(row["effective_status"], status),
    chainId: Number(row["chain_id"] ?? PRODUCTION_REQUEST_CHAIN_ID),
    networkEnvironment: String(row["network_environment"] ?? "PRODUCTION"),
    declaredChain: String(row["declared_chain"] ?? ""),
    tokenName: String(row["token_name"] ?? ""),
    tokenSymbol: String(row["token_symbol"] ?? ""),
    tokenDecimals: Number(row["token_decimals"] ?? PRODUCTION_REQUEST_DECIMALS),
    tokenSupplyWhole: String(row["token_supply_whole"] ?? ""),
    tokenTotalSupplyBaseUnits: String(row["token_total_supply_base_units"] ?? ""),
    tokenRecipient: String(row["token_recipient"] ?? ""),
    requestedBy: String(row["requested_by"] ?? ""),
    requestedAt: String(row["requested_at"] ?? ""),
    assignedOperatorId: row["assigned_operator_id"] ? String(row["assigned_operator_id"]) : null,
    decisionNote: row["decision_note"] ? String(row["decision_note"]) : null,
    executionDeploymentId: row["execution_deployment_id"]
      ? String(row["execution_deployment_id"])
      : null,
    statusChangedAt: String(row["status_changed_at"] ?? ""),
    updatedAt: String(row["updated_at"] ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Query key + reads/writes
// ---------------------------------------------------------------------------

export function productionDeploymentRequestQueryKey(launchId: string | null | undefined) {
  return ["launch-production-deployment-request", launchId ?? null] as const;
}

/** Latest request for one launch, or `null` when none has ever been made. */
export async function getLaunchProductionDeploymentRequest(
  launchId: string,
): Promise<ProductionDeploymentRequest | null> {
  const { data, error } = await supabase.rpc("get_launch_production_deployment_request", {
    _launch_id: launchId,
  });
  if (error) rethrow(error);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? toProductionDeploymentRequest(row as Record<string, unknown>) : null;
}

/**
 * Owner-only. Records intent ONLY. Token name and on-chain symbol are derived
 * server-side from the launch and are never supplied by the browser.
 */
export async function submitLaunchProductionDeploymentRequest(input: {
  launchId: string;
  tokenSupplyWhole: string;
  tokenRecipient: string;
}): Promise<ProductionDeploymentRequest> {
  const { data, error } = await supabase.rpc("submit_launch_production_deployment_request", {
    _launch_id: input.launchId,
    _token_supply_whole: input.tokenSupplyWhole.trim(),
    _token_recipient: input.tokenRecipient.trim().toLowerCase(),
  });
  if (error) rethrow(error);
  return toProductionDeploymentRequest(data as unknown as Record<string, unknown>);
}

/** Owner-only. Refused by the database once execution is bound. */
export async function withdrawLaunchProductionDeploymentRequest(
  requestId: string,
): Promise<ProductionDeploymentRequest> {
  const { data, error } = await supabase.rpc("withdraw_launch_production_deployment_request", {
    _request_id: requestId,
  });
  if (error) rethrow(error);
  return toProductionDeploymentRequest(data as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Pure helpers (no Number, no float, no rounding)
// ---------------------------------------------------------------------------

export type SupplyParseResult =
  | { ok: true; whole: bigint; baseUnits: bigint }
  | { ok: false; error: string };

/**
 * Exact whole-token supply parsing. Mirrors the server regex
 * `^[1-9][0-9]{0,12}$` and the 1..1,000,000,000,000 bound. BigInt only, so no
 * precision is ever lost. The database remains authoritative.
 */
export function parseWholeSupply(raw: string): SupplyParseResult {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, error: "Enter the total token supply." };
  if (!/^[0-9]+$/.test(text)) {
    return { ok: false, error: "Supply must be whole tokens only — digits, no decimals or commas." };
  }
  if (/^0/.test(text)) {
    return { ok: false, error: "Supply cannot start with a leading zero." };
  }
  const whole = BigInt(text);
  if (whole < PRODUCTION_REQUEST_MIN_SUPPLY_WHOLE) {
    return { ok: false, error: "Supply must be at least 1 whole token." };
  }
  if (whole > PRODUCTION_REQUEST_MAX_SUPPLY_WHOLE) {
    return {
      ok: false,
      error: "Supply cannot exceed 1,000,000,000,000 whole tokens.",
    };
  }
  return { ok: true, whole, baseUnits: whole * BASE_UNIT_MULTIPLIER };
}

/** Exact base-unit conversion for display. BigInt only. */
export function toBaseUnits(whole: bigint): bigint {
  return whole * BASE_UNIT_MULTIPLIER;
}

/** Thousands grouping for an exact integer string. No locale maths involved. */
export function groupDigits(value: string): string {
  const text = (value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return text;
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isValidRecipientAddress(raw: string): boolean {
  const text = (raw ?? "").trim();
  return EVM_ADDRESS_RE.test(text) && text.toLowerCase() !== ZERO_ADDRESS;
}

export function normalizeRecipientAddress(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

export function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * B2.1 — manual re-type confirmation ONLY.
 *
 * Deliberately stricter than `sameAddress`: the second entry must match the
 * first character-for-character, including letter case. Nothing is lowercased,
 * uppercased or checksum-normalised before the comparison, so a mixed-case
 * variant of the same hex address is rejected. Only outer whitespace is
 * ignored, because the submit path trims it anyway.
 *
 * This is a typo guard for hand-typed input; it holds no authority.
 */
export function exactManualRecipientMatch(a: string | null, b: string | null): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (left === "" || right === "") return false;
  return left === right;
}

/**
 * B2.1 — mirrors the server registration rule exactly: an official contract is
 * considered recorded when ANY of the three registration fields is present.
 * Presentation hint only; the database re-derives and remains authoritative.
 */
export function hasRegistrationRecord(fields: {
  officialContractAddress?: string | null;
  officialContractDeploymentId?: string | null;
  contractRegisteredAt?: string | null;
}): boolean {
  return Boolean(
    fields.officialContractAddress ||
      fields.officialContractDeploymentId ||
      fields.contractRegisteredAt,
  );
}

// ---------------------------------------------------------------------------
// Status presentation + client-known eligibility hints
// ---------------------------------------------------------------------------

export type ProductionRequestCopy = {
  tone: "gold" | "green" | "muted" | "danger";
  label: string;
  headline: string;
  detail: string;
};

/**
 * Honest copy per effective status. No time promise, no percentage and no
 * invented progress is ever produced here.
 */
export function productionRequestCopy(
  status: ProductionRequestEffectiveStatus,
): ProductionRequestCopy {
  switch (status) {
    case "REQUESTED":
      return {
        tone: "gold",
        label: "Requested",
        headline: "Request received, waiting for platform review.",
        detail:
          "Your deployment request is on record. Nothing has been deployed and no transaction has been sent.",
      };
    case "IN_REVIEW":
      return {
        tone: "gold",
        label: "In review",
        headline: "Under review, no deployment has started.",
        detail:
          "The platform team is checking this request. Nothing has been deployed and no transaction has been sent.",
      };
    case "APPROVED":
      return {
        tone: "gold",
        label: "Approved",
        headline: "Approved for platform execution, no transaction has been sent yet.",
        detail:
          "Your request is cleared for the protected execution flow. Nothing has been deployed yet.",
      };
    case "EXECUTING":
      return {
        tone: "gold",
        label: "Executing",
        headline: "Production deployment is being handled through the protected execution flow.",
        detail:
          "This stage is handled by the platform. Progress is only reported once verified evidence is on record.",
      };
    case "COMPLETED":
      return {
        tone: "green",
        label: "Completed",
        headline: "Verified production deployment and managed finality are on record.",
        detail:
          "Next step is official contract registration through the existing Contract flow on this page.",
      };
    case "DECLINED":
      return {
        tone: "danger",
        label: "Declined",
        headline: "This request was declined.",
        detail:
          "Nothing was deployed. You can make a new request; every eligibility rule is checked again by the server.",
      };
    case "WITHDRAWN":
      return {
        tone: "muted",
        label: "Withdrawn",
        headline: "This request was withdrawn.",
        detail:
          "Nothing was deployed. You can make a new request; every eligibility rule is checked again by the server.",
      };
    default:
      return {
        tone: "muted",
        label: "Unknown",
        headline: "This request is in an unrecognised state.",
        detail: "Reload this page. The platform record remains authoritative.",
      };
  }
}

/** A request that still occupies the launch's open slot. */
export function isOpenProductionRequest(request: ProductionDeploymentRequest | null): boolean {
  if (!request) return false;
  if (request.effectiveStatus === "COMPLETED") return false;
  return PRODUCTION_REQUEST_OPEN_STATUSES.includes(request.status);
}

/** A closed request that does not block a fresh submission. */
export function isClosedProductionRequest(request: ProductionDeploymentRequest | null): boolean {
  if (!request) return false;
  if (request.effectiveStatus === "COMPLETED") return false;
  return request.status === "DECLINED" || request.status === "WITHDRAWN";
}

export function isCompletedProductionRequest(
  request: ProductionDeploymentRequest | null,
): boolean {
  return request?.effectiveStatus === "COMPLETED";
}

/** Withdraw is offered only for the physical statuses the RPC accepts. */
export function canWithdrawProductionRequest(
  request: ProductionDeploymentRequest | null,
): boolean {
  if (!request) return false;
  if (request.effectiveStatus === "COMPLETED") return false;
  if (request.executionDeploymentId) return false;
  return PRODUCTION_REQUEST_WITHDRAWABLE_STATUSES.includes(request.status);
}

/**
 * Client-known eligibility HINTS only. These mirror the rules the browser can
 * already see; the database re-derives all of them and may still refuse.
 */
export type ProductionRequestEligibilityHints = {
  isProjectLaunch: boolean;
  profilePublished: boolean;
  scheduleSet: boolean;
  launchStatus: string;
  registrationRecorded: boolean;
  /** Any existing production deployment row for this launch, in any state. */
  hasProductionDeploymentEvidence: boolean;
};

export type ProductionRequestEligibility = {
  eligible: boolean;
  /** First blocking reason in plain English, or `null` when eligible. */
  reason: string | null;
};

export function evaluateProductionRequestEligibility(
  hints: ProductionRequestEligibilityHints,
): ProductionRequestEligibility {
  if (!hints.isProjectLaunch) {
    return {
      eligible: false,
      reason: "Production deployment requests are only available for project launches.",
    };
  }
  if (!hints.profilePublished) {
    return { eligible: false, reason: "Publish your Project Profile first." };
  }
  if (!hints.scheduleSet) {
    return { eligible: false, reason: "Set the launch time or launch window first." };
  }
  if (!PRODUCTION_REQUEST_ELIGIBLE_LAUNCH_STATUSES.includes(hints.launchStatus)) {
    return {
      eligible: false,
      reason:
        "A production deployment can be requested once the launch is at Watchlist open, Launch approaching or Contract pending.",
    };
  }
  if (hints.registrationRecorded) {
    return {
      eligible: false,
      reason: "An official contract is already recorded for this launch.",
    };
  }
  if (hints.hasProductionDeploymentEvidence) {
    return {
      eligible: false,
      reason: "A production deployment already exists or is in progress for this launch.",
    };
  }
  return { eligible: true, reason: null };
}
