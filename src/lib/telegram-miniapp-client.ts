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
    // C3A — server-side x_missions entitlement refusal.
    case "missions_plan_required":
      return "Mission Control is included with Cartel HQ Pro ($49/month).";
    // Live Telegram group permission.
    case "not_group_admin":
      return "You are not currently an admin of this mission's Telegram group.";

    // Operator scope / routing hints.
    case "not_found":
      return "This mission is not available for your account.";
    // /missioncontrol direct-link launches. A copied link grants nothing.
    case "community_launch_invalid":
      return "This Mission Control link is not valid. Send /missioncontrol in your community to get a fresh one.";
    case "community_launch_unavailable":
      return "Mission Control for this community is not available to your account, or the community is no longer connected.";
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

/* ===================================================================== */
/* SE-16.2 UI — bounded mutation helpers (client-safe, non-secret).       */
/*                                                                        */
/* Nothing here talks to a server, holds a credential, or derives any     */
/* identity. Request ids are opaque correlation values only: the bridge   */
/* never treats one as identity or authorization evidence.                */
/* ===================================================================== */

/** Primary goal choices, exactly matching the bridge allowlist. */
export const MINI_APP_PRIMARY_TYPES = [
  "VIEWS",
  "LIKES",
  "REPLIES",
  "REPOSTS",
  "TOTAL_INTERACTIONS",
] as const;
export type MiniAppPrimaryType = (typeof MINI_APP_PRIMARY_TYPES)[number];

export const MINI_APP_PRIMARY_LABELS: Record<string, string> = {
  VIEWS: "Views",
  LIKES: "Likes",
  REPLIES: "Replies",
  REPOSTS: "Reposts",
  TOTAL_INTERACTIONS: "Total interactions",
};

/** Supporting target fields, exactly matching the bridge metric set. */
export const MINI_APP_SUPPORTING_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "bookmarks",
] as const;
export type MiniAppSupportingMetric = (typeof MINI_APP_SUPPORTING_METRICS)[number];

/**
 * A non-TOTAL primary type pins its own supporting metric to the primary
 * target server-side. The editor must say so rather than imply a conflicting
 * supporting value would win.
 */
export const MINI_APP_PINNED_SUPPORT: Record<string, MiniAppSupportingMetric | null> = {
  VIEWS: "views",
  LIKES: "likes",
  REPLIES: "replies",
  REPOSTS: "reposts",
  TOTAL_INTERACTIONS: null,
};

/** Quick end-time choices. Minutes FROM NOW, never an absolute time. */
export const MINI_APP_DURATION_CHOICES = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
] as const;

/** Exactly the bridge/RPC bound. */
export const MINI_APP_MIN_MINUTES = 1;
export const MINI_APP_MAX_MINUTES = 1440;

/**
 * Fresh opaque correlation id for a NEW submit. Fails safely to null when the
 * runtime has no `crypto.randomUUID`, so the UI can refuse instead of sending
 * a fabricated value the bridge would reject.
 */
export function newRequestId(): string | null {
  try {
    const source = globalThis.crypto;
    if (!source || typeof source.randomUUID !== "function") return null;
    const value = source.randomUUID();
    return typeof value === "string" && value.length === 36 ? value : null;
  } catch {
    return null;
  }
}

export type MiniAppDraftParse = { ok: true; value: number | null } | { ok: false };

/**
 * Blank means Off and yields null — never 0. Anything non-integer, zero,
 * negative or beyond the safe-integer range is rejected before submit.
 */
export function parseOptionalPositiveInt(raw: string): MiniAppDraftParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (!/^[0-9]+$/.test(trimmed)) return { ok: false };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

/** Same rules, but the field is mandatory: blank is rejected, not Off. */
export function parseRequiredPositiveInt(raw: string): MiniAppDraftParse {
  const parsed = parseOptionalPositiveInt(raw);
  if (!parsed.ok || parsed.value === null) return { ok: false };
  return parsed;
}

export function isMinutesInBounds(minutes: number): boolean {
  return (
    Number.isSafeInteger(minutes) &&
    minutes >= MINI_APP_MIN_MINUTES &&
    minutes <= MINI_APP_MAX_MINUTES
  );
}

/** Outcomes that mean the database mutation is committed. */
export const MINI_APP_COMMITTED_OUTCOMES = ["ok", "replayed"] as const;

export function isCommittedOutcome(outcome: string | null | undefined): boolean {
  return outcome === "ok" || outcome === "replayed";
}

export type MiniAppNoticeTone = "success" | "warning" | "error";

/**
 * `committed` is the database fact; `retry` is the Telegram-card fact. They are
 * deliberately separate so the UI can never claim a card refresh that did not
 * happen, and can never deny a mutation that did.
 */
export type MiniAppMutationNotice = {
  tone: MiniAppNoticeTone;
  message: string;
  committed: boolean;
  retry: boolean;
};

/** Bounded, user-safe copy for mutation refusals. No raw reason is rendered. */
export function miniAppMutationFailureMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "not_live":
      return "This mission is no longer live, so it can no longer be edited here.";
    case "conflict":
    case "event_claimed":
      return "This mission is updating right now. Try again in a few seconds.";
    case "invalid_minutes":
      return "Choose a whole number of minutes between 1 and 1440.";
    case "invalid_primary_type":
    case "invalid_primary_target":
    case "invalid_target":
      return "Those target values were not accepted. Use whole numbers above zero.";
    case "invalid_request_id":
    case "invalid_mode":
      return "That change could not be submitted. Close and reopen Mission Control from the bot.";
    case "denied":
      return "You are not allowed to change this mission.";
    default:
      return miniAppFailureMessage(reason);
  }
}

/**
 * Maps a bounded bridge result to truthful copy. A committed mutation whose
 * card refresh is `failed`/`ambiguous` is reported as saved-but-unconfirmed,
 * never as full success.
 */
export function classifyMutationResult(
  result: { ok?: boolean; outcome?: string; refresh?: string; reason?: string } | null | undefined,
): MiniAppMutationNotice {
  if (!result || result.ok !== true) {
    return {
      tone: "error",
      message: miniAppMutationFailureMessage(result?.reason),
      committed: false,
      retry: false,
    };
  }
  if (isCommittedOutcome(result.outcome)) {
    if (result.refresh === "edited" || result.refresh === "replayed") {
      return {
        tone: "success",
        message: "Saved and Telegram card updated.",
        committed: true,
        retry: false,
      };
    }
    // SE-16.3R-3 — the new canonical card IS live; only the removal of the old
    // one is still queued. That is not a failure and must not invite a retry.
    if (result.refresh === "cleanup_pending") {
      return {
        tone: "warning",
        message:
          "Saved and the new Telegram card was posted. The previous card is queued for removal.",
        committed: true,
        retry: false,
      };
    }
    return {
      tone: "warning",
      message: "Saved, but the Telegram card could not be confirmed. Retry card refresh.",
      committed: true,
      retry: true,
    };
  }
  const outcome = result.outcome;
  return {
    tone: "error",
    message: miniAppMutationFailureMessage(outcome),
    committed: false,
    retry: outcome === "conflict" || outcome === "event_claimed",
  };
}

/**
 * A transport-layer failure proves nothing either way, so success is never
 * claimed and the SAME payload/request id stays available for a safe retry.
 */
export function networkUncertaintyNotice(): MiniAppMutationNotice {
  return {
    tone: "warning",
    message: "Could not confirm whether the change was saved. Retry safely.",
    committed: false,
    retry: true,
  };
}

/* ------------------------------------------ MINI-HQ-1C LIFECYCLE RESULTS */

export type MiniAppLifecycleKind = "end_now" | "cancel";

export type MiniAppLifecycleNotice = MiniAppMutationNotice & {
  /** True only when the mission is proven final (committed). */
  finalized: boolean;
};

/**
 * Truthful copy for END NOW / CANCEL. The lifecycle commit and the in-place
 * card edit are separate facts; an unconfirmed card edit never invites a
 * second edit — the same request id is replayed and the transport dedupes.
 */
export function classifyLifecycleResult(
  kind: MiniAppLifecycleKind,
  result: { ok?: boolean; outcome?: string; refresh?: string; reason?: string } | null | undefined,
): MiniAppLifecycleNotice {
  const done = kind === "end_now" ? "Mission ended" : "Mission cancelled";
  if (!result || result.ok !== true) {
    // A retry after the mission already finalized can no longer resolve it as
    // a live mission; that is reported honestly, not as a new success.
    if (result?.reason === "not_found") {
      return {
        tone: "warning",
        message:
          "This mission is no longer live, so it may already be finalized. Check the card in the community before doing anything else.",
        committed: false,
        retry: false,
        finalized: false,
      };
    }
    return {
      tone: "error",
      message: miniAppMutationFailureMessage(result?.reason),
      committed: false,
      retry: false,
      finalized: false,
    };
  }
  if (isCommittedOutcome(result.outcome)) {
    if (result.refresh === "edited" || result.refresh === "replayed") {
      return {
        tone: "success",
        message: `${done}. The Telegram card was updated in place.`,
        committed: true,
        retry: false,
        finalized: true,
      };
    }
    return {
      tone: "warning",
      message: `${done}, but the Telegram card update could not be confirmed. Do not resend it from the bot.`,
      committed: true,
      retry: false,
      finalized: true,
    };
  }
  const outcome = result.outcome;
  if (outcome === "not_live") {
    return {
      tone: "warning",
      message: "This mission is no longer live. Nothing was changed.",
      committed: false,
      retry: false,
      finalized: false,
    };
  }
  return {
    tone: "error",
    message: miniAppMutationFailureMessage(outcome),
    committed: false,
    retry: outcome === "conflict" || outcome === "event_claimed",
    finalized: false,
  };
}
