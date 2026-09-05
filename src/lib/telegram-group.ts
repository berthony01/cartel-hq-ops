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
  /** Phase 5.1/5.2 — optional Launch Watch card posted separately after the welcome. */
  launch_watch_cta_enabled?: boolean;
  launch_watch_launch_id?: string | null;
  launch_watch_show_website?: boolean;
  launch_watch_show_telegram?: boolean;
  launch_watch_show_x?: boolean;
  /** Phase 5.2 — independent lifetime for the separate Launch Watch card. */
  launch_watch_cta_auto_delete_seconds?: number;

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
  /** Must be exactly one of LAUNCH_WATCH_CTA_LIFETIMES. */
  launchWatchCtaAutoDeleteSeconds: number;
};

export type TelegramWelcomeTestResult = {
  sent: boolean;
  reconnectRequired?: boolean;
  connectionState?: string;
  messageId?: number | null;
  autoDeleteSeconds?: number | null;
  groupTitle?: string;
  /** True when a separate Launch Watch card was posted after the welcome. */
  launchWatchCtaIncluded?: boolean;
  launchWatchCtaMessageId?: number | null;
  launchWatchCtaAutoDeleteSeconds?: number | null;
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

/* ------------------------------------------------------------------ */
/* Community announcements (C7 — telegram-group)                       */
/* ------------------------------------------------------------------ */

/** Server-enforced plain-text announcement limit. */
export const GROUP_ANNOUNCEMENT_MAX = 3500;

/**
 * Outcome vocabulary, never collapsed:
 * - `SENT` Telegram confirmed a message id.
 * - `FAILED` Telegram definitively rejected it — nothing was delivered.
 * - `AMBIGUOUS` transport uncertainty — delivery unknown, never auto-resent.
 */
export type GroupAnnouncementStatus = "SENT" | "FAILED" | "AMBIGUOUS";

export type GroupAnnouncementResult = {
  status?: GroupAnnouncementStatus;
  /** True when this exact request id was already recorded — nothing was re-sent. */
  duplicate?: boolean;
  announcementId?: string;
  groupConnectionId?: string;
  groupTitle?: string;
  messageId?: number | null;
  sentAt?: string | null;
  /** C7.2 — how the broadcast was delivered, and the exact delivered text. */
  deliveryKind?: "TEXT" | "BRANDED_PHOTO" | (string & {});
  deliveredText?: string;
  /** Immutable Launch Watch CTA snapshot recorded for this exact broadcast. */
  ctaEnabled?: boolean;
  ctaLaunchId?: string | null;
  ctaProjectName?: string | null;
  ctaTokenName?: string | null;
  ctaTicker?: string | null;
  ctaChain?: string | null;
  ctaLaunchStatus?: string | null;
  /** Recoverable: the bot was removed from the community. */
  reconnectRequired?: boolean;
  connectionState?: string;
  message?: string;
  technical?: string | null;
};

/* ------------------------------------------------------------------ */
/* C7.2 — Official Broadcast branding                                  */
/* ------------------------------------------------------------------ */

/**
 * Telegram's hard photo-caption limit, applied to the FULL final caption
 * including the branding header and footer. Enforced again server-side.
 */
export const GROUP_BRANDED_CAPTION_MAX = 1024;
export const BROADCAST_BRANDING_TEMPLATE_VERSION = "telegram_photo_v1";

/**
 * Locked `telegram_photo_v1` caption assembly, semantically byte-identical to
 * the server copy in the `telegram-group` function. Trim only: the saved ticker
 * is used exactly as stored — no `$` is added and none is removed.
 *
 * Preview only — the server rebuilds the caption from the saved Project Profile
 * and posts only its own result.
 */
export function buildBrandedBroadcastCaption(
  projectName: string,
  ticker: string | null,
  message: string,
): string {
  const name = projectName.trim();
  const tick = (ticker ?? "").trim();
  return `${name}${tick ? " · " + tick : ""}\nOFFICIAL PROJECT UPDATE\n\n${message.trim()}\n\nOfficial communication through @PepeCartelHQBot`;
}

/** The Project Profile identity the operator actually reviewed before posting. */
export type ReviewedBroadcastBranding = {
  projectName: string;
  ticker: string;
  logoAssetId: string;
  templateVersion: typeof BROADCAST_BRANDING_TEMPLATE_VERSION;
};

/**
 * Posts ONE official broadcast to ONE connected community.
 * `clientRequestId` must stay stable for one intended broadcast: the server
 * ledger is keyed on `(workspace, clientRequestId)` and never posts it twice.
 *
 * When `branding` is supplied the server re-reads the saved Project Profile and
 * refuses to post if it no longer matches the reviewed identity.
 */
export function sendGroupAnnouncement(params: {
  workspaceId: string;
  groupConnectionId: string;
  message: string;
  clientRequestId: string;
  branding?: ReviewedBroadcastBranding | null;
  /** Optional Launch Watch inline button. The server resolves the deep link. */
  ctaLaunchId?: string | null;
}): Promise<GroupAnnouncementResult> {
  return invoke<GroupAnnouncementResult>({
    action: "send_group_announcement",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
    message: params.message,
    clientRequestId: params.clientRequestId,
    ...(params.ctaLaunchId
      ? { ctaEnabled: true, ctaLaunchId: params.ctaLaunchId }
      : { ctaEnabled: false }),
    ...(params.branding
      ? {
          brandingEnabled: true,
          reviewedProjectName: params.branding.projectName,
          reviewedTicker: params.branding.ticker,
          reviewedLogoAssetId: params.branding.logoAssetId,
          reviewedTemplateVersion: params.branding.templateVersion,
        }
      : { brandingEnabled: false }),
  });
}

/**
 * Server-validated eligible launches for the Official Community Broadcast CTA.
 * Token-free by construction — the browser never receives `launch_watch_token`.
 */
export function fetchBroadcastLaunchOptions(params: {
  workspaceId: string;
  groupConnectionId: string;
}): Promise<{ options: LaunchWatchCtaOption[] }> {
  return invoke<{ options: LaunchWatchCtaOption[] }>({
    action: "broadcast_launch_options",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
  });
}


/* ------------------------------------------------------------------ */
/* C8.7D — Official contract group broadcast                           */
/* ------------------------------------------------------------------ */

/**
 * Outcome of an explicit OFFICIAL CONTRACT community broadcast.
 * The address and the posted packet are always derived server-side from the
 * evidence-bound registration — the browser never supplies either.
 */
export type OfficialContractBroadcastResult = {
  status?: GroupAnnouncementStatus;
  /** True when this exact request id was already recorded — nothing was re-sent. */
  duplicate?: boolean;
  announcementId?: string;
  announcementKind?: string;
  launchId?: string;
  groupConnectionId?: string;
  groupTitle?: string;
  messageId?: number | null;
  sentAt?: string | null;
  deliveryKind?: "TEXT" | (string & {});
  /** Exactly what the server posted. Never editable in the browser. */
  deliveredText?: string;
  contractAddress?: string;
  /** Recoverable: the bot was removed from the community. */
  reconnectRequired?: boolean;
  connectionState?: string;
  message?: string;
  technical?: string | null;
};

/**
 * C8.7D — posts the registered official contract to ONE connected community.
 *
 * Owner-only and evidence-bound server-side. Separate from registration and
 * separate from the Launch Watch subscriber notification: neither of those ever
 * posts to a group. `clientRequestId` must stay stable for one intended
 * broadcast, and one launch can only ever be broadcast once per community.
 */
export function sendOfficialContractBroadcast(params: {
  workspaceId: string;
  groupConnectionId: string;
  launchId: string;
  clientRequestId: string;
}): Promise<OfficialContractBroadcastResult> {
  return invoke<OfficialContractBroadcastResult>({
    action: "send_official_contract_broadcast",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
    launchId: params.launchId,
    clientRequestId: params.clientRequestId,
  });
}

/* ------------------------------------------------------------------ */
/* C8.7E — official contract CORRECTION broadcast (client contract)    */
/* ------------------------------------------------------------------ */

export type OfficialContractCorrectionBroadcastResult = {
  status?: GroupAnnouncementStatus;
  /** True when this exact request id was already recorded — nothing was re-sent. */
  duplicate?: boolean;
  announcementId?: string;
  announcementKind?: string;
  launchId?: string;
  groupConnectionId?: string;
  groupTitle?: string;
  messageId?: number | null;
  sentAt?: string | null;
  deliveryKind?: "TEXT" | (string & {});
  /** Exactly what the server posted. Never editable in the browser. */
  deliveredText?: string;
  contractRegistrationEventId?: string;
  previousContractAddress?: string;
  contractAddress?: string;
  /** Recoverable: the bot was removed from the community. */
  reconnectRequired?: boolean;
  connectionState?: string;
  message?: string;
  technical?: string | null;
};

/**
 * C8.7E — posts an official contract CORRECTION to ONE connected community.
 *
 * The browser supplies identity only: workspace, community, launch, correction
 * event and request id. It never sends the old or new address and never sends
 * any packet copy — the server binds the current CORRECTED ledger event,
 * re-derives the address from the bound deployment evidence and composes the
 * message itself. One correction event can only ever be posted once per
 * community, and retries keep the existing no-auto-resend semantics: an
 * ambiguous or already-recorded attempt is reported, not repeated.
 */
export function sendOfficialContractCorrectionBroadcast(params: {
  workspaceId: string;
  groupConnectionId: string;
  launchId: string;
  registrationEventId: string;
  clientRequestId: string;
}): Promise<OfficialContractCorrectionBroadcastResult> {
  return invoke<OfficialContractCorrectionBroadcastResult>({
    action: "send_official_contract_correction_broadcast",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
    launchId: params.launchId,
    registrationEventId: params.registrationEventId,
    clientRequestId: params.clientRequestId,
  });
}
