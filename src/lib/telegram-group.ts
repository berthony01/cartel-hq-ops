import { supabase } from "@/integrations/supabase/client";
import type { TelegramBot } from "@/lib/telegram-stickers";
import type { OfficialStickerReason } from "@/lib/telegram-link";

/**
 * Thin client for the authenticated Edge Function `telegram-group`.
 * The bot token stays server-side; the browser never calls api.telegram.org
 * and never writes `telegram_group_connections` (the webhook is authoritative).
 */

export type TelegramGroupConnectionMetadata = {
  bot_can_change_info?: boolean | null;
  can_set_sticker_set?: boolean | null;
  member_count?: number | null;
  official_group_sticker_min_members?: number | null;
  official_group_sticker_eligible?: boolean | null;
  official_group_sticker_reason?: OfficialStickerReason;
  checked_at?: string | null;
  /** Community lifecycle: set when @PepeCartelHQBot was removed from the chat. */
  last_member_status?: string | null;
  bot_removed_at?: string | null;
  bot_removed_reason?: string | null;
  [key: string]: unknown;
};

export type TelegramGroupConnection = {
  id: string;
  workspace_id: string;
  telegram_chat_id: number;
  title: string;
  username: string | null;
  chat_type: string;
  bot_is_admin: boolean;
  can_set_sticker_set: boolean;
  connected_at: string;
  verified_at: string | null;
  /** Stored verification details written by the webhook / group verification. */
  metadata?: TelegramGroupConnectionMetadata | null;
};




export type TelegramGroupStatusResult = {
  bot?: TelegramBot;
  group?: TelegramGroupConnection | null;
  /** Basic operational readiness: supergroup + bot admin + Change Group Info. */
  ready?: boolean;
  botIsAdmin?: boolean;
  botCanChangeInfo?: boolean;
  canSetStickerSet?: boolean;
  /** `group` (basic group) and `supergroup` are both valid CARTEL HQ targets. */
  chatType?: "group" | "supergroup" | (string & {});
  memberCount?: number | null;
  minMembers?: number;
  officialStickerEligible?: boolean;
  officialStickerReason?: OfficialStickerReason;
  currentStickerSetName?: string | null;
  /** Recoverable lifecycle state: the bot is no longer in the community. */
  reconnectRequired?: boolean;
  connectionState?: "bot_removed" | (string & {});
  memberStatus?: string;
  message?: string;
  technical?: string;

};

export type TelegramAssignPackResult = {
  assigned: boolean;
  /** Recoverable: the bot was removed from the community. */
  reconnectRequired?: boolean;
  connectionState?: string;
  /** Server posted the pack link into the group instead of assigning it. */
  announced?: boolean;
  reason?:
    | "GROUP_STICKER_MIN_MEMBERS"
    | "GROUP_STICKER_REQUIRES_SUPERGROUP"
    | "GROUP_STICKER_NOT_AVAILABLE"
    | string;
  memberCount?: number | null;
  minMembers?: number;
  group?: TelegramGroupConnection | null;
  setName?: string;
  setUrl?: string;
  message?: string;
  technical?: string;
};

export type TelegramGroupTestResult = {
  sent: boolean;
  reconnectRequired?: boolean;
  connectionState?: string;
  message?: string;
  technical?: string;
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

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("telegram-group", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The Telegram group service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Empty response from the Telegram group service.");
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Live verification + current group sticker-set state. Read-only. */
export function fetchTelegramGroupStatus(params: {
  workspaceId: string;
  groupConnectionId: string;
}): Promise<TelegramGroupStatusResult> {
  return invoke<TelegramGroupStatusResult>({
    action: "status",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
  });
}

/** Assigns an already-published pack as the supergroup's group sticker set. */
export function assignPackToGroup(params: {
  workspaceId: string;
  packId: string;
  groupConnectionId: string;
}): Promise<TelegramAssignPackResult> {
  return invoke<TelegramAssignPackResult>({
    action: "assign_pack",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionId: params.groupConnectionId,
  });
}

/** Sends one published sticker as a native sticker into the connected group. */
export function sendGroupTestSticker(params: {
  workspaceId: string;
  packId: string;
  groupConnectionId: string;
  stickerId?: string;
}): Promise<TelegramGroupTestResult> {
  return invoke<TelegramGroupTestResult>({
    action: "send_group_test",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionId: params.groupConnectionId,
    ...(params.stickerId ? { stickerId: params.stickerId } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Multi-group distribution (telegram-group v4)                        */
/* ------------------------------------------------------------------ */

export type TelegramDistributionStatus = "assigned" | "announced" | "failed";

export type TelegramDistributeResultRow = {
  groupConnectionId: string;
  title: string;
  chatType?: string;
  status: TelegramDistributionStatus;
  assigned: boolean;
  announced: boolean;
  reason?: string;
  memberCount?: number | null;
  minMembers?: number;
  message?: string;
};

export type TelegramDistributePackResult = {
  status: "complete" | "partial" | "failed";
  total: number;
  assigned: number;
  announced: number;
  failed: number;
  results: TelegramDistributeResultRow[];
  setName?: string;
  setUrl?: string;
};

/** Durable per-group distribution row persisted server-side. */
export type TelegramPackGroupTarget = {
  id: string;
  workspace_id: string;
  pack_id: string;
  group_connection_id: string;
  status: string;
  last_error: string | null;
  announced_at: string | null;
  assigned_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Max group IDs accepted by the server in one distribute call. */
export const MAX_DISTRIBUTION_TARGETS = 50;

/**
 * Distributes an already-published pack to many connected groups in one call.
 * The Telegram sticker set itself is never re-created here.
 */
export function distributePackToGroups(params: {
  workspaceId: string;
  packId: string;
  groupConnectionIds: string[];
}): Promise<TelegramDistributePackResult> {
  const ids = Array.from(new Set(params.groupConnectionIds));
  if (ids.length > MAX_DISTRIBUTION_TARGETS) {
    throw new Error(
      `You selected ${ids.length} groups. You can distribute to up to ${MAX_DISTRIBUTION_TARGETS} groups in one run — deselect some and run the distribution again for the rest.`,
    );
  }
  return invoke<TelegramDistributePackResult>({
    action: "distribute_pack",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionIds: ids,
  });
}

/** Reads the persisted per-group distribution state for a pack. */
export function fetchPackGroupDistribution(params: {
  workspaceId: string;
  packId: string;
}): Promise<{ targets: TelegramPackGroupTarget[] }> {
  return invoke<{ targets: TelegramPackGroupTarget[] }>({
    action: "distribution_status",
    workspaceId: params.workspaceId,
    packId: params.packId,
  });
}

/* ------------------------------------------------------------------ */
/* Community controls — welcome & onboarding (telegram-group v5)       */
/* ------------------------------------------------------------------ */

export const DEFAULT_WELCOME_MESSAGE =
  "\u{1F44B} Welcome {first_name} to {community_name}!\n\nPlease check the pinned messages and official links before getting started.";

export const WELCOME_MESSAGE_MAX = 3500;
export const WELCOME_AUTO_DELETE_MIN = 10;
export const WELCOME_AUTO_DELETE_MAX = 120;

/**
 * Phase 5.2 — the Launch Watch card is a SEPARATE Telegram message with its own
 * lifetime. Allowed values mirror the database constraint exactly.
 */
export const LAUNCH_WATCH_CTA_LIFETIMES = [300, 600, 900, 1800, 3600] as const;
export const LAUNCH_WATCH_CTA_LIFETIME_DEFAULT = 900;

export function formatLaunchWatchCtaLifetime(seconds: number): string {
  return `${Math.round(seconds / 60)} minutes`;
}


/** Result code written by the webhook after a real member join. */
export type WelcomeJoinResult =
  | "sent"
  | "send_failed"
  | "skipped_disabled"
  | "skipped_no_message"
  | (string & {});

/** Diagnostics the webhook records on `telegram_community_settings.metadata`. */
export type TelegramCommunitySettingsMetadata = {
  last_join_detected_at?: string | null;
  last_welcome_result?: WelcomeJoinResult | null;
  last_welcome_sent_at?: string | null;
  last_welcome_message_id?: number | null;
  [key: string]: unknown;
};

/** Persisted per-community welcome configuration (`telegram_community_settings`). */
export type TelegramCommunitySettings = {
  group_connection_id: string;
  workspace_id: string;
  welcome_enabled: boolean;
  welcome_message: string;
  mention_member: boolean;
  auto_delete_enabled: boolean;
  auto_delete_seconds: number;
  /** Phase 5.1 — optional public Launch Watch CTA attached to the welcome. */
  launch_watch_cta_enabled?: boolean;
  launch_watch_launch_id?: string | null;
  launch_watch_show_website?: boolean;
  launch_watch_show_telegram?: boolean;
  launch_watch_show_x?: boolean;
  /** Present only when the server includes it; diagnostics are read-only here. */
  metadata?: TelegramCommunitySettingsMetadata | null;
};

/**
 * One server-validated Launch Watch CTA option.
 * The private `launch_watch_token` is never exposed to the browser.
 */
export type LaunchWatchCtaOption = {
  launchId: string;
  projectName: string;
  tokenName: string;
  ticker: string;
  chain: string;
  status: string;
  /** Official links available on the Project Profile for optional buttons. */
  hasWebsite?: boolean;
  hasTelegram?: boolean;
  hasX?: boolean;
};

export type TelegramCommunitySettingsResult = {
  settings: TelegramCommunitySettings;
  /** Only workspace owners/admins may mutate welcome settings. */
  canManage: boolean;
  /** Server-validated eligible launches for the current workspace. */
  eligibleLaunches?: LaunchWatchCtaOption[];
};

export type TelegramWelcomeSettingsInput = {
  welcomeEnabled: boolean;
  welcomeMessage: string;
  mentionMember: boolean;
  autoDeleteEnabled: boolean;
  autoDeleteSeconds: number;
  launchWatchCtaEnabled: boolean;
  launchWatchLaunchId: string | null;
  launchWatchShowWebsite: boolean;
  launchWatchShowTelegram: boolean;
  launchWatchShowX: boolean;
};

export type TelegramWelcomeTestResult = {
  sent: boolean;
  reconnectRequired?: boolean;
  connectionState?: string;
  messageId?: number | null;
  autoDeleteSeconds?: number | null;
  groupTitle?: string;
  /** True when the test welcome carried the Launch Watch CTA buttons. */
  launchWatchCtaIncluded?: boolean;
};


/** Reads welcome settings for one connected community. Lazy — call on open. */
export function fetchCommunityWelcomeSettings(params: {
  workspaceId: string;
  groupConnectionId: string;
}): Promise<TelegramCommunitySettingsResult> {
  return invoke<TelegramCommunitySettingsResult>({
    action: "welcome_settings",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
  });
}

/** Saves welcome settings. Owner/admin only — enforced server-side. */
export function saveCommunityWelcomeSettings(params: {
  workspaceId: string;
  groupConnectionId: string;
  settings: TelegramWelcomeSettingsInput;
}): Promise<TelegramCommunitySettingsResult & { saved: boolean }> {
  return invoke<TelegramCommunitySettingsResult & { saved: boolean }>({
    action: "save_welcome_settings",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
    settings: params.settings,
  });
}

/** Sends a real welcome preview into the community using the saved settings. */
export function sendCommunityWelcomeTest(params: {
  workspaceId: string;
  groupConnectionId: string;
}): Promise<TelegramWelcomeTestResult> {
  return invoke<TelegramWelcomeTestResult>({
    action: "send_welcome_test",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
  });
}
