import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the authenticated Edge Function `platform-admin`.
 *
 * Platform-owner identity is SERVER-AUTHORITATIVE. This module never reads
 * `platform_user_roles` directly, never compares emails and never performs
 * privileged writes. It only forwards the read-only `status` action.
 */

export type PlatformRole = "owner" | (string & {});

export type PlatformMetrics = {
  users_total?: number | null;
  workspaces_total?: number | null;
  workspace_members_total?: number | null;
  sticker_packs_total?: number | null;
  sticker_packs_published?: number | null;
  stickers_total?: number | null;
  telegram_stickers_published?: number | null;
  telegram_accounts_linked?: number | null;
  telegram_groups_connected?: number | null;
  ai_jobs_total?: number | null;
  ai_jobs_succeeded?: number | null;
  ai_jobs_failed?: number | null;
  usage_units_total?: number | null;
  provider_cost_total?: number | null;
  internal_cost_total?: number | null;
  drop_schedules_total?: number | null;
  drop_schedules_enabled?: number | null;
  drop_events_sent?: number | null;
  drop_events_failed?: number | null;
  beta_contacts_total?: number | null;
  beta_contacts_opted_in?: number | null;
  scheduler_job_active?: boolean | null;
  scheduler_last_run_status?: string | null;
  scheduler_last_run_at?: string | null;
};

/**
 * `details` is a v2 owner-only payload. Every field is optional and tolerant:
 * the server may enrich rows with joined labels, so we accept both the raw
 * column name and a common enriched alias, and never assume presence.
 */
export type PlatformUserDetail = {
  id?: string | null;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  confirmed?: boolean | null;
};

export type PlatformWorkspaceDetail = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  created_at?: string | null;
  members?: number | null;
  groups?: number | null;
  packs?: number | null;
  published_packs?: number | null;
  schedules?: number | null;
  enabled_schedules?: number | null;
  /** Legacy aliases, tolerated if an older payload is served. */
  members_count?: number | null;
  groups_count?: number | null;
  packs_count?: number | null;
  published_packs_count?: number | null;
  schedules_count?: number | null;
  enabled_schedules_count?: number | null;
};

export type PlatformTelegramGroupDetail = {
  id?: string | null;
  workspace_id?: string | null;
  title?: string | null;
  username?: string | null;
  chat_type?: string | null;
  bot_is_admin?: boolean | null;
  can_set_sticker_set?: boolean | null;
  verified_at?: string | null;
  connected_at?: string | null;
};

export type PlatformStickerPackDetail = {
  id?: string | null;
  workspace_id?: string | null;
  title?: string | null;
  status?: string | null;
  telegram_set_name?: string | null;
  telegram_set_url?: string | null;
  telegram_published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PlatformDropScheduleDetail = {
  id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  group_connection_id?: string | null;
  group_title?: string | null;
  group_username?: string | null;
  pack_id?: string | null;
  pack_title?: string | null;
  /** Legacy alias. */
  pack_name?: string | null;
  enabled?: boolean | null;
  paused_reason?: string | null;
  interval_minutes?: number | null;
  daily_cap?: number | null;
  active_start?: string | null;
  active_end?: string | null;
  timezone?: string | null;
  next_run_at?: string | null;
  last_sent_at?: string | null;
  consecutive_failures?: number | null;
  selected_sticker_ids?: string[] | null;
};

export type PlatformDropEventDetail = {
  id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  group_title?: string | null;
  pack_title?: string | null;
  /** Legacy alias. */
  pack_name?: string | null;
  status?: string | null;
  error_message?: string | null;
  created_at?: string | null;
};

export type PlatformAiJobDetail = {
  id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  job_type?: string | null;
  provider?: string | null;
  provider_model?: string | null;
  status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export type PlatformBetaContactDetail = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  telegram_username?: string | null;
  chat_title?: string | null;
  chat_type?: string | null;
  subject_type?: string | null;
  source?: string | null;
  source_chat_title?: string | null;
  source_chat_type?: string | null;
  opted_in?: boolean | null;
  last_seen_at?: string | null;
};

export type PlatformDetails = {
  users: PlatformUserDetail[];
  workspaces: PlatformWorkspaceDetail[];
  telegramGroups: PlatformTelegramGroupDetail[];
  stickerPacks: PlatformStickerPackDetail[];
  stickerDropSchedules: PlatformDropScheduleDetail[];
  recentDropEvents: PlatformDropEventDetail[];
  recentAiJobs: PlatformAiJobDetail[];
  betaContacts: PlatformBetaContactDetail[];
};

export type PlatformStatus = {
  isPlatformOwner: boolean;
  hasUnrestrictedAccess: boolean;
  role: PlatformRole | null;
  capabilities: string[];
  metrics: PlatformMetrics | null;
  details: PlatformDetails | null;
};

const EMPTY_DETAILS: PlatformDetails = {
  users: [],
  workspaces: [],
  telegramGroups: [],
  stickerPacks: [],
  stickerDropSchedules: [],
  recentDropEvents: [],
  recentAiJobs: [],
  betaContacts: [],
};

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter((r) => r && typeof r === "object") as T[]) : [];
}

/** Fails closed: unknown/absent payload becomes empty lists, never partial guesses. */
function normalizeDetails(input: unknown): PlatformDetails {
  if (!input || typeof input !== "object") return EMPTY_DETAILS;
  const d = input as Record<string, unknown>;
  return {
    users: rows<PlatformUserDetail>(d["users"]),
    workspaces: rows<PlatformWorkspaceDetail>(d["workspaces"]),
    telegramGroups: rows<PlatformTelegramGroupDetail>(d["telegramGroups"]),
    stickerPacks: rows<PlatformStickerPackDetail>(d["stickerPacks"]),
    stickerDropSchedules: rows<PlatformDropScheduleDetail>(d["stickerDropSchedules"]),
    recentDropEvents: rows<PlatformDropEventDetail>(d["recentDropEvents"]),
    recentAiJobs: rows<PlatformAiJobDetail>(d["recentAiJobs"]),
    betaContacts: rows<PlatformBetaContactDetail>(d["betaContacts"]),
  };
}


async function readServerMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const body = (await ctx.json()) as { message?: unknown; error?: unknown } | null;
    const msg = body?.message ?? body?.error;
    return typeof msg === "string" && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

/** Turns any thrown error into a short, user-safe line. */
export function platformErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return "Owner console request failed. Try again in a moment.";
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}

/** Read-only platform status. Fails closed at every call site. */
export async function fetchPlatformStatus(): Promise<PlatformStatus> {
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "status" },
  });

  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The platform service is unavailable right now.",
    );
  }

  const payload = data as
    | (Partial<Omit<PlatformStatus, "details">> & {
        details?: unknown;
        error?: string;
        message?: string;
      })
    | null;
  if (!payload) throw new Error("Empty response from the platform service.");
  if (payload.error) throw new Error(payload.message || payload.error);

  const owner = payload.isPlatformOwner === true;

  return {
    isPlatformOwner: owner,
    hasUnrestrictedAccess: payload.hasUnrestrictedAccess === true,
    role: payload.role ?? null,
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    metrics: owner ? (payload.metrics ?? null) : null,
    details: owner ? normalizeDetails(payload.details) : null,
  };

}

/* --------------------------------------------------------------------------
 * Owner-only Telegram system message templates.
 * All access is server-verified inside the `platform-admin` Edge Function; the
 * browser never touches `platform_message_templates` directly.
 * ----------------------------------------------------------------------- */

export type PlatformMessageTemplateKey =
  | "bot_installed"
  | "account_found"
  | "community_connected";

export type PlatformMessageTemplate = {
  key: PlatformMessageTemplateKey;
  draft_body: string;
  published_body: string | null;
  draft_updated_at: string | null;
  published_at: string | null;
  updated_at: string | null;
};

async function invokeTemplateAction(
  body: Record<string, unknown>,
): Promise<PlatformMessageTemplate[]> {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body });

  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The platform service is unavailable right now.",
    );
  }

  const payload = data as
    | { templates?: unknown; error?: string; message?: string }
    | null;
  if (!payload) throw new Error("Empty response from the platform service.");
  if (payload.error) throw new Error(payload.message || payload.error);

  const rows = Array.isArray(payload.templates) ? payload.templates : [];
  return rows
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row?.["key"] === "string")
    .map((row) => ({
      key: row["key"] as PlatformMessageTemplateKey,
      draft_body: typeof row["draft_body"] === "string" ? row["draft_body"] : "",
      published_body:
        typeof row["published_body"] === "string" ? row["published_body"] : null,
      draft_updated_at:
        typeof row["draft_updated_at"] === "string" ? row["draft_updated_at"] : null,
      published_at: typeof row["published_at"] === "string" ? row["published_at"] : null,
      updated_at: typeof row["updated_at"] === "string" ? row["updated_at"] : null,
    }));
}

export async function fetchPlatformMessageTemplates(): Promise<PlatformMessageTemplate[]> {
  return invokeTemplateAction({ action: "templates_list" });
}

export async function savePlatformMessageDraft(
  key: PlatformMessageTemplateKey,
  body: string,
): Promise<PlatformMessageTemplate[]> {
  return invokeTemplateAction({ action: "templates_save_draft", key, body });
}

export async function publishPlatformMessage(
  key: PlatformMessageTemplateKey,
  body?: string,
): Promise<PlatformMessageTemplate[]> {
  return invokeTemplateAction({
    action: "templates_publish",
    key,
    ...(typeof body === "string" ? { body } : {}),
  });
}

export async function restorePlatformMessageDefault(
  key: PlatformMessageTemplateKey,
): Promise<PlatformMessageTemplate[]> {
  return invokeTemplateAction({ action: "templates_restore_default", key });
}


export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat().format(value);
}

/**
 * Ledger costs are plain numeric values (`usage_ledger.provider_cost` /
 * `internal_cost`). No currency is asserted here.
 */
export function formatCost(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
