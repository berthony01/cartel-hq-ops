/**
 * SE-16.1H — Telegram Mini App browser helpers (client-safe, non-secret).
 *
 * The ONLY credential this module exposes is the raw `Telegram.WebApp.initData`
 * query string, which is verified server-side by the SE-16.0 bridge before any
 * data is returned. `initDataUnsafe` is never read here and must never be used
 * as identity or authorization evidence. No token, chat id, or project secret
 * exists in this file.
 *
 * The Telegram WebApp script is loaded asynchronously, so the bridge may not
 * exist yet on first render. Readiness is therefore awaited with a BOUNDED
 * poll instead of a one-shot read: present immediately -> used immediately;
 * delayed -> awaited briefly; absent (ordinary browser) -> times out safely
 * into the neutral outside-Telegram state.
 */

type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

/** Upper bound on how long the Mini App waits for the Telegram bridge. */
export const TELEGRAM_BRIDGE_TIMEOUT_MS = 3000;

/** Poll step while waiting for `window.Telegram.WebApp` to appear. */
export const TELEGRAM_BRIDGE_POLL_MS = 50;

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

/**
 * Bounded wait for the asynchronously loaded Telegram bridge.
 *
 * Resolves as soon as `window.Telegram.WebApp` exposes usable `initData`, and
 * resolves `null` once the deadline passes so an ordinary browser degrades to
 * the neutral outside-Telegram state instead of hanging.
 */
export async function waitForTelegramWebApp(
  timeoutMs: number = TELEGRAM_BRIDGE_TIMEOUT_MS,
  pollMs: number = TELEGRAM_BRIDGE_POLL_MS,
): Promise<TelegramWebApp | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const app = webApp();
    if (app && typeof app.initData === "string" && app.initData.trim().length > 0) return app;
    if (Date.now() >= deadline) return app ?? null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Awaits the bridge, performs the non-destructive boot, and returns ONLY the
 * raw signed credential. Never returns or inspects `initDataUnsafe`.
 */
export async function resolveTelegramSession(
  timeoutMs: number = TELEGRAM_BRIDGE_TIMEOUT_MS,
): Promise<string | null> {
  await waitForTelegramWebApp(timeoutMs);
  telegramBoot();
  return readRawInitData();
}

/**
 * User-safe copy for the bounded failure reasons the SE-16.0 validator and
 * bridge can actually return. Internal reason names are never rendered.
 */
export function miniAppFailureMessage(reason: string | null | undefined): string {
  switch (reason) {
    // Live Telegram group permission.
    case "not_group_admin":
      return "You are not currently an admin of this mission's Telegram group.";

    // Operator scope / routing hints.
    case "not_found":
      return "This mission is not available for your account.";
    case "invalid_mission_id":
    case "invalid_workspace_id":
      return "That mission link is not valid.";

    // Signed-session problems: the fix is always to reopen from the bot.
    case "missing_init_data":
    case "init_data_too_large":
    case "malformed_init_data":
    case "duplicate_field":
    case "missing_hash":
    case "missing_auth_date":
    case "invalid_auth_date":
    case "missing_user":
    case "malformed_user":
    case "invalid_user_id":
    case "stale_auth_date":
    case "future_auth_date":
    case "bad_signature":
      return "Your Telegram session expired. Close and reopen Mission Control from the bot.";

    // Temporary infrastructure conditions.
    case "missing_bot_token":
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

/** Badge tone for an authoritative server-returned mission status. */
export function missionStatusTone(status: string): "green" | "gold" | "red" | "muted" {
  switch (status.toUpperCase()) {
    case "LIVE":
      return "green";
    case "COMPLETED":
      return "gold";
    case "CANCELLED":
      return "red";
    default:
      return "muted";
  }
}

export const MINI_APP_METRIC_LABELS: Record<string, string> = {
  views: "Views",
  likes: "Likes",
  replies: "Replies",
  reposts: "Reposts",
  bookmarks: "Bookmarks",
};
