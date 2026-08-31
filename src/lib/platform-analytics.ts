import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 9D — platform-owner Launch Analytics data layer.
 *
 * Browser access is RPC-only via the Phase 9C owner-gated SECURITY DEFINER
 * function `public.get_platform_launch_analytics()`. There are NO direct reads
 * of launches, Launch Watch subscriptions, notification deliveries, community
 * settings or moderation tables from the browser.
 *
 * These are descriptive operational counts. They are not engagement scores and
 * not price/market/investment analytics. The RPC never returns subscriber
 * identities, Telegram ids, chat ids, internal ids or reviewer notes.
 */

type Fns = Database["public"]["Functions"];

export type PlatformLaunchAnalyticsRow =
  Fns["get_platform_launch_analytics"]["Returns"][number];

/** Only the keys the Phase 9C RPC returns for each per-launch entry. */
export type PerLaunchAnalytics = {
  launch_public_slug: string | null;
  project_public_slug: string | null;
  project_name: string | null;
  token_name: string | null;
  ticker: string | null;
  chain: string | null;
  status: string | null;
  launch_at: string | null;
  active_watchers: number;
  muted_watchers: number;
  events_total: number;
  deliveries_sent: number;
  deliveries_pending: number;
  deliveries_failed: number;
};

export type PlatformLaunchAnalytics = Omit<
  PlatformLaunchAnalyticsRow,
  "launches_by_status" | "deliveries_by_status" | "per_launch"
> & {
  launches_by_status: Record<string, number>;
  deliveries_by_status: Record<string, number>;
  per_launch: PerLaunchAnalytics[];
};

export const platformAnalyticsKeys = {
  all: () => ["platform-launch-analytics"] as const,
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Defensive: malformed/missing JSON becomes an empty map rather than throwing. */
function toCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || !key) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** Defensive: only known-safe keys are projected; anything else is dropped. */
function toPerLaunch(value: unknown): PerLaunchAnalytics[] {
  if (!Array.isArray(value)) return [];
  const rows: PerLaunchAnalytics[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    rows.push({
      launch_public_slug: str(o["launch_public_slug"]),
      project_public_slug: str(o["project_public_slug"]),
      project_name: str(o["project_name"]),
      token_name: str(o["token_name"]),
      ticker: str(o["ticker"]),
      chain: str(o["chain"]),
      status: str(o["status"]),
      launch_at: str(o["launch_at"]),
      active_watchers: num(o["active_watchers"]),
      muted_watchers: num(o["muted_watchers"]),
      events_total: num(o["events_total"]),
      deliveries_sent: num(o["deliveries_sent"]),
      deliveries_pending: num(o["deliveries_pending"]),
      deliveries_failed: num(o["deliveries_failed"]),
    });
  }
  return rows;
}

export async function fetchPlatformLaunchAnalytics(): Promise<PlatformLaunchAnalytics | null> {
  const { data, error } = await supabase.rpc("get_platform_launch_analytics");
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    ...row,
    launches_by_status: toCountMap(row.launches_by_status),
    deliveries_by_status: toCountMap(row.deliveries_by_status),
    per_launch: toPerLaunch(row.per_launch),
  };
}

/** Delivery states already surfaced as canonical counters in the UI. */
export const CANONICAL_DELIVERY_STATES = new Set([
  "sent",
  "pending",
  "processing",
  "retry",
  "failed",
]);
