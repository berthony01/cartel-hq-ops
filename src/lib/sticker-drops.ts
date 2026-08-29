import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the authenticated Edge Function `sticker-drop-config`.
 *
 * The scheduler itself is entirely server-side (cron every 5 minutes). This
 * module ONLY reads configuration state and forwards explicit user mutations.
 * It never posts to Telegram, never runs timers and never writes the
 * `sticker_drop_*` tables directly from the browser.
 */

export type DropRole = "owner" | "admin" | "member" | (string & {});

export type DropWorkspaceControl = {
  workspace_id?: string;
  kill_switch: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type DropGroup = {
  id: string;
  workspace_id?: string;
  telegram_chat_id?: number;
  title: string;
  username?: string | null;
  chat_type?: string | null;
  bot_is_admin?: boolean | null;
  can_set_sticker_set?: boolean | null;
  verified_at?: string | null;
  connected_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type DropPack = {
  id: string;
  title: string;
  status?: string | null;
  theme?: string | null;
  pack_size?: number | null;
  telegram_set_name?: string | null;
  telegram_set_url?: string | null;
  telegram_published_at?: string | null;
};

export type DropSticker = {
  id: string;
  pack_id: string;
  label: string;
  status?: string | null;
  emoji_list?: string[] | null;
  sort_order?: number | null;
  telegram_file_id?: string | null;
};

export type DropSchedule = {
  id: string;
  workspace_id?: string;
  group_connection_id: string;
  pack_id: string;
  enabled: boolean;
  interval_minutes: number;
  timezone: string;
  active_start: string;
  active_end: string;
  daily_cap: number;
  silent: boolean;
  no_immediate_repeat: boolean;
  approved_only?: boolean;
  selected_sticker_ids: string[];
  consecutive_failures?: number;
  paused_reason?: string | null;
  next_run_at?: string | null;
  last_sent_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DropEvent = {
  id: string;
  schedule_id?: string;
  group_connection_id: string;
  pack_id?: string;
  sticker_id?: string | null;
  status: string;
  error_message?: string | null;
  local_date?: string | null;
  telegram_message_id?: number | null;
  created_at: string;
};

export type DropStatus = {
  canManage: boolean;
  role: DropRole | null;
  control: DropWorkspaceControl | null;
  groups: DropGroup[];
  packs: DropPack[];
  stickers: DropSticker[];
  schedules: DropSchedule[];
  events: DropEvent[];
};

/** Server-enforced bounds. Mirrored here only for input validation. */
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 720;
export const MIN_DAILY_CAP = 1;
export const MAX_DAILY_CAP = 24;
export const INTERVAL_PRESETS = [15, 30, 60, 120] as const;

export const DEFAULT_SCHEDULE_FORM = {
  intervalMinutes: 60,
  activeStart: "08:00",
  activeEnd: "23:00",
  dailyCap: 8,
  silent: true,
  noImmediateRepeat: true,
} as const;

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-drop-config", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The sticker drop service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string; message?: string }) | null;
  if (!payload) throw new Error("Empty response from the sticker drop service.");
  if (payload.error) throw new Error(payload.message || payload.error);
  return payload as T;
}

/** Turns any thrown error into a short, user-safe line. */
export function dropErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return "Sticker drop request failed. Try again in a moment.";
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}

/** Full read-only configuration + recent activity for the workspace. */
export async function fetchDropStatus(workspaceId: string): Promise<DropStatus> {
  const payload = await invoke<Partial<DropStatus>>({ action: "status", workspaceId });
  return {
    canManage: payload.canManage === true,
    role: payload.role ?? null,
    control: payload.control ?? null,
    groups: payload.groups ?? [],
    packs: payload.packs ?? [],
    stickers: payload.stickers ?? [],
    schedules: payload.schedules ?? [],
    events: payload.events ?? [],
  };
}

export type SaveSchedulePayload = {
  scheduleId?: string;
  groupConnectionId: string;
  packId: string;
  intervalMinutes: number;
  timezone: string;
  activeStart: string;
  activeEnd: string;
  dailyCap: number;
  silent: boolean;
  noImmediateRepeat: boolean;
  selectedStickerIds: string[];
};

/**
 * Creates or updates a schedule. A newly created schedule always comes back
 * DISABLED — enabling is a separate, explicit user action.
 */
export function saveDropSchedule(
  workspaceId: string,
  payload: SaveSchedulePayload,
): Promise<{ schedule?: DropSchedule }> {
  return invoke<{ schedule?: DropSchedule }>({
    action: "save_schedule",
    workspaceId,
    ...(payload.scheduleId ? { scheduleId: payload.scheduleId } : {}),
    groupConnectionId: payload.groupConnectionId,
    packId: payload.packId,
    intervalMinutes: payload.intervalMinutes,
    timezone: payload.timezone,
    activeStart: payload.activeStart,
    activeEnd: payload.activeEnd,
    dailyCap: payload.dailyCap,
    silent: payload.silent,
    noImmediateRepeat: payload.noImmediateRepeat,
    selectedStickerIds: payload.selectedStickerIds,
  });
}

export function setDropScheduleEnabled(
  workspaceId: string,
  scheduleId: string,
  enabled: boolean,
): Promise<{ schedule?: DropSchedule }> {
  return invoke<{ schedule?: DropSchedule }>({
    action: "set_schedule_enabled",
    workspaceId,
    scheduleId,
    enabled,
  });
}

export function deleteDropSchedule(
  workspaceId: string,
  scheduleId: string,
): Promise<{ deleted?: boolean }> {
  return invoke<{ deleted?: boolean }>({
    action: "delete_schedule",
    workspaceId,
    scheduleId,
  });
}

export function setDropKillSwitch(
  workspaceId: string,
  killSwitch: boolean,
): Promise<{ control?: DropWorkspaceControl }> {
  return invoke<{ control?: DropWorkspaceControl }>({
    action: "set_kill_switch",
    workspaceId,
    killSwitch,
  });
}

/* ------------------------------------------------------------------ */
/* Presentation-only derivations over the server payload               */
/* ------------------------------------------------------------------ */

export type ScheduleState = "active" | "paused" | "auto_paused" | "killed" | "unconfigured";

export function scheduleState(
  schedule: DropSchedule | undefined,
  killSwitch: boolean,
): ScheduleState {
  if (!schedule) return "unconfigured";
  if (killSwitch) return "killed";
  if (schedule.enabled) return "active";
  if (schedule.paused_reason) return "auto_paused";
  return "paused";
}

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, string> = {
  active: "Active",
  paused: "Paused",
  auto_paused: "Auto-paused",
  killed: "Emergency pause",
  unconfigured: "Not configured",
};

/** Sends recorded today, using the viewer's local calendar day. */
export function sentToday(events: DropEvent[]): number {
  const now = new Date();
  return events.filter((event) => {
    if (event.status !== "sent") return false;
    const at = new Date(event.created_at);
    if (Number.isNaN(at.getTime())) return false;
    return (
      at.getFullYear() === now.getFullYear() &&
      at.getMonth() === now.getMonth() &&
      at.getDate() === now.getDate()
    );
  }).length;
}

/** Earliest `next_run_at` across enabled schedules, ignoring stale past values. */
export function nextRunAt(schedules: DropSchedule[], killSwitch: boolean): Date | null {
  if (killSwitch) return null;
  const times = schedules
    .filter((s) => s.enabled && s.next_run_at)
    .map((s) => new Date(s.next_run_at as string))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (times.length === 0) return null;
  return times.reduce((min, d) => (d < min ? d : min));
}

export function formatCadence(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  return `every ${minutes} min`;
}

export function formatClock(date: Date): string {
  try {
    return date.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date.toISOString();
  }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
