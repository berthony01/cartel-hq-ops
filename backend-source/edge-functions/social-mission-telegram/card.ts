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
 * - No promise, reward, points, payout, quota or engagement instruction.
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
export const LIVE_PARTICIPATION_LINE = "Read the update and add your perspective.";

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
  if (status === "LIVE") return [LIVE_PARTICIPATION_LINE];
  if (status === "COMPLETED") return ["This mission window is closed."];
  if (status === "CANCELLED") return ["This mission was cancelled before it completed."];
  return ["This mission ended in a failed state."];
}

function metricsHeading(status: MissionCardStatus): string {
  return status === "LIVE" ? "Observed so far:" : `${COMPLETED_OBSERVED_PHRASE}:`;
}

/** Deterministic, length-safe card. Never throws on ordinary data. */
export function renderMissionCard(input: MissionCardInput): MissionCard {
  const lines: string[] = [];

  const project = projectLine(input);
  if (project) lines.push(project);
  lines.push(headline(input.missionStatus));

  const handle = clean(input.authorHandle, 64);
  if (handle) lines.push(`Post by @${handle.replace(/^@/, "")}`);

  const excerpt = clean(input.contentText, EXCERPT_MAX);
  if (excerpt) {
    lines.push("");
    lines.push(excerpt);
  }

  lines.push("");
  for (const line of statusBody(input.missionStatus)) lines.push(line);

  const metricLines = renderMetricLines(input.platform, input.baseline, input.latest);
  if (metricLines.length > 0) {
    lines.push("");
    lines.push(metricsHeading(input.missionStatus));
    for (const line of metricLines) lines.push(line);
  }

  if (input.missionStatus !== "LIVE") {
    lines.push("");
    lines.push(NO_CAUSATION_CAVEAT);
  }

  const text = lines.join("\n").slice(0, TELEGRAM_TEXT_MAX);

  const replyMarkup = isHttpUrl(input.canonicalUrl)
    ? { inline_keyboard: [[{ text: buttonLabel(input.platform), url: input.canonicalUrl.trim() }]] }
    : null;

  return { text, replyMarkup };
}
