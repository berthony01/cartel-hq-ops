/**
 * CARTEL HQ — Cost Accounting shared writer (Phase 1 + Phase 2A).
 *
 * The single place Edge Functions record provider usage into
 * `public.usage_ledger`.
 *
 * Invariants:
 *  - `units` is the RAW provider-reported quantity. No dollar amount, rate
 *    card or conversion exists here; `currency` and every `pricing_*` column
 *    stay null so pricing can be versioned later without rewriting history.
 *  - `provider_cost` / `internal_cost` are never written.
 *  - Usage is recorded for EVERY caller, including platform owners. This
 *    module contains no plan, entitlement, quota or billing logic of any kind.
 *  - Duplicate protection is DATABASE-authoritative: the unique index
 *    `usage_ledger_idempotency_key_uniq` decides, not an app pre-check.
 *  - Accounting never breaks an otherwise successful provider job: a duplicate
 *    is a success no-op and any other failure is logged server-side only.
 *
 * Phase 2A adds the generic `recordProviderUsage` writer for providers that
 * report something other than credits (tokens, or nothing more than the fact
 * that one request happened) and for events that have no `ai_jobs` row at all.
 * `recordProviderCreditUsage` keeps its exact Phase 1 key shape and
 * `provider_credit` unit type.
 */

/** Minimal structural type of the service-role Supabase client. */
export interface UsageAccountingClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export type UsageMetadata = Record<string, unknown>;

export type UsageAccountingOutcome =
  | { recorded: true; duplicate: false }
  | { recorded: false; duplicate: true }
  | { recorded: false; duplicate: false; skipped: true }
  | { recorded: false; duplicate: false; error: string };

const PROVIDER_CREDIT_UNIT_TYPE = "provider_credit";

/**
 * Pricing and derived-cost columns are ALWAYS null at write time. Dollars are
 * derived later from a versioned rate card so history is never rewritten.
 */
const NULL_PRICING = {
  currency: null,
  pricing_source: null,
  pricing_version: null,
  pricing_effective_at: null,
  provider_cost: null,
  internal_cost: null,
} as const;

/**
 * Phase 1 key — stable identity of one real provider charge.
 *
 * `provider:action:job:task` — repeated polling/completion of the SAME
 * provider task dedupes, while a genuinely new provider task on the same
 * ai_job is represented separately. Credits and timestamps are deliberately
 * excluded so a re-read of the same event cannot create a second row.
 */
export function buildProviderUsageIdempotencyKey(
  provider: string,
  actionType: string,
  aiJobId: string,
  providerTaskId: string | null | undefined,
): string {
  const task = typeof providerTaskId === "string" && providerTaskId.trim().length > 0
    ? providerTaskId.trim()
    : "job";
  return `${provider}:${actionType}:${aiJobId}:${task}`;
}

/**
 * Phase 2A generic key — `provider:action:job-or-no-job:event`.
 *
 * For a non-null `aiJobId` this is byte-identical in shape to the Phase 1 key,
 * so the two writers can never disagree about the same event. Events with no
 * `ai_jobs` row (for example concept generation) use the literal `no-job`
 * segment and carry their identity entirely in `eventId`.
 */
export function buildUsageIdempotencyKey(
  provider: string,
  actionType: string,
  aiJobId: string | null | undefined,
  eventId: string,
): string {
  const job = typeof aiJobId === "string" && aiJobId.trim().length > 0 ? aiJobId.trim() : "no-job";
  return `${provider}:${actionType}:${job}:${eventId.trim()}`;
}

/** Shared duplicate-safe insert. The DB unique index is the only authority. */
async function insertLedgerRow(
  admin: UsageAccountingClient,
  row: Record<string, unknown>,
): Promise<UsageAccountingOutcome> {
  try {
    const { data, error } = await admin
      .from("usage_ledger")
      .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id");

    if (error) {
      // 23505 can still surface under a concurrent insert race: that is the
      // duplicate outcome, not a failure.
      if ((error as { code?: string }).code === "23505") {
        return { recorded: false, duplicate: true };
      }
      console.error("usage-accounting: ledger write failed", {
        action_type: row["action_type"] ?? null,
        ai_job_id: row["ai_job_id"] ?? null,
        code: (error as { code?: string }).code ?? null,
        message: (error as { message?: string }).message ?? null,
      });
      return {
        recorded: false,
        duplicate: false,
        error: (error as { message?: string }).message ?? "unknown",
      };
    }

    // `ignoreDuplicates` returns no row when the key already existed.
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return { recorded: false, duplicate: true };
    return { recorded: true, duplicate: false };
  } catch (e) {
    console.error("usage-accounting: ledger write threw", {
      action_type: row["action_type"] ?? null,
      ai_job_id: row["ai_job_id"] ?? null,
      message: e instanceof Error ? e.message : String(e),
    });
    return { recorded: false, duplicate: false, error: "exception" };
  }
}

/* ------------------------------------------------------------ Phase 2A ---- */

export interface ProviderUsageInput {
  workspaceId: string;
  userId: string | null;
  /** `null` for provider events that legitimately have no `ai_jobs` row. */
  aiJobId: string | null;
  actionType: string;
  /** RAW provider-reported quantity. A genuine reported `0` is preserved. */
  units: number;
  /** Concrete raw unit: `provider_credit`, `token`, `api_request`, … */
  unitType: string;
  provider: string;
  providerModel: string | null;
  /** Stable identity of this one provider event. */
  eventId: string;
  metadata?: UsageMetadata;
}

export async function recordProviderUsage(
  admin: UsageAccountingClient,
  input: ProviderUsageInput,
): Promise<UsageAccountingOutcome> {
  if (typeof input.units !== "number" || !Number.isFinite(input.units) || input.units < 0) {
    return { recorded: false, duplicate: false, skipped: true };
  }
  if (typeof input.unitType !== "string" || input.unitType.trim().length === 0) {
    return { recorded: false, duplicate: false, skipped: true };
  }
  if (typeof input.eventId !== "string" || input.eventId.trim().length === 0) {
    return { recorded: false, duplicate: false, skipped: true };
  }

  const row = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    ai_job_id: input.aiJobId,
    action_type: input.actionType,
    units: input.units,
    provider: input.provider,
    provider_model: input.providerModel,
    unit_type: input.unitType.trim(),
    ...NULL_PRICING,
    idempotency_key: buildUsageIdempotencyKey(
      input.provider,
      input.actionType,
      input.aiJobId,
      input.eventId,
    ),
    metadata: input.metadata ?? {},
  };

  return await insertLedgerRow(admin, row);
}

/* ------------------------------------------------------------ Phase 2B ---- */

export const X_RESOURCE_UNIT_TYPE = "resource_read";
export const X_RESOURCE_PROVIDER = "x";

/**
 * Phase 2B X key — `x:action:resource_id:YYYY-MM-DD`.
 *
 * DELIBERATELY APP-GLOBAL: X bills per resource returned, deduplicated per
 * resource per UTC day at the APP level. A workspace or ai_job segment would
 * count one billable resource twice whenever two workspaces track the same
 * post on the same day, so neither appears in this key.
 */
export function buildXResourceIdempotencyKey(
  actionType: string,
  resourceId: string,
  billingUtcDate: string,
): string {
  return `${X_RESOURCE_PROVIDER}:${actionType}:${resourceId.trim()}:${billingUtcDate.trim()}`;
}

export interface XResourceReadInput {
  workspaceId: string;
  userId: string | null;
  actionType: string;
  /** The X resource id actually present in the successful response. */
  resourceId: string;
  /** UTC calendar day of the read, `YYYY-MM-DD`. */
  billingUtcDate: string;
  /** Endpoint descriptor, never an invented model name. */
  providerModel: string;
  metadata?: UsageMetadata;
}

/**
 * One raw billable X resource-read, per resource per UTC day.
 *
 * This is our best raw billing-identity estimate matching X's documented
 * soft dedupe guarantee. It is NOT X's invoice: no rate, no currency and no
 * dollar amount is recorded here or anywhere downstream of it.
 */
export async function recordXResourceRead(
  admin: UsageAccountingClient,
  input: XResourceReadInput,
): Promise<UsageAccountingOutcome> {
  if (typeof input.resourceId !== "string" || input.resourceId.trim().length === 0) {
    return { recorded: false, duplicate: false, skipped: true };
  }
  if (typeof input.billingUtcDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.billingUtcDate.trim())) {
    return { recorded: false, duplicate: false, skipped: true };
  }
  if (typeof input.actionType !== "string" || input.actionType.trim().length === 0) {
    return { recorded: false, duplicate: false, skipped: true };
  }

  const row = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    ai_job_id: null,
    action_type: input.actionType,
    units: 1,
    provider: X_RESOURCE_PROVIDER,
    provider_model: input.providerModel,
    unit_type: X_RESOURCE_UNIT_TYPE,
    ...NULL_PRICING,
    idempotency_key: buildXResourceIdempotencyKey(
      input.actionType,
      input.resourceId,
      input.billingUtcDate,
    ),
    metadata: input.metadata ?? {},
  };

  return await insertLedgerRow(admin, row);
}

/* ------------------------------------------------------------- Phase 1 ---- */

export interface ProviderCreditUsageInput {
  workspaceId: string;
  userId: string | null;
  aiJobId: string;
  actionType: string;
  /** Raw provider-reported credits. `null` means the provider reported none. */
  credits: number | null;
  provider: string;
  providerModel: string | null;
  providerTaskId: string | null;
  jobType: string | null;
}

/**
 * Phase 1 credit writer. Thin wrapper over the shared insert that preserves the
 * exact Phase 1 key shape and unit type; deployed Phase 1 functions are
 * unchanged by Phase 2A.
 */
export async function recordProviderCreditUsage(
  admin: UsageAccountingClient,
  input: ProviderCreditUsageInput,
): Promise<UsageAccountingOutcome> {
  if (input.credits == null || !Number.isFinite(input.credits)) {
    return { recorded: false, duplicate: false, skipped: true };
  }

  const row = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    ai_job_id: input.aiJobId,
    action_type: input.actionType,
    units: input.credits,
    provider: input.provider,
    provider_model: input.providerModel,
    unit_type: PROVIDER_CREDIT_UNIT_TYPE,
    ...NULL_PRICING,
    idempotency_key: buildProviderUsageIdempotencyKey(
      input.provider,
      input.actionType,
      input.aiJobId,
      input.providerTaskId,
    ),
    metadata: {
      provider_task_id: input.providerTaskId ?? null,
      job_type: input.jobType ?? null,
    },
  };

  return await insertLedgerRow(admin, row);
}
