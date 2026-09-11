import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Launcher-B3 — PLATFORM-SIDE production request wrappers.
 *
 * SCOPE AND SAFETY
 * ----------------
 * These wrappers hold no authority of their own. Each one:
 *   - re-checks PLATFORM OWNERSHIP server-side through the caller's own
 *     RLS-bound client (client hiding is never the boundary);
 *   - calls exactly ONE authoritative RPC and never reimplements its rules;
 *   - never signs, arms, claims, issues a send window, broadcasts, registers a
 *     contract, advances lifecycle, notifies Telegram or creates liquidity;
 *   - never reaches a service-role client.
 *
 * Status semantics that are DELIBERATELY not implementable here:
 *   - `EXECUTING` is NOT an accepted status target. Execution may only begin
 *     through the atomic `begin_launch_production_request_execution` RPC, which
 *     also creates and binds the DRAFT production deployment attempt.
 *   - `COMPLETED` is an EFFECTIVE status derived by the database from verified
 *     deployment and managed-finality evidence. There is no manual path to it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The ONLY status targets this module may ever request. */
export const PLATFORM_REQUEST_STATUS_TARGETS = ["IN_REVIEW", "APPROVED", "DECLINED"] as const;
export type PlatformRequestStatusTarget = (typeof PLATFORM_REQUEST_STATUS_TARGETS)[number];

export type PlatformRequestNotice =
  | "NOT_AUTHORIZED"
  | "INVALID_INPUT"
  | "REASON_REQUIRED"
  | "NOT_PROJECT_LAUNCH"
  | "RPC_REFUSED";

export type PlatformProductionRequest = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  projectProfileId: string;
  projectName: string | null;
  launchId: string;
  launchName: string | null;
  launchTicker: string | null;
  launchStatus: string | null;
  launchKind: string | null;
  status: string;
  effectiveStatus: string;
  tokenName: string;
  tokenSymbol: string;
  /** Exact integer text. Never parsed through `Number`. */
  tokenSupplyWhole: string;
  /** Exact integer text of base units. Never parsed through `Number`. */
  tokenTotalSupplyBaseUnits: string;
  tokenRecipient: string;
  requestedBy: string | null;
  requestedAt: string | null;
  assignedOperatorId: string | null;
  decisionNote: string | null;
  executionDeploymentId: string | null;
  statusChangedAt: string | null;
};

export type PlatformRequestListResult = {
  ok: boolean;
  notice: PlatformRequestNotice | null;
  requests: PlatformProductionRequest[];
};

export type PlatformRequestMutationResult = {
  ok: boolean;
  notice: PlatformRequestNotice | null;
  /** Sanitized, truncated diagnostic for the owner-only console. Never secrets. */
  detail: string | null;
  request: PlatformProductionRequest | null;
};

type SupabaseLike = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/** Server-authoritative ownership. Fails CLOSED on any error or non-true. */
async function isPlatformOwner(supabase: SupabaseLike, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

function sanitizeDetail(value: unknown): string | null {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function maybe(row: Record<string, unknown>, key: string): string | null {
  const value = text(row, key);
  return value === "" ? null : value;
}

/** Presentation-only shape normaliser. No rule is inferred here. */
export function toPlatformProductionRequest(
  row: Record<string, unknown>,
): PlatformProductionRequest {
  const status = text(row, "status");
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    workspaceName: maybe(row, "workspace_name"),
    projectProfileId: text(row, "project_profile_id"),
    projectName: maybe(row, "project_name"),
    launchId: text(row, "launch_id"),
    launchName: maybe(row, "launch_name"),
    launchTicker: maybe(row, "launch_ticker"),
    launchStatus: maybe(row, "launch_status"),
    launchKind: maybe(row, "launch_kind"),
    status,
    effectiveStatus: maybe(row, "effective_status") ?? status,
    tokenName: text(row, "token_name"),
    tokenSymbol: text(row, "token_symbol"),
    tokenSupplyWhole: text(row, "token_supply_whole"),
    tokenTotalSupplyBaseUnits: text(row, "token_total_supply_base_units"),
    tokenRecipient: text(row, "token_recipient"),
    requestedBy: maybe(row, "requested_by"),
    requestedAt: maybe(row, "requested_at"),
    assignedOperatorId: maybe(row, "assigned_operator_id"),
    decisionNote: maybe(row, "decision_note"),
    executionDeploymentId: maybe(row, "execution_deployment_id"),
    statusChangedAt: maybe(row, "status_changed_at"),
  };
}

function rows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

/* ------------------------------------------------------------------ */
/* 1 — READ-ONLY platform queue                                        */
/* ------------------------------------------------------------------ */

/**
 * PROJECT-only. INTERNAL_TEST launches never reach the production request
 * pipeline; this filter is a second, presentation-level guard on top of the
 * database rules and is never a substitute for them.
 */
export const listPlatformProductionRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformRequestListResult> => {
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ok: false, notice: "NOT_AUTHORIZED", requests: [] };
    }
    const { data, error } = await context.supabase.rpc(
      "list_launch_production_deployment_requests",
    );
    if (error) {
      console.error("[b3] request queue read failed", error.message);
      return { ok: false, notice: "RPC_REFUSED", requests: [] };
    }
    return {
      ok: true,
      notice: null,
      requests: rows(data)
        .map(toPlatformProductionRequest)
        .filter((request) => request.launchKind === "PROJECT"),
    };
  });

/* ------------------------------------------------------------------ */
/* 2 — Review decision (never EXECUTING, never COMPLETED)              */
/* ------------------------------------------------------------------ */

type StatusInput = {
  requestId: string;
  targetStatus: string;
  note?: string | null;
};

export const setPlatformProductionRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StatusInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid request");
    return {
      requestId: typeof input.requestId === "string" ? input.requestId : "",
      targetStatus: typeof input.targetStatus === "string" ? input.targetStatus : "",
      note: typeof input.note === "string" ? input.note.trim() : "",
    };
  })
  .handler(async ({ data, context }): Promise<PlatformRequestMutationResult> => {
    const base: PlatformRequestMutationResult = {
      ok: false,
      notice: null,
      detail: null,
      request: null,
    };
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ...base, notice: "NOT_AUTHORIZED" };
    }
    if (
      !UUID.test(data.requestId) ||
      !(PLATFORM_REQUEST_STATUS_TARGETS as readonly string[]).includes(data.targetStatus)
    ) {
      // EXECUTING and COMPLETED are deliberately unreachable from this wrapper.
      return { ...base, notice: "INVALID_INPUT" };
    }
    if (data.targetStatus === "DECLINED" && data.note.length < 8) {
      return { ...base, notice: "REASON_REQUIRED" };
    }
    if (data.note.length > 1000) {
      return { ...base, notice: "INVALID_INPUT" };
    }

    const { data: raw, error } = await context.supabase.rpc(
      "set_launch_production_deployment_request_status",
      {
        _request_id: data.requestId,
        _target_status: data.targetStatus,
        _note: data.note === "" ? null : data.note,
      },
    );
    if (error) {
      return { ...base, notice: "RPC_REFUSED", detail: sanitizeDetail(error.message) };
    }
    const row = firstRow(raw);
    if (!row) return { ...base, notice: "RPC_REFUSED" };
    return { ok: true, notice: null, detail: null, request: toPlatformProductionRequest(row) };
  });

/* ------------------------------------------------------------------ */
/* 3 — Atomic begin: creates and binds a DRAFT attempt only            */
/* ------------------------------------------------------------------ */

type BeginInput = {
  requestId: string;
  deployerAddress: string;
  reviewFingerprint: string;
  initCodeHash: string;
};

/**
 * The ONLY execution entry point for a customer production request.
 *
 * The token intent (name, symbol, decimals, exact supply, recipient) is NOT
 * accepted here: the database re-derives it from the immutable request row.
 * This call creates and binds a DRAFT deployment attempt and nothing else — no
 * signature, no broadcast, no ARM, no CLAIM and no send window.
 */
export const beginPlatformProductionRequestExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BeginInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid request");
    const str = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      requestId: str(input.requestId),
      deployerAddress: str(input.deployerAddress).trim().toLowerCase(),
      reviewFingerprint: str(input.reviewFingerprint).trim().toLowerCase(),
      initCodeHash: str(input.initCodeHash).trim().toLowerCase(),
    };
  })
  .handler(async ({ data, context }): Promise<PlatformRequestMutationResult> => {
    const base: PlatformRequestMutationResult = {
      ok: false,
      notice: null,
      detail: null,
      request: null,
    };
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ...base, notice: "NOT_AUTHORIZED" };
    }
    if (
      !UUID.test(data.requestId) ||
      !ADDRESS.test(data.deployerAddress) ||
      data.deployerAddress === ZERO_ADDRESS ||
      !HASH32.test(data.reviewFingerprint) ||
      !HASH32.test(data.initCodeHash)
    ) {
      return { ...base, notice: "INVALID_INPUT" };
    }

    const { data: raw, error } = await context.supabase.rpc(
      "begin_launch_production_request_execution",
      {
        _request_id: data.requestId,
        _deployer_address: data.deployerAddress,
        _review_fingerprint: data.reviewFingerprint,
        _init_code_hash: data.initCodeHash,
      },
    );
    if (error) {
      return { ...base, notice: "RPC_REFUSED", detail: sanitizeDetail(error.message) };
    }
    const row = firstRow(raw);
    if (!row) return { ...base, notice: "RPC_REFUSED" };
    return { ok: true, notice: null, detail: null, request: toPlatformProductionRequest(row) };
  });

/* ------------------------------------------------------------------ */
/* Pure presentation helpers (no authority)                            */
/* ------------------------------------------------------------------ */

/** Review actions offered per physical status. Never EXECUTING/COMPLETED. */
export function reviewActionsFor(status: string): PlatformRequestStatusTarget[] {
  if (status === "REQUESTED") return ["IN_REVIEW", "APPROVED", "DECLINED"];
  if (status === "IN_REVIEW") return ["APPROVED", "DECLINED"];
  if (status === "APPROVED") return ["DECLINED"];
  return [];
}

/** Only an APPROVED, unbound request may begin protected execution. */
export function canBeginExecution(request: PlatformProductionRequest | null): boolean {
  if (!request) return false;
  if (request.launchKind !== "PROJECT") return false;
  if (request.effectiveStatus === "COMPLETED") return false;
  return request.status === "APPROVED" && !request.executionDeploymentId;
}

/** A bound EXECUTING request continues through the existing protected stages. */
export function isBoundExecutingRequest(request: PlatformProductionRequest | null): boolean {
  return !!request && request.status === "EXECUTING" && !!request.executionDeploymentId;
}
