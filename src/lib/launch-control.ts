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
    "The project has registered its official contract address. Active watchers receive the official-contract Verified Launch Packet.",
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

export async function listLaunches(workspaceId: string): Promise<LaunchRow[]> {
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("workspace_id", workspaceId)
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

export async function setLaunchContractAddress(
  launchId: string,
  contractAddress: string,
): Promise<LaunchRow> {
  const { data, error } = await supabase.rpc("set_launch_contract_address", {
    _launch_id: launchId,
    _contract_address: contractAddress.trim(),
  });
  if (error) rethrow(error);
  return data as unknown as LaunchRow;
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
    active_watchers: Number(row?.active_watchers ?? 0),
    updates_enabled_watchers: Number(row?.updates_enabled_watchers ?? 0),
    updates_muted_watchers: Number(row?.updates_muted_watchers ?? 0),
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
    event_id: String(row.event_id ?? ""),
    title: typeof row.title === "string" && row.title.trim() ? row.title : null,
    body: String(row.body ?? ""),
    created_at: String(row.created_at ?? ""),
    pending_count: Number(row.pending_count ?? 0),
    sent_count: Number(row.sent_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    ambiguous_count: Number(row.ambiguous_count ?? 0),
    skipped_count: Number(row.skipped_count ?? 0),
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
// Launch management permission (UI hint only).
//
// Mirrors the authoritative RLS/RPC rule: workspace owner/admin may manage
// launches, members read only. This is a presentation guard, never security.
// ---------------------------------------------------------------------------

export type LaunchAccess = {
  role: string | null;
  canManage: boolean;
};

export async function getLaunchAccess(
  workspaceId: string,
  workspaceOwnerId: string | null,
): Promise<LaunchAccess> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) rethrow(userError);
  const userId = userData.user?.id ?? null;
  if (!userId) return { role: null, canManage: false };

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
  return { role, canManage };
}
