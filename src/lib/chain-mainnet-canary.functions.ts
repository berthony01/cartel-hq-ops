import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import {
  checkBaseUnitSupply,
  isRobinhoodChainLaunchMetadata,
} from "./chain-mainnet-canary-intent";


/**
 * P3C-F — OWNER-ONLY canary orchestration wrappers.
 *
 * SCOPE AND SAFETY
 * ----------------
 * These are the ONLY missing call sites around the already-hardened production
 * pipeline. They add no new authority of their own:
 *
 *   - every wrapper independently re-checks PLATFORM OWNERSHIP server-side via
 *     `is_platform_owner`, through the caller's own RLS-bound client. Client
 *     hiding is never the boundary;
 *   - each wrapper calls exactly ONE authoritative RPC and never duplicates or
 *     reimplements its logic, bindings, TTLs or state machine;
 *   - there is NO generic "enable production" path here: nothing clears the
 *     emergency stop, nothing sets `execution_enabled`, nothing re-arms, resets
 *     or retries, and nothing operates on more than one exact deployment;
 *   - the emergency stop wrapper is ONE-WAY. It can only engage;
 *   - no signing, no broadcast, no envelope, no liquidity, no registration and
 *     no service-role client is reachable from this module.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]+$/;
const SYMBOL = /^[A-Z0-9]{2,11}$/;

export type CanaryNotice =
  | "NOT_AUTHORIZED"
  | "INVALID_INPUT"
  | "RECIPIENT_MUST_MATCH_DEPLOYER"
  | "SUPPLY_OUT_OF_RANGE"
  | "LAUNCH_CHAIN_MISMATCH"
  | "RPC_REFUSED"
  | "CONTROL_STATE_UNAVAILABLE";

export type CanaryExecutionStateResult = {
  ok: boolean;
  notice: CanaryNotice | null;
  controlKey: string | null;
  executionEnabled: boolean | null;
  emergencyStopEngaged: boolean | null;
  revision: number | null;
  reason: string | null;
  updatedAt: string | null;
};

export type CanaryAttemptResult = {
  ok: boolean;
  notice: CanaryNotice | null;
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  deploymentId: string | null;
  status: string | null;
  attemptNumber: number | null;
  clientRequestId: string | null;
};

export type CanaryArmResult = {
  ok: boolean;
  notice: CanaryNotice | null;
  deploymentId: string;
  authorizationId: string;
  /** Authoritative RPC payload, serialized as-is for owner display only. */
  payload: string | null;
};

export type CanaryStopResult = {
  ok: boolean;
  notice: CanaryNotice | null;
  executionEnabled: boolean | null;
  emergencyStopEngaged: boolean | null;
  revision: number | null;
  reason: string | null;
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

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function str(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(row: Record<string, unknown>, key: string): boolean | null {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

function controlState(row: Record<string, unknown>): CanaryExecutionStateResult {
  return {
    ok: true,
    notice: null,
    controlKey: str(row, "control_key"),
    executionEnabled: bool(row, "execution_enabled"),
    emergencyStopEngaged: bool(row, "emergency_stop_engaged"),
    revision: num(row, "revision"),
    reason: str(row, "reason"),
    updatedAt: str(row, "updated_at"),
  };
}

const STATE_BASE: CanaryExecutionStateResult = {
  ok: false,
  notice: null,
  controlKey: null,
  executionEnabled: null,
  emergencyStopEngaged: null,
  revision: null,
  reason: null,
  updatedAt: null,
};

/* ------------------------------------------------------------------ */
/* 1 — READ-ONLY runtime execution control                             */
/* ------------------------------------------------------------------ */

export const readCanaryExecutionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CanaryExecutionStateResult> => {
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ...STATE_BASE, notice: "NOT_AUTHORIZED" };
    }
    const { data, error } = await context.supabase.rpc(
      "get_launch_chain_production_execution_state",
    );
    const row = error ? null : firstRow(data);
    if (!row) return { ...STATE_BASE, notice: "CONTROL_STATE_UNAVAILABLE" };
    return controlState(row);
  });

/* ------------------------------------------------------------------ */
/* 2 — Production deployment attempt (exact immutable binding)         */
/* ------------------------------------------------------------------ */

type AttemptInput = {
  launchId: string;
  deployerAddress: string;
  tokenRecipient: string;
  tokenName: string;
  tokenSymbol: string;
  /**
   * Exact supply in BASE UNITS (10^18 per whole token), as a decimal string.
   * This is NOT a whole-token count and is never converted through Number.
   */
  tokenTotalSupplyBaseUnits: string;
  initCodeHash: string;
  reviewFingerprint: string;
  clientRequestId: string;
};

function attemptFail(notice: CanaryNotice): CanaryAttemptResult {
  return {
    ok: false,
    notice,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    deploymentId: null,
    status: null,
    attemptNumber: null,
    clientRequestId: null,
  };
}

export const createCanaryDeploymentAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AttemptInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid request");
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      launchId: text(input.launchId),
      deployerAddress: text(input.deployerAddress).toLowerCase(),
      tokenRecipient: text(input.tokenRecipient).toLowerCase(),
      tokenName: text(input.tokenName),
      tokenSymbol: text(input.tokenSymbol),
      // Kept BYTE-IDENTICAL. No trim, no normalization, no numeric coercion.
      tokenTotalSupplyBaseUnits: text(input.tokenTotalSupplyBaseUnits),
      initCodeHash: text(input.initCodeHash).toLowerCase(),
      reviewFingerprint: text(input.reviewFingerprint).toLowerCase(),
      clientRequestId: text(input.clientRequestId),
    };
  })
  .handler(async ({ data, context }): Promise<CanaryAttemptResult> => {
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return attemptFail("NOT_AUTHORIZED");
    }

    if (
      !UUID.test(data.launchId) ||
      !ADDRESS.test(data.deployerAddress) ||
      !ADDRESS.test(data.tokenRecipient) ||
      !HASH32.test(data.initCodeHash) ||
      !HASH32.test(data.reviewFingerprint) ||
      data.tokenName.length < 1 ||
      data.tokenName.length > 120 ||
      !SYMBOL.test(data.tokenSymbol) ||
      data.clientRequestId.length < 8 ||
      data.clientRequestId.length > 128 ||
      !REQUEST_ID.test(data.clientRequestId)
    ) {
      return attemptFail("INVALID_INPUT");
    }

    // CANARY HARNESS SAFETY. For this owner-only production canary the entire
    // supply must be minted to the deployer itself. Both values are already
    // lowercase-normalized above. Rejected BEFORE the production attempt RPC.
    if (data.tokenRecipient !== data.deployerAddress) {
      return attemptFail("RECIPIENT_MUST_MATCH_DEPLOYER");
    }


    // Supply is validated EXACTLY, in base units, with BigInt only. The RPC
    // requires an integer >= 10^18, <= 10^30 and divisible by 10^18; a lossy
    // supply must never reach an immutable production attempt row.
    const supply = checkBaseUnitSupply(data.tokenTotalSupplyBaseUnits);
    if (!supply.ok) {
      return attemptFail(
        supply.notice === "NOT_A_DECIMAL_INTEGER" ? "INVALID_INPUT" : "SUPPLY_OUT_OF_RANGE",
      );
    }

    // Fail CLOSED on launch metadata: only a launch that clearly records
    // Robinhood Chain may produce a production attempt. This never writes.
    const { data: launch, error: launchError } = await context.supabase
      .from("launches")
      .select("id, chain")
      .eq("id", data.launchId)
      .maybeSingle();
    if (launchError || !launch || !isRobinhoodChainLaunchMetadata(launch.chain)) {
      return attemptFail("LAUNCH_CHAIN_MISMATCH");
    }

    const { data: raw, error } = await context.supabase.rpc(
      "create_launch_chain_production_token_deployment_attempt",
      {
        _client_request_id: data.clientRequestId,
        _deployer_address: data.deployerAddress,
        _init_code_hash: data.initCodeHash,
        _launch_id: data.launchId,
        _review_fingerprint: data.reviewFingerprint,
        _token_name: data.tokenName,
        _token_recipient: data.tokenRecipient,
        _token_symbol: data.tokenSymbol,
        // EXACT decimal string on the wire. The cast satisfies the generated
        // numeric typing only; the runtime value is the untouched string.
        _token_total_supply: supply.exact as unknown as number,
      },
    );


    const row = error ? null : firstRow(raw);
    if (!row) return attemptFail("RPC_REFUSED");

    return {
      ok: true,
      notice: null,
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      deploymentId: str(row, "id"),
      status: str(row, "status"),
      attemptNumber: num(row, "attempt_number"),
      clientRequestId: str(row, "client_request_id"),
    };
  });

/* ------------------------------------------------------------------ */
/* 3 — ARM exactly one claimed authorization                           */
/* ------------------------------------------------------------------ */

type ArmInput = {
  deploymentId: string;
  authorizationId: string;
  expectedControlRevision: number;
  reason: string;
};

export const armCanaryExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ArmInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid request");
    if (typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    if (typeof input.authorizationId !== "string" || !UUID.test(input.authorizationId)) {
      throw new Error("Invalid authorization id");
    }
    if (
      typeof input.expectedControlRevision !== "number" ||
      !Number.isSafeInteger(input.expectedControlRevision) ||
      input.expectedControlRevision < 0
    ) {
      throw new Error("Invalid expected control revision");
    }
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 8 || reason.length > 400) throw new Error("Invalid reason");
    return {
      deploymentId: input.deploymentId,
      authorizationId: input.authorizationId,
      expectedControlRevision: input.expectedControlRevision,
      reason,
    };
  })
  .handler(async ({ data, context }): Promise<CanaryArmResult> => {
    const base = {
      deploymentId: data.deploymentId,
      authorizationId: data.authorizationId,
      payload: null as string | null,
    };
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ...base, ok: false, notice: "NOT_AUTHORIZED" };
    }

    // The ONLY RPC this wrapper may ever call. Bound to the exact deployment,
    // the exact authorization, the acting operator and the EXPECTED current
    // control revision. There is no re-arm, reset or enable variant.
    const { data: payload, error } = await context.supabase.rpc(
      "arm_launch_chain_production_canary_execution",
      {
        _authorization_id: data.authorizationId,
        _deployment_id: data.deploymentId,
        _expected_control_revision: data.expectedControlRevision,
        _operator_user_id: context.userId,
        _reason: data.reason,
      },
    );

    if (error) return { ...base, ok: false, notice: "RPC_REFUSED" };
    return { ...base, ok: true, notice: null, payload: JSON.stringify(payload ?? null) };
  });

/* ------------------------------------------------------------------ */
/* 4 — ONE-WAY emergency stop                                          */
/* ------------------------------------------------------------------ */

export const engageCanaryEmergencyStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason: string }) => {
    const reason = input && typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 8 || reason.length > 400) throw new Error("Invalid reason");
    return { reason };
  })
  .handler(async ({ data, context }): Promise<CanaryStopResult> => {
    const base: CanaryStopResult = {
      ok: false,
      notice: null,
      executionEnabled: null,
      emergencyStopEngaged: null,
      revision: null,
      reason: null,
    };
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ...base, notice: "NOT_AUTHORIZED" };
    }

    // ENGAGE ONLY. This module contains no clear/disengage/enable counterpart.
    const { data: raw, error } = await context.supabase.rpc(
      "engage_launch_chain_production_emergency_stop",
      { _operator_user_id: context.userId, _reason: data.reason },
    );

    const row = error ? null : firstRow(raw);
    if (!row) return { ...base, notice: "RPC_REFUSED" };

    return {
      ok: true,
      notice: null,
      executionEnabled: bool(row, "execution_enabled"),
      emergencyStopEngaged: bool(row, "emergency_stop_engaged"),
      revision: num(row, "revision"),
      reason: str(row, "reason"),
    };
  });

/* ------------------------------------------------------------------ */
/* 5 — READ-ONLY existing nonterminal production attempt lookup        */
/* ------------------------------------------------------------------ */

/**
 * P3C-F3 — awareness only. This wrapper READS one row and nothing else: it
 * never inserts, updates, abandons, presigns, arms, claims, sends, persists,
 * verifies or calls any mutation RPC. It exists purely so the console can
 * refuse to create a duplicate attempt and can display the immutable
 * deployer/recipient already bound to an existing production attempt.
 */
export type CanaryExistingAttempt = {
  deploymentId: string;
  attemptNumber: number;
  status: string;
  deployerAddress: string;
  tokenRecipient: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenTotalSupplyBaseUnits: string | null;
  txHash: string | null;
  contractAddress: string | null;
  createdAt: string;
};

export type CanaryExistingAttemptResult = {
  ok: boolean;
  notice: CanaryNotice | null;
  /** Sanitized, truncated diagnostic for the owner-only console. Never secrets. */
  detail: string | null;
  /**
   * ACTIVE / RESUMABLE attempt only (DRAFT, SUBMITTED, PENDING). This is the
   * ONLY value that may ever become a live deployment context.
   */
  attempt: CanaryExistingAttempt | null;
  /**
   * COMPLETED HISTORY (CONFIRMED). Display only. It permanently blocks creating
   * another production attempt for the same launch, and it is NEVER a resume,
   * presign, ARM, CLAIM or send context.
   */
  confirmed: CanaryExistingAttempt | null;
};

/** Statuses that may still be continued by the manual stages. */
const ACTIVE_ATTEMPT_STATUSES = ["DRAFT", "SUBMITTED", "PENDING"] as const;
/** Completed production history. Blocking, never resumable. */
const CONFIRMED_ATTEMPT_STATUS = "CONFIRMED" as const;
/** Restartable terminal statuses: they bind nothing and block nothing. */
const TERMINAL_ATTEMPT_STATUSES = ["FAILED", "ABANDONED"] as const;

function sanitizeDetail(value: unknown): string | null {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

type DeploymentRow = {
  id: string;
  attempt_number: number;
  status: string;
  deployer_address: string;
  token_recipient: string | null;
  token_name: string | null;
  token_symbol: string | null;
  token_total_supply_text: string | null;
  tx_hash: string | null;
  contract_address: string | null;
  created_at: string;
};

function toAttempt(row: DeploymentRow): CanaryExistingAttempt {
  return {
    deploymentId: row.id,
    attemptNumber: row.attempt_number,
    status: row.status,
    deployerAddress: row.deployer_address,
    tokenRecipient: row.token_recipient,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenTotalSupplyBaseUnits: row.token_total_supply_text,
    txHash: row.tx_hash,
    contractAddress: row.contract_address,
    createdAt: row.created_at,
  };
}

export const readCanaryExistingAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { launchId: string }) => {
    const launchId = input && typeof input.launchId === "string" ? input.launchId : "";
    if (!UUID.test(launchId)) throw new Error("Invalid launch id");
    return { launchId };
  })
  .handler(async ({ data, context }): Promise<CanaryExistingAttemptResult> => {
    if (!(await isPlatformOwner(context.supabase as unknown as SupabaseLike, context.userId))) {
      return { ok: false, notice: "NOT_AUTHORIZED", detail: null, attempt: null, confirmed: null };
    }

    try {
      // READ ONLY. Exact chain, exact environment, exact deployment kind. Rows
      // are classified in code so a completed CONFIRMED deployment can never be
      // mistaken for a resumable attempt, and terminal rows bind nothing.
      const { data: rows, error } = await context.supabase
        .from("launch_chain_deployments")
        .select(
          "id, attempt_number, status, deployer_address, token_recipient, token_name, token_symbol, token_total_supply_text, tx_hash, contract_address, created_at",
        )
        .eq("launch_id", data.launchId)
        .eq("chain_id", ROBINHOOD_MAINNET_CHAIN_ID)
        .eq("network_environment", "PRODUCTION")
        .eq("deployment_kind", "FIXED_SUPPLY_ERC20")
        .order("attempt_number", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[canary] existing-attempt lookup failed", error.message);
        return {
          ok: false,
          notice: "RPC_REFUSED",
          detail: sanitizeDetail(error.message),
          attempt: null,
          confirmed: null,
        };
      }

      const all = (Array.isArray(rows) ? rows : []) as DeploymentRow[];
      const active =
        all.find((row) =>
          (ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(row.status),
        ) ?? null;
      const confirmed = all.find((row) => row.status === CONFIRMED_ATTEMPT_STATUS) ?? null;
      // TERMINAL_ATTEMPT_STATUSES rows are intentionally ignored here: they are
      // neither resumable nor blocking, and they never bind a new intent.
      void TERMINAL_ATTEMPT_STATUSES;

      return {
        ok: true,
        notice: null,
        detail: null,
        attempt: active ? toAttempt(active) : null,
        confirmed: confirmed ? toAttempt(confirmed) : null,
      };
    } catch (caught) {
      // FAIL CLOSED: an unverified lookup is never reported as "no attempt".
      console.error("[canary] existing-attempt lookup threw", caught);
      return {
        ok: false,
        notice: "CONTROL_STATE_UNAVAILABLE",
        detail: sanitizeDetail(caught),
        attempt: null,
        confirmed: null,
      };
    }
  });


