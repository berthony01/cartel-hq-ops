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

export type PlatformStatus = {
  isPlatformOwner: boolean;
  hasUnrestrictedAccess: boolean;
  role: PlatformRole | null;
  capabilities: string[];
  metrics: PlatformMetrics | null;
};

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

  const payload = data as (Partial<PlatformStatus> & { error?: string; message?: string }) | null;
  if (!payload) throw new Error("Empty response from the platform service.");
  if (payload.error) throw new Error(payload.message || payload.error);

  return {
    isPlatformOwner: payload.isPlatformOwner === true,
    hasUnrestrictedAccess: payload.hasUnrestrictedAccess === true,
    role: payload.role ?? null,
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    metrics: payload.isPlatformOwner === true ? (payload.metrics ?? null) : null,
  };
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
