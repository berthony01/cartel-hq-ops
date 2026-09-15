/**
 * SE-16.1 — Telegram Mini App browser helpers (client-safe, non-secret).
 *
 * The ONLY credential this module exposes is the raw `Telegram.WebApp.initData`
 * query string, which is verified server-side by the SE-16.0 bridge before any
 * data is returned. `initDataUnsafe` is never read here and must never be used
 * as identity or authorization evidence. No token, chat id, or project secret
 * exists in this file.
 */

type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return tg?.WebApp ?? null;
}

/** Raw signed credential, or null when not running inside Telegram. */
export function readRawInitData(): string | null {
  const app = webApp();
  const raw = typeof app?.initData === "string" ? app.initData.trim() : "";
  return raw.length > 0 ? raw : null;
}

/** Non-destructive Telegram boot. Never requests permissions or writes. */
export function telegramBoot(): void {
  const app = webApp();
  try {
    app?.ready?.();
    app?.expand?.();
  } catch {
    // A missing or partial WebApp bridge must never break rendering.
  }
}

/** User-safe copy for the bounded failure reasons the bridge can return. */
export function miniAppFailureMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "not_group_admin":
      return "You are not currently an admin of this mission's Telegram group.";
    case "not_found":
      return "This mission is not available for your account.";
    case "invalid_mission_id":
    case "invalid_workspace_id":
      return "That mission link is not valid.";
    case "expired_init_data":
    case "future_init_data":
    case "invalid_hash":
    case "missing_init_data":
    case "malformed_init_data":
      return "Your Telegram session expired. Close and reopen Mission Control from the bot.";
    case "unavailable":
      return "Mission Control is temporarily unavailable. Try again in a moment.";
    default:
      return "Mission Control could not load this right now.";
  }
}

/** Human-readable remaining time. Null-honest: never invents a value. */
export function formatTimeRemaining(endsAt: string | null): string {
  if (!endsAt) return "End time not set";
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return "End time not set";
  const diffMs = end - Date.now();
  if (diffMs <= 0) return "Ending now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours}h ${rest}m remaining` : `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h remaining`;
}

/** Metric values are null-honest: an unavailable metric never renders as 0. */
export function formatMetricValue(value: number | null): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}

/** Targets read as "Off" when unset, never as zero. */
export function formatTargetValue(value: number | null): string {
  return value === null || value === undefined ? "Off" : value.toLocaleString("en-US");
}

export const MINI_APP_METRIC_LABELS: Record<string, string> = {
  views: "Views",
  likes: "Likes",
  replies: "Replies",
  reposts: "Reposts",
  bookmarks: "Bookmarks",
};
