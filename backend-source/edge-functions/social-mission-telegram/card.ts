/**
 * SE-3 — Cartel Social Mission Telegram card renderer (PURE).
 *
 * Dependency-free on purpose: no Deno API, no fetch, no Supabase client, no
 * secret. The Edge Function is the only caller and always passes authoritative
 * rows it loaded server-side. Arbitrary operator message text is NEVER an
 * input: the only free text that can reach a card is the stored social post
 * content, defensively flattened and truncated.
 *
 * Copy safety (V1, frozen):
 * - Genuine participation language only; no promise, reward, points, payout,
 *   quota, coercion, or required engagement.
 * - COMPLETED cards use the exact phrase "Observed during the mission window"
 *   and state that observed change is NOT proof Telegram caused the growth.
 * - A metric whose canonical value is null is OMITTED. Null never becomes 0.
 * - Plain text only. No parse_mode, no HTML, no Markdown.
 * - Exactly one inline URL button pointing at the stored canonical post URL.
 */

export const TELEGRAM_TEXT_MAX = 4096;
/** Telegram photo captions are hard-limited to 1024 characters. */
export const TELEGRAM_CAPTION_MAX = 1024;
export const EXCERPT_MAX = 180;

export type MissionCardPlatform = "x" | "instagram" | "tiktok" | "youtube" | "facebook";

export type CanonicalMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

export const EMPTY_METRICS: CanonicalMetrics = {
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

/** DRAFT is deliberately absent: a draft mission has no transport and no card. */
export type MissionCardStatus = "LIVE" | "COMPLETED" | "CANCELLED" | "FAILED";

/**
 * SE-5 — optional milestone display. A milestone is a PROJECT-level public
 * metric target. It is never a requirement placed on an individual member and
 * it never carries a reward, point, badge or payout.
 */
export type MissionMilestone = {
  type: "VIEWS" | "LIKES" | "REPLIES" | "REPOSTS" | "TOTAL_INTERACTIONS";
  target: number;
};

export type MissionCardInput = {
  missionStatus: MissionCardStatus;
  platform: MissionCardPlatform;
  canonicalUrl: string;
  authorHandle: string | null;
  contentText: string | null;
  projectName: string | null;
  ticker: string | null;
  /** Mission baseline captured when the mission started. */
  baseline: CanonicalMetrics;
  /** Latest metric snapshot, or null when nothing has been observed yet. */
  latest: CanonicalMetrics | null;
  /** SE-5 — product-level ACCOMPLISHED. The DB status stays LIVE/COMPLETED. */
  accomplished?: boolean;
  /** SE-5 — mission window end, used only for an approximate remaining time. */
  endsAt?: string | null;
  /** Injected clock so the renderer stays deterministic and testable. */
  nowMs?: number;
  /** SE-5 — optional configured milestone. Omitted entirely when unset. */
  milestone?: MissionMilestone | null;
  /**
   * Hard character budget. Defaults to the plain-text limit; the branded photo
   * transport passes TELEGRAM_CAPTION_MAX so a caption can never be rejected.
   */
  maxLength?: number;
};

export type MissionCardButton = { text: string; url: string };

export type MissionCard = {
  text: string;
  /** Exactly one inline URL button, or null when the stored URL is unusable. */
  replyMarkup: { inline_keyboard: MissionCardButton[][] } | null;
};

type MetricKey = keyof CanonicalMetrics;

const METRIC_ORDER: MetricKey[] = ["views", "likes", "comments", "shares", "saves"];

/** Platform-truthful labels. X reposts are not quotes; bookmarks are not likes. */
const X_LABELS: Record<MetricKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Replies",
  shares: "Reposts",
  saves: "Bookmarks",
};

const GENERIC_LABELS: Record<MetricKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
};

export const COMPLETED_OBSERVED_PHRASE = "Observed during the mission window";
export const NO_CAUSATION_CAVEAT =
  "Observed changes are not proof that Telegram caused the growth.";
export const LIVE_MISSION_HEADER = "🎯 COMMUNITY MISSION";
export const LIVE_ACTION_LINE = "Open the official post, read it, and join the conversation.";
export const LIVE_OPTIONAL_LINE = "Likes, replies, and reposts are optional. Participate naturally.";
export const LIVE_METRICS_HEADING = "📊 LIVE RESULTS";
/**
 * SE-5 — shown INSTEAD of metric lines when no snapshot exists yet, so a live
 * card never looks like a generic bot announcement and never shows fake zeroes.
 */
export const LIVE_METRICS_PENDING = "Live metrics updating…";
/**
 * SE-6 correction (C): the stable legend that tells a reader what the numbers
 * are and how often they move. Mirrors `MISSION_FOOTER_LEGEND` in
 * `_shared/mission-progress.ts`. It is part of the composed body, so the
 * existing progressive length-safety keeps it inside the 1024-character
 * branded caption: the post excerpt shrinks or is dropped before the footer.
 */
export const MISSION_FOOTER_LEGEND =
  "Legend: views · likes · replies · reposts. Official X numbers, refreshed about every 5 minutes. A blank number is not yet available.";
export const MISSION_STATE_LIVE = "LIVE";
export const MISSION_STATE_ACCOMPLISHED = "ACCOMPLISHED";


export function metricLabels(platform: MissionCardPlatform): Record<MetricKey, string> {
  return platform === "x" ? X_LABELS : GENERIC_LABELS;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026` : flat;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function buttonLabel(platform: MissionCardPlatform): string {
  if (platform === "x") return "OPEN ON X";
  if (platform === "youtube") return "OPEN ON YOUTUBE";
  return "OPEN POST";
}

/** One line per metric that has a real value. Deltas only when both sides exist. */
export function renderMetricLines(
  platform: MissionCardPlatform,
  baseline: CanonicalMetrics,
  latest: CanonicalMetrics | null,
): string[] {
  const labels = metricLabels(platform);
  const lines: string[] = [];
  for (const key of METRIC_ORDER) {
    const current = latest ? latest[key] : null;
    const base = baseline[key];
    const value = isCount(current) ? current : isCount(base) ? base : null;
    if (value === null) continue; // null is never rendered as 0
    let suffix = "";
    if (isCount(current) && isCount(base)) {
      const delta = current - base;
      if (delta !== 0) suffix = ` (${delta > 0 ? "+" : ""}${delta})`;
    }
    lines.push(`${labels[key]}: ${value}${suffix}`);
  }
  return lines;
}

function projectLine(input: MissionCardInput): string | null {
  const name = clean(input.projectName, 120);
  const ticker = clean(input.ticker, 24);
  if (name && ticker) return `${name} \u00b7 ${ticker}`;
  return name ?? ticker;
}

function headline(status: MissionCardStatus): string {
  if (status === "LIVE") return "CARTEL SOCIAL MISSION \u2014 LIVE";
  if (status === "COMPLETED") return "CARTEL SOCIAL MISSION \u2014 COMPLETED";
  if (status === "CANCELLED") return "CARTEL SOCIAL MISSION \u2014 CANCELLED";
  return "CARTEL SOCIAL MISSION \u2014 FAILED";
}

function statusBody(status: MissionCardStatus): string[] {
  // Activation only: read, think, contribute. No promise, reward or quota.
  if (status === "LIVE") return [LIVE_MISSION_HEADER, LIVE_ACTION_LINE, LIVE_OPTIONAL_LINE];
  if (status === "COMPLETED") return ["This mission window is closed."];
  if (status === "CANCELLED") return ["This mission was cancelled before it completed."];
  return ["This mission ended in a failed state."];
}

function metricsHeading(status: MissionCardStatus): string {
  return status === "LIVE" ? LIVE_METRICS_HEADING : `${COMPLETED_OBSERVED_PHRASE}:`;
}

/** Approximate, deliberately coarse. Never a countdown, never a deadline. */
export function approximateRemaining(endsAt: unknown, nowMs: number): string | null {
  if (typeof endsAt !== "string" || !endsAt.trim()) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const remaining = end - nowMs;
  if (remaining <= 0) return null;
  const minutes = Math.max(1, Math.round(remaining / 60_000));
  return `~${minutes}m remaining`;
}

const MILESTONE_LABELS: Record<MissionMilestone["type"], string> = {
  VIEWS: "Views",
  LIKES: "Likes",
  REPLIES: "Replies",
  REPOSTS: "Reposts",
  TOTAL_INTERACTIONS: "Likes + replies + reposts",
};

/**
 * Milestone progress against ABSOLUTE public metrics. `TOTAL_INTERACTIONS`
 * deliberately excludes views and bookmarks. Returns null when the milestone is
 * unset or the metrics needed for it are unknown; unknown never becomes 0.
 */
export function milestoneProgressLine(
  milestone: MissionMilestone | null | undefined,
  latest: CanonicalMetrics | null,
  accomplished: boolean,
): string | null {
  if (!milestone || !isCount(milestone.target) || milestone.target <= 0) return null;
  if (!latest) return null;
  let progress: number | null = null;
  if (milestone.type === "VIEWS") progress = isCount(latest.views) ? latest.views : null;
  else if (milestone.type === "LIKES") progress = isCount(latest.likes) ? latest.likes : null;
  else if (milestone.type === "REPLIES") progress = isCount(latest.comments) ? latest.comments : null;
  else if (milestone.type === "REPOSTS") progress = isCount(latest.shares) ? latest.shares : null;
  else {
    const parts = [latest.likes, latest.comments, latest.shares].filter(isCount);
    progress = parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : null;
  }
  if (progress === null) return null;
  const suffix = accomplished || progress >= milestone.target ? " ✅" : "";
  return `Milestone: ${MILESTONE_LABELS[milestone.type]} ${progress} / ${milestone.target}${suffix}`;
}

function composeLines(input: MissionCardInput, excerptBudget: number | null): string[] {
  const lines: string[] = [];
  const nowMs = typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const accomplished = input.accomplished === true;

  const project = projectLine(input);
  if (project) lines.push(project);
  lines.push(headline(input.missionStatus));

  const handle = clean(input.authorHandle, 64);
  if (handle) lines.push(`Post by @${handle.replace(/^@/, "")}`);

  const excerpt = excerptBudget === null ? null : clean(input.contentText, excerptBudget);
  if (excerpt) {
    lines.push("");
    lines.push(excerpt);
  }

  lines.push("");
  for (const line of statusBody(input.missionStatus)) lines.push(line);

  const metricLines = renderMetricLines(input.platform, input.baseline, input.latest);
  if (input.missionStatus === "LIVE") {
    // A LIVE card ALWAYS carries the results block. With no snapshot yet it
    // says so honestly instead of rendering zeroes.
    lines.push("");
    lines.push(LIVE_METRICS_HEADING);
    if (metricLines.length > 0) for (const line of metricLines) lines.push(line);
    else lines.push(LIVE_METRICS_PENDING);

    const milestoneLine = milestoneProgressLine(input.milestone, input.latest, accomplished);
    if (milestoneLine) lines.push(milestoneLine);

    const remaining = approximateRemaining(input.endsAt, nowMs);
    const state = accomplished ? MISSION_STATE_ACCOMPLISHED : MISSION_STATE_LIVE;
    lines.push(remaining ? `Status: ${state} · ${remaining}` : `Status: ${state}`);
    // SE-6 (C): stable refresh legend on every LIVE card.
    lines.push(MISSION_FOOTER_LEGEND);

  } else if (metricLines.length > 0) {
    lines.push("");
    lines.push(metricsHeading(input.missionStatus));
    for (const line of metricLines) lines.push(line);
    const milestoneLine = milestoneProgressLine(input.milestone, input.latest, accomplished);
    if (milestoneLine) lines.push(milestoneLine);
  }

  if (input.missionStatus !== "LIVE") {
    lines.push("");
    if (accomplished) lines.push(`Status: ${MISSION_STATE_ACCOMPLISHED}`);
    lines.push(NO_CAUSATION_CAVEAT);
  }

  return lines;
}

/**
 * Deterministic, length-safe card. Never throws on ordinary data.
 *
 * Length safety is progressive so the mandatory identity, status, caveat and
 * metric lines always survive: the excerpt is first shortened to the remaining
 * budget, then dropped entirely, and only then is the result hard-clamped.
 */
export function renderMissionCard(input: MissionCardInput): MissionCard {
  const limit =
    typeof input.maxLength === "number" && Number.isFinite(input.maxLength) && input.maxLength > 0
      ? Math.min(Math.floor(input.maxLength), TELEGRAM_TEXT_MAX)
      : TELEGRAM_TEXT_MAX;

  let body = composeLines(input, EXCERPT_MAX).join("\n");
  if (body.length > limit) {
    // Reserve the exact space the non-excerpt structure needs, then refit.
    const withoutExcerpt = composeLines(input, null).join("\n");
    const room = limit - withoutExcerpt.length - 2; // two newlines around the excerpt
    body = room >= 24 ? composeLines(input, room).join("\n") : withoutExcerpt;
  }

  const text = body.slice(0, limit);

  const replyMarkup = isHttpUrl(input.canonicalUrl)
    ? { inline_keyboard: [[{ text: buttonLabel(input.platform), url: input.canonicalUrl.trim() }]] }
    : null;

  return { text, replyMarkup };
}
