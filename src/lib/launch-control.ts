import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 3 — Launch Control data layer.
 *
 * Thin typed wrapper over the already-authoritative external Supabase backend:
 * table `public.launches`, plus RPCs `transition_launch_status` and
 * `set_launch_contract_address`. All access goes through the browser Supabase
 * client as the signed-in user; RLS and the server-side triggers/RPCs remain
 * the only enforcement boundary. Nothing here re-implements backend rules —
 * the UI hints mirror them, the database decides.
 */

export type LaunchRow = Database["public"]["Tables"]["launches"]["Row"];

export const LAUNCH_STATUSES = [
  "DRAFT",
  "ANNOUNCED",
  "WATCHLIST_OPEN",
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
  "OFFICIAL_CONTRACT_REGISTERED",
  "LIVE",
  "COMPLETED",
] as const;

export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const LAUNCH_STATUS_LABELS: Record<LaunchStatus, string> = {
  DRAFT: "Draft",
  ANNOUNCED: "Announced",
  WATCHLIST_OPEN: "Watchlist open",
  LAUNCH_APPROACHING: "Launch approaching",
  CONTRACT_PENDING: "Contract pending",
  OFFICIAL_CONTRACT_REGISTERED: "Official contract registered",
  LIVE: "Live",
  COMPLETED: "Completed",
};

export const LAUNCH_STATUS_HELP: Record<LaunchStatus, string> = {
  DRAFT: "Being prepared. Identity fields are still editable and the launch can be deleted.",
  ANNOUNCED: "Launch identity is locked. Schedule and notes remain editable.",
  WATCHLIST_OPEN:
    "Launch Watch opt-ins are open through the PepeCartel Telegram bot. Countdown reminders are scheduled from the launch time.",

  LAUNCH_APPROACHING: "Schedule is confirmed and the launch window is close.",
  CONTRACT_PENDING: "Official contract address can now be submitted.",
  OFFICIAL_CONTRACT_REGISTERED:
    "The project has registered its official contract reference, bound to verified deployment evidence. Notifying watchers is a separate, explicit owner action.",

  LIVE: "Launch is live. Schedule fields are locked and active watchers receive the launch-live alert.",

  COMPLETED: "Launch lifecycle is finished.",
};

/** Strict single-step progression enforced by the backend. */
export function nextLaunchStatus(status: LaunchStatus): LaunchStatus | null {
  const index = LAUNCH_STATUSES.indexOf(status);
  if (index < 0 || index >= LAUNCH_STATUSES.length - 1) return null;
  return LAUNCH_STATUSES[index + 1]!;
}

export function toLaunchStatus(value: string): LaunchStatus {
  return (LAUNCH_STATUSES as readonly string[]).includes(value)
    ? (value as LaunchStatus)
    : "DRAFT";
}

export function launchStatusIndex(status: LaunchStatus): number {
  return LAUNCH_STATUSES.indexOf(status);
}

// ---------------------------------------------------------------------------
// P2-C2 — launch classification (`launches.launch_kind`).
//
// `PROJECT` is the ordinary customer launch. `INTERNAL_TEST` is a permanently
// private chain-test record: the database keeps it DRAFT, tokenless and
// unbindable to an official contract. Classification is immutable after
// creation and is never chosen in the ordinary new-launch form — the column
// default supplies `PROJECT`.
//
// Every normal product surface must ignore INTERNAL_TEST explicitly, even
// though the DB constraints already keep those rows private.
// ---------------------------------------------------------------------------

export const LAUNCH_KINDS = ["PROJECT", "INTERNAL_TEST"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

/** Unknown/missing classification is treated as PROJECT (the column default). */
export function toLaunchKind(value: string | null | undefined): LaunchKind {
  return value === "INTERNAL_TEST" ? "INTERNAL_TEST" : "PROJECT";
}

export type LaunchKindSource = { launch_kind?: string | null };

export function isProjectLaunch(row: LaunchKindSource): boolean {
  return toLaunchKind(row.launch_kind) === "PROJECT";
}

export function isInternalTestLaunch(row: LaunchKindSource): boolean {
  return toLaunchKind(row.launch_kind) === "INTERNAL_TEST";
}

export type LaunchPrioritySource = LaunchKindSource & {
  id: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
};

function launchRecencyOf(row: LaunchPrioritySource): number {
  const parsed = Date.parse(row.updated_at ?? row.created_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The single deterministic primary-launch rule shared by Launch Control,
 * Launch Readiness and the Project Journey:
 *   1. newest PROJECT launch that is neither DRAFT nor COMPLETED,
 *   2. otherwise the newest PROJECT DRAFT,
 *   3. otherwise the newest PROJECT COMPLETED.
 * Ties break on ascending id. INTERNAL_TEST rows can never be chosen, and no
 * project name, ticker or id is ever special-cased.
 */
export function selectPrimaryProjectLaunch<T extends LaunchPrioritySource>(
  rows: readonly T[],
): T | null {
  const projectRows = rows.filter(isProjectLaunch);
  if (projectRows.length === 0) return null;
  const byNewest = [...projectRows].sort((a, b) => {
    const diff = launchRecencyOf(b) - launchRecencyOf(a);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  const statusOf = (row: T) => toLaunchStatus(row.status);
  return (
    byNewest.find((row) => statusOf(row) !== "DRAFT" && statusOf(row) !== "COMPLETED") ??
    byNewest.find((row) => statusOf(row) === "DRAFT") ??
    byNewest[0]!
  );
}


/** Identity fields are editable only while DRAFT. */
export function identityLocked(status: LaunchStatus): boolean {
  return status !== "DRAFT";
}

/** Schedule fields are locked once the launch is LIVE. */
export function scheduleLocked(status: LaunchStatus): boolean {
  return status === "LIVE" || status === "COMPLETED";
}

export function canDeleteLaunch(status: LaunchStatus): boolean {
  return status === "DRAFT";
}

export function hasSchedule(row: Pick<LaunchRow, "launch_at" | "launch_window_start" | "launch_window_end">): boolean {
  return Boolean(row.launch_at || (row.launch_window_start && row.launch_window_end));
}

export const TOKEN_NAME_MAX = 120;
export const TICKER_MAX = 20;
export const CHAIN_MAX = 64;
export const SLUG_MIN = 2;
/** Mirrors the authoritative DB constraint on launches.public_slug (2-96). */
export const SLUG_MAX = 96;
export const NOTES_MAX = 3000;
export const CONTRACT_MAX = 256;
export const SLUG_RULE_HINT = "2–96 characters, lowercase letters, numbers and hyphens.";
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;


export function isValidLaunchSlug(value: string): boolean {
  return value.length >= SLUG_MIN && value.length <= SLUG_MAX && SLUG_PATTERN.test(value);
}

export function slugifyLaunch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Device timezone. datetime-local values are interpreted in this zone. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `datetime-local` string -> ISO, interpreted in the device timezone. */
export function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** ISO -> `datetime-local` string rendered in the device timezone. */
export function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export class LaunchSlugConflictError extends Error {
  constructor() {
    super("That public launch slug is already in use. Try another one.");
    this.name = "LaunchSlugConflictError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function rethrow(error: unknown): never {
  if (isUniqueViolation(error)) throw new LaunchSlugConflictError();
  if (error instanceof Error) throw error;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "Unexpected error.";
  throw new Error(message);
}

/**
 * Launches for ONE project profile inside ONE workspace. Both filters are
 * required: a workspace-only query could list launches belonging to another
 * project profile in the same workspace.
 */
export async function listLaunches(
  workspaceId: string,
  projectProfileId: string,
): Promise<LaunchRow[]> {
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("project_profile_id", projectProfileId)
    .order("created_at", { ascending: false });
  if (error) rethrow(error);
  return data ?? [];
}


export type CreateLaunchInput = {
  workspaceId: string;
  projectProfileId: string;
  token_name: string;
  ticker: string;
  chain: string;
  public_slug: string;
  timezone: string;
};

/** New launches always start DRAFT; the backend owns the initial status. */
export async function createLaunch(input: CreateLaunchInput): Promise<LaunchRow> {
  const { data, error } = await supabase
    .from("launches")
    .insert({
      workspace_id: input.workspaceId,
      project_profile_id: input.projectProfileId,
      token_name: input.token_name.trim(),
      ticker: input.ticker.trim(),
      chain: input.chain.trim(),
      public_slug: input.public_slug.trim().toLowerCase(),
      timezone: input.timezone,
    })
    .select("*")
    .single();
  if (error) rethrow(error);
  return data;
}

export type LaunchDetailsPayload = {
  token_name?: string;
  ticker?: string;
  chain?: string;
  public_slug?: string;
  launch_at?: string | null;
  launch_window_start?: string | null;
  launch_window_end?: string | null;
  timezone?: string;
  internal_notes?: string | null;
};

/** Ordinary table update. Status and contract address are never written here. */
export async function updateLaunchDetails(
  launchId: string,
  payload: LaunchDetailsPayload,
): Promise<LaunchRow> {
  const { data, error } = await supabase
    .from("launches")
    .update(payload)
    .eq("id", launchId)
    .select("*")
    .single();
  if (error) rethrow(error);
  return data;
}

export async function deleteDraftLaunch(launchId: string): Promise<void> {
  const { error } = await supabase.from("launches").delete().eq("id", launchId);
  if (error) rethrow(error);
}

export async function transitionLaunchStatus(
  launchId: string,
  targetStatus: LaunchStatus,
): Promise<LaunchRow> {
  const { data, error } = await supabase.rpc("transition_launch_status", {
    _launch_id: launchId,
    _target_status: targetStatus,
  });
  if (error) rethrow(error);
  return data as unknown as LaunchRow;
}

/**
 * C8.7B — evidence-bound official contract registration.
 *
 * The address is NOT supplied by the caller: the database derives it from the
 * selected verified deployment evidence row. `expectedContractAddress` is a
 * typed human confirmation and must match, or the call is refused. The RPC is
 * owner-only, refuses outside Contract Pending, is immutable once registered,
 * changes no lifecycle status and sends no notification.
 */
export async function registerVerifiedLaunchContract(
  launchId: string,
  deploymentId: string,
  expectedContractAddress: string,
): Promise<LaunchRow> {
  const { data, error } = await supabase.rpc("register_verified_launch_contract", {
    _launch_id: launchId,
    _deployment_id: deploymentId,
    _expected_contract_address: expectedContractAddress.trim(),
  });
  if (error) rethrow(error);
  return data as unknown as LaunchRow;
}

/**
 * C8.7C — explicit watcher notification for a registered official contract.
 *
 * Registration and the lifecycle transition never notify anyone on their own.
 * This is the only path that queues the official-contract packet, and it is
 * owner-only, workspace-isolated, evidence-bound and idempotent: the database
 * re-derives the address from the bound deployment evidence and reuses the
 * existing `launch_events` uniqueness key, so a retry reports the queued event
 * again instead of sending a second time. Delivery itself is still performed by
 * the existing Launch Watch worker, which continues to exclude subscribers who
 * stopped watching. Muting countdown reminders does not exclude a subscriber
 * from the official contract packet.

 */
export type OfficialContractNotifyResult = {
  status: "queued" | "already_notified";
  event_id: string | null;
  delivery_count: number;
};

export async function notifyLaunchWatchersOfficialContract(
  launchId: string,
): Promise<OfficialContractNotifyResult> {
  const { data, error } = await supabase.rpc("notify_launch_watchers_official_contract", {
    _launch_id: launchId,
  });
  if (error) rethrow(error);
  return data as unknown as OfficialContractNotifyResult;
}

// ---------------------------------------------------------------------------
// Phase 4 — Launch Watch (read-only surface).
//
// The deep link is public/shareable. Subscriber identities are service-role
// only and are never queried from the browser: the UI shows aggregate counts
// through `get_launch_watch_summary` and nothing else.
// ---------------------------------------------------------------------------

export const LAUNCH_WATCH_BOT_USERNAME = "PepeCartelHQBot";

export function launchWatchDeepLink(token: string): string {
  return `https://t.me/${LAUNCH_WATCH_BOT_USERNAME}?start=lw_${token}`;
}

/** Lifecycle states in which the bot accepts new Launch Watch sign-ups. */
export const LAUNCH_WATCH_OPEN_STATUSES: readonly LaunchStatus[] = [
  "WATCHLIST_OPEN",
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
  "OFFICIAL_CONTRACT_REGISTERED",
];

export function isLaunchWatchOpenStatus(status: LaunchStatus): boolean {
  return LAUNCH_WATCH_OPEN_STATUSES.includes(status);
}

export function isLaunchWatchClosedStatus(status: LaunchStatus): boolean {
  return status === "LIVE" || status === "COMPLETED";
}

export type LaunchWatchSummary = {
  active_count: number;
  total_count: number;
};

export async function getLaunchWatchSummary(launchId: string): Promise<LaunchWatchSummary> {
  const { data, error } = await supabase.rpc("get_launch_watch_summary", {
    _launch_id: launchId,
  });
  if (error) rethrow(error);
  const row = Array.isArray(data) ? data[0] : null;
  return {
    active_count: Number(row?.active_count ?? 0),
    total_count: Number(row?.total_count ?? 0),
  };
}

/**
 * Private-confirmation diagnostics for ACTIVE watchers (counts only).
 *
 * `untracked_count` covers opt-ins that predate confirmation tracking — their
 * historical delivery cannot be reconstructed and must never be reported as
 * failed. Telegram identities are never exposed to the browser.
 */
export type LaunchWatchConfirmationSummary = {
  delivered_count: number;
  failed_count: number;
  ambiguous_count: number;
  untracked_count: number;
  attempted_count: number;
};

export async function getLaunchWatchConfirmationSummary(
  launchId: string,
): Promise<LaunchWatchConfirmationSummary> {
  const { data, error } = await supabase.rpc("get_launch_watch_confirmation_summary", {
    _launch_id: launchId,
  });
  if (error) rethrow(error);
  const row = Array.isArray(data) ? data[0] : null;
  return {
    delivered_count: Number(row?.delivered_count ?? 0),
    failed_count: Number(row?.failed_count ?? 0),
    ambiguous_count: Number(row?.ambiguous_count ?? 0),
    untracked_count: Number(row?.untracked_count ?? 0),
    attempted_count: Number(row?.attempted_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Phase 5 — Notification engine (aggregate-only surface).
//
// Delivery rows, Telegram identifiers and subscriber identities are
// service-role only. The browser sees nothing but these counts.
// ---------------------------------------------------------------------------

export type LaunchNotificationSummary = {
  event_count: number;
  pending_count: number;
  sent_count: number;
  failed_count: number;
  ambiguous_count: number;
  skipped_count: number;
  reminder_enabled_watchers: number;
};

export async function getLaunchNotificationSummary(
  launchId: string,
): Promise<LaunchNotificationSummary> {
  const { data, error } = await supabase.rpc("get_launch_notification_summary", {
    _launch_id: launchId,
  });
  if (error) rethrow(error);
  const row = Array.isArray(data) ? data[0] : null;
  return {
    event_count: Number(row?.event_count ?? 0),
    pending_count: Number(row?.pending_count ?? 0),
    sent_count: Number(row?.sent_count ?? 0),
    failed_count: Number(row?.failed_count ?? 0),
    ambiguous_count: Number(row?.ambiguous_count ?? 0),
    skipped_count: Number(row?.skipped_count ?? 0),
    reminder_enabled_watchers: Number(row?.reminder_enabled_watchers ?? 0),
  };
}

// ---------------------------------------------------------------------------
// L2A — Watcher Updates (manual project updates to active watchers).
//
// All three calls go through authenticated SECURITY DEFINER RPCs. The browser
// only ever sees aggregate counts and the operator's own update text: watcher
// identities, Telegram ids and delivery rows stay service-role only.
// ---------------------------------------------------------------------------

export type LaunchWatcherUpdateStats = {
  active_watchers: number;
  updates_enabled_watchers: number;
  updates_muted_watchers: number;
};

export type LaunchWatcherUpdateRow = {
  event_id: string;
  title: string | null;
  body: string;
  created_at: string;
  pending_count: number;
  sent_count: number;
  failed_count: number;
  ambiguous_count: number;
  skipped_count: number;
};

export const WATCHER_UPDATE_TITLE_MAX = 120;
export const WATCHER_UPDATE_BODY_MAX = 2200;

/** Lifecycle states in which a manual watcher update may be sent. */
export const WATCHER_UPDATE_STATUSES: readonly LaunchStatus[] = [
  "WATCHLIST_OPEN",
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
  "OFFICIAL_CONTRACT_REGISTERED",
  "LIVE",
];

export function canSendWatcherUpdate(status: LaunchStatus): boolean {
  return WATCHER_UPDATE_STATUSES.includes(status);
}

// The generated Supabase types do not know these RPCs until the migration is
// applied. Narrow local casts keep the rest of the client fully typed.
type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function getLaunchWatcherUpdateStats(
  launchId: string,
): Promise<LaunchWatcherUpdateStats> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    "get_launch_watcher_update_stats",
    { _launch_id: launchId },
  );
  if (error) rethrow(error);
  const row = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
  return {
    active_watchers: Number(row?.["active_watchers"] ?? 0),
    updates_enabled_watchers: Number(row?.["updates_enabled_watchers"] ?? 0),
    updates_muted_watchers: Number(row?.["updates_muted_watchers"] ?? 0),
  };
}

export async function listLaunchWatcherUpdates(
  launchId: string,
  limit = 10,
): Promise<LaunchWatcherUpdateRow[]> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    "list_launch_watcher_updates",
    { _launch_id: launchId, _limit: limit },
  );
  if (error) rethrow(error);
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    event_id: String(row["event_id"] ?? ""),
    title: typeof row["title"] === "string" && row["title"].trim() ? row["title"] : null,
    body: String(row["body"] ?? ""),
    created_at: String(row["created_at"] ?? ""),
    pending_count: Number(row["pending_count"] ?? 0),
    sent_count: Number(row["sent_count"] ?? 0),
    failed_count: Number(row["failed_count"] ?? 0),
    ambiguous_count: Number(row["ambiguous_count"] ?? 0),
    skipped_count: Number(row["skipped_count"] ?? 0),
  }));
}

export type CreateWatcherUpdateInput = {
  launchId: string;
  clientRequestId: string;
  title: string | null;
  body: string;
};

/**
 * Idempotent: repeating the same clientRequestId returns the original event id
 * without creating a second event or a second delivery set.
 */
export async function createLaunchWatcherUpdate(
  input: CreateWatcherUpdateInput,
): Promise<string> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    "create_launch_watcher_update",
    {
      _launch_id: input.launchId,
      _client_request_id: input.clientRequestId,
      _title: input.title,
      _body: input.body,
    },
  );
  if (error) rethrow(error);
  return String(data ?? "");
}

// ---------------------------------------------------------------------------
// C3 — Audience dashboard (aggregate-only surface).
//
// `get_launch_audience_summary` returns counts only. No Telegram identity,
// subscription id, message body or per-recipient row ever reaches the browser.
// The six `last_*` / `never_contacted_watchers` buckets are mutually exclusive
// over ACTIVE watchers and sum to `active_watchers`; they describe each active
// watcher's most recent delivery record, never permanent reachability.
// ---------------------------------------------------------------------------

export type LaunchAudienceSummary = {
  active_watchers: number;
  total_watchers: number;
  updates_enabled_watchers: number;
  updates_muted_watchers: number;
  reminders_enabled_watchers: number;
  reminders_muted_watchers: number;
  last_sent_watchers: number;
  last_failed_watchers: number;
  last_ambiguous_watchers: number;
  last_inflight_watchers: number;
  last_skipped_watchers: number;
  never_contacted_watchers: number;
  last_delivery_at: string | null;
};

export async function getLaunchAudienceSummary(
  launchId: string,
): Promise<LaunchAudienceSummary> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    "get_launch_audience_summary",
    { _launch_id: launchId },
  );
  if (error) rethrow(error);
  const row = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
  const lastDeliveryAt = row?.["last_delivery_at"];
  return {
    active_watchers: Number(row?.["active_watchers"] ?? 0),
    total_watchers: Number(row?.["total_watchers"] ?? 0),
    updates_enabled_watchers: Number(row?.["updates_enabled_watchers"] ?? 0),
    updates_muted_watchers: Number(row?.["updates_muted_watchers"] ?? 0),
    reminders_enabled_watchers: Number(row?.["reminders_enabled_watchers"] ?? 0),
    reminders_muted_watchers: Number(row?.["reminders_muted_watchers"] ?? 0),
    last_sent_watchers: Number(row?.["last_sent_watchers"] ?? 0),
    last_failed_watchers: Number(row?.["last_failed_watchers"] ?? 0),
    last_ambiguous_watchers: Number(row?.["last_ambiguous_watchers"] ?? 0),
    last_inflight_watchers: Number(row?.["last_inflight_watchers"] ?? 0),
    last_skipped_watchers: Number(row?.["last_skipped_watchers"] ?? 0),
    never_contacted_watchers: Number(row?.["never_contacted_watchers"] ?? 0),
    last_delivery_at: typeof lastDeliveryAt === "string" ? lastDeliveryAt : null,
  };
}

// ---------------------------------------------------------------------------
// C5/C6 — Launch schedule change communications.
//
// `launch_schedule_communications` rows are detected server-side by the C5
// trigger and are read-only for the browser (member SELECT via RLS). The only
// mutations are the two operator RPCs below. Rows carry schedule metadata
// only — never watcher identities.
// ---------------------------------------------------------------------------

export type LaunchScheduleCommunication =
  Database["public"]["Tables"]["launch_schedule_communications"]["Row"];

/** Conservative maximum for the operator's optional explanation (server-enforced). */
export const SCHEDULE_NOTE_MAX = 800;

/**
 * Formats one stored schedule snapshot in ITS OWN timezone. Never claims the
 * device timezone: the zone is always printed, INCLUDING when no time or window
 * is stored, so a timezone-only change stays visible. An unusable stored
 * timezone degrades to a clearly labelled UTC rendering rather than inventing
 * a time. Mirrors `public.format_launch_schedule_snapshot`.
 */
export function formatScheduleSnapshot(
  at: string | null,
  windowStart: string | null,
  windowEnd: string | null,
  timezone: string | null,
): string {
  const zone = safeTimeZone(timezone);
  const one = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(date);
    } catch {
      return null;
    }
  };
  const label = (text: string) => `${text} (${zone})`;
  const notSet = label("Not set");

  if (at) {
    const formatted = one(at);
    return formatted ? label(formatted) : notSet;
  }
  if (windowStart && windowEnd) {
    const a = one(windowStart);
    const b = one(windowEnd);
    return a && b ? label(`Between ${a} and ${b}`) : notSet;
  }
  if (windowStart) {
    const a = one(windowStart);
    return a ? label(`From ${a}`) : notSet;
  }
  if (windowEnd) {
    const b = one(windowEnd);
    return b ? label(`By ${b}`) : notSet;
  }
  return notSet;
}


function safeTimeZone(timezone: string | null): string {
  const candidate = (timezone ?? "").trim();
  if (!candidate) return "UTC";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

export function scheduleSnapshotPair(row: LaunchScheduleCommunication): {
  previous: string;
  current: string;
} {
  return {
    previous: formatScheduleSnapshot(
      row.baseline_launch_at,
      row.baseline_window_start,
      row.baseline_window_end,
      row.baseline_timezone,
    ),
    current: formatScheduleSnapshot(
      row.current_launch_at,
      row.current_window_start,
      row.current_window_end,
      row.current_timezone,
    ),
  };
}

/** The single unresolved schedule-change decision for a launch, if any. */
export async function getPendingScheduleCommunication(
  launchId: string,
): Promise<LaunchScheduleCommunication | null> {
  const { data, error } = await supabase
    .from("launch_schedule_communications")
    .select("*")
    .eq("launch_id", launchId)
    .eq("status", "PENDING")
    .maybeSingle();
  if (error) rethrow(error);
  return data ?? null;
}

/** Every unresolved decision in the workspace (RLS-scoped). */
export async function listPendingScheduleCommunications(
  workspaceId: string,
): Promise<LaunchScheduleCommunication[]> {
  const { data, error } = await supabase
    .from("launch_schedule_communications")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "PENDING")
    .order("detected_at", { ascending: false });
  if (error) rethrow(error);
  return data ?? [];
}

/**
 * The exact reviewed decision. `expected*` is the frozen snapshot the operator
 * actually saw; the server refuses the decision if the PENDING row moved on,
 * so reviewed == submitted is enforced server-side, not by the browser.
 */
export type ExpectedScheduleSnapshot = {
  expectedChangeCount: number;
  expectedCurrentLaunchAt: string | null;
  expectedCurrentWindowStart: string | null;
  expectedCurrentWindowEnd: string | null;
  expectedCurrentTimezone: string;
};

export type SendScheduleCommunicationInput = ExpectedScheduleSnapshot & {
  communicationId: string;
  clientRequestId: string;
  note: string | null;
};

export type DismissScheduleCommunicationInput = ExpectedScheduleSnapshot & {
  communicationId: string;
};

/** Captures the expected snapshot from a freshly read PENDING row. */
export function expectedScheduleSnapshot(
  row: LaunchScheduleCommunication,
): ExpectedScheduleSnapshot {
  return {
    expectedChangeCount: row.change_count,
    expectedCurrentLaunchAt: row.current_launch_at,
    expectedCurrentWindowStart: row.current_window_start,
    expectedCurrentWindowEnd: row.current_window_end,
    expectedCurrentTimezone: row.current_timezone,
  };
}

/**
 * Atomic + idempotent server-side. The factual Previous/New schedule text is
 * composed by the RPC; `note` is the operator's optional explanation only.
 * Repeating the same clientRequestId returns the original event id. A PENDING
 * row that no longer matches the reviewed snapshot is rejected.
 */
export async function sendLaunchScheduleCommunication(
  input: SendScheduleCommunicationInput,
): Promise<string> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    "send_launch_schedule_communication",
    {
      _id: input.communicationId,
      _client_request_id: input.clientRequestId,
      _expected_change_count: input.expectedChangeCount,
      _expected_current_launch_at: input.expectedCurrentLaunchAt,
      _expected_current_window_start: input.expectedCurrentWindowStart,
      _expected_current_window_end: input.expectedCurrentWindowEnd,
      _expected_current_timezone: input.expectedCurrentTimezone,
      _note: input.note,
    },
  );
  if (error) rethrow(error);
  return String(data ?? "");
}

/** Conditional dismiss: rejected if the PENDING row changed after review. */
export async function dismissLaunchScheduleCommunication(
  input: DismissScheduleCommunicationInput,
): Promise<void> {
  const { error } = await (supabase as unknown as RpcClient).rpc(
    "dismiss_launch_schedule_communication",
    {
      _id: input.communicationId,
      _expected_change_count: input.expectedChangeCount,
      _expected_current_launch_at: input.expectedCurrentLaunchAt,
      _expected_current_window_start: input.expectedCurrentWindowStart,
      _expected_current_window_end: input.expectedCurrentWindowEnd,
      _expected_current_timezone: input.expectedCurrentTimezone,
    },
  );
  if (error) rethrow(error);
}

export const scheduleCommunicationQueryKey = (launchId: string | null) =>
  ["launch-schedule-communication", launchId] as const;

export const workspaceScheduleCommunicationsQueryKey = (workspaceId: string | null) =>
  ["workspace-schedule-communications", workspaceId] as const;


// ---------------------------------------------------------------------------
// Launch management permission (UI hint only).
//
// Mirrors the authoritative RLS/RPC rule: workspace owner/admin may manage
// launches, members read only. This is a presentation guard, never security.
// ---------------------------------------------------------------------------

export type LaunchAccess = {
  role: string | null;
  canManage: boolean;
  /**
   * True only for the workspace owner record the database itself checks
   * (`workspaces.owner_id`). Admin membership does NOT satisfy this.
   */
  isWorkspaceOwner: boolean;
};

export async function getLaunchAccess(
  workspaceId: string,
  workspaceOwnerId: string | null,
): Promise<LaunchAccess> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) rethrow(userError);
  const userId = userData.user?.id ?? null;
  if (!userId) return { role: null, canManage: false, isWorkspaceOwner: false };

  const isOwner = !!workspaceOwnerId && workspaceOwnerId === userId;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) rethrow(error);

  const role = (data?.role as string | null) ?? (isOwner ? "owner" : null);
  const canManage = isOwner || role === "owner" || role === "admin";
  return { role, canManage, isWorkspaceOwner: isOwner };
}

// ---------------------------------------------------------------------------
// C8.7E — official contract correction (client contract only).
//
// The append-only ledger `launch_contract_registration_events` records the one
// ACCEPTED registration decision and every later CORRECTED decision. Rows are
// read-only for the browser (workspace-member SELECT via RLS); every write is
// performed by the owner-only, evidence-bound SECURITY DEFINER RPCs below.
// ---------------------------------------------------------------------------

export type LaunchContractRegistrationEvent =
  Database["public"]["Tables"]["launch_contract_registration_events"]["Row"];

/**
 * Chronological, immutable registration chain for one launch (oldest first).
 * RLS is authoritative: only rows in workspaces the signed-in user belongs to
 * are ever returned, and no other workspace is queried.
 */
export async function listLaunchContractRegistrationEvents(
  launchId: string,
): Promise<LaunchContractRegistrationEvent[]> {
  const { data, error } = await supabase
    .from("launch_contract_registration_events")
    .select("*")
    .eq("launch_id", launchId)
    .order("created_at", { ascending: true });
  if (error) rethrow(error);
  return data ?? [];
}

export const launchContractRegistrationEventsQueryKey = (launchId: string | null) =>
  ["launch-contract-registration-events", launchId] as const;

/** Mirrors the authoritative DB check on `correction_reason` (1–1000 chars). */
export const CONTRACT_CORRECTION_REASON_MAX = 1000;

/** Both shapes returned by `correct_verified_launch_contract`. */
export type OfficialContractCorrectionResult = {
  status: "unchanged" | "corrected";
  launch_id: string;
  registration_event_id: string;
  superseded_event_id?: string | null;
  previous_contract_address?: string | null;
  contract_address: string;
  deployment_id: string;
  created_at?: string | null;
};

/**
 * C8.7E — corrects an already-registered official contract.
 *
 * Owner-only and evidence-bound server-side: the new address is derived by the
 * database from the selected verified deployment evidence, never supplied by
 * the browser, and `expectedContractAddress` is only a typed human confirmation
 * that must match. The lifecycle status and the original registration anchor
 * (`contract_registered_at` / `contract_registered_by`) stay unchanged, and a
 * correction sends nothing automatically — notifying subscribers and posting to
 * communities are separate explicit actions.
 */
export async function correctVerifiedLaunchContract(input: {
  launchId: string;
  deploymentId: string;
  expectedContractAddress: string;
  reason: string;
}): Promise<OfficialContractCorrectionResult> {
  const { data, error } = await supabase.rpc("correct_verified_launch_contract", {
    _launch_id: input.launchId,
    _deployment_id: input.deploymentId,
    _expected_contract_address: input.expectedContractAddress.trim(),
    _reason: input.reason.trim(),
  });
  if (error) rethrow(error);
  return data as unknown as OfficialContractCorrectionResult;
}

export type OfficialContractCorrectionNotifyResult = {
  status: "queued" | "already_notified";
  event_id: string;
  registration_event_id: string;
  delivery_count: number;
};

/**
 * C8.7E — explicit watcher notification for a contract CORRECTION.
 *
 * Distinct from the C8.7C original-registration notifier; there is no fallback
 * between them. A correction never notifies anyone on its own. The database
 * refuses a stale or superseded correction event, refuses one that no longer
 * matches the current registration state, and is idempotent per correction
 * event, so a retry reports the queued event again instead of sending twice.
 */
export async function notifyLaunchWatchersOfficialContractCorrection(
  launchId: string,
  registrationEventId: string,
): Promise<OfficialContractCorrectionNotifyResult> {
  const { data, error } = await supabase.rpc(
    "notify_launch_watchers_official_contract_correction",
    { _launch_id: launchId, _registration_event_id: registrationEventId },
  );
  if (error) rethrow(error);
  return data as unknown as OfficialContractCorrectionNotifyResult;
}
