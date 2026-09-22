/**
 * CARTEL HQ — Cost Accounting Foundation, Phase 1 shared writer.
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
 */

/** Minimal structural type of the service-role Supabase client. */
export interface UsageAccountingClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

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

export type UsageAccountingOutcome =
  | { recorded: true; duplicate: false }
  | { recorded: false; duplicate: true }
  | { recorded: false; duplicate: false; skipped: true }
  | { recorded: false; duplicate: false; error: string };

/**
 * Stable key for one real provider charge.
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

const PROVIDER_CREDIT_UNIT_TYPE = "provider_credit";

export async function recordProviderCreditUsage(
  admin: UsageAccountingClient,
  input: ProviderCreditUsageInput,
): Promise<UsageAccountingOutcome> {
  if (input.credits == null || !Number.isFinite(input.credits)) {
    return { recorded: false, duplicate: false, skipped: true };
  }

  const idempotencyKey = buildProviderUsageIdempotencyKey(
    input.provider,
    input.actionType,
    input.aiJobId,
    input.providerTaskId,
  );

  const row = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    ai_job_id: input.aiJobId,
    action_type: input.actionType,
    units: input.credits,
    provider: input.provider,
    provider_model: input.providerModel,
    unit_type: PROVIDER_CREDIT_UNIT_TYPE,
    currency: null,
    pricing_source: null,
    pricing_version: null,
    pricing_effective_at: null,
    provider_cost: null,
    internal_cost: null,
    idempotency_key: idempotencyKey,
    metadata: {
      provider_task_id: input.providerTaskId ?? null,
      job_type: input.jobType ?? null,
    },
  };

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
        action_type: input.actionType,
        ai_job_id: input.aiJobId,
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
      action_type: input.actionType,
      ai_job_id: input.aiJobId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { recorded: false, duplicate: false, error: "exception" };
  }
}
