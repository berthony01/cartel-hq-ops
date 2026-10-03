/**
 * CARTEL HQ Telegram presentation layer.
 *
 * Pure and transport-agnostic: callers apply it immediately before their one
 * existing send/edit call. It never sends, retries, changes callback data or
 * URLs, and it keeps the visible Unicode emoji as a static fallback.
 */

export const TELEGRAM_PRESENTATION_VERSION = "pepecartel_v1";
export type TelegramPresentationContext = "platform" | "authored" | "frozen";

export const CARTEL_CUSTOM_EMOJI = {
  announce: { emoji: "📣", id: "5309984423003823246", animated: true, video: false },
  energy: { emoji: "🔥", id: "5312241539987020022", animated: true, video: false },
  premium: { emoji: "💎", id: "5309958691854754293", animated: true, video: false },
  achievement: { emoji: "🏆", id: "5312315739842026755", animated: true, video: false },
  success: { emoji: "✅", id: "5237699328843200968", animated: true, video: false },
} as const;

type TelegramButton = Record<string, unknown> & { text?: unknown };
type TelegramKeyboard = { inline_keyboard?: unknown } & Record<string, unknown>;

const DESTRUCTIVE = /\b(stop|delete|remove|cancel|end|mute|disconnect|close)\b/i;
const ACTION = /\b(open|start|join|watch|enable|save|send|confirm|retry|publish|connect|add|continue|view|reply|launch|manage)\b/i;

/** Adds only Bot API presentation fields; callback_data and url are untouched. */
export function presentInlineKeyboard(value: unknown, context: TelegramPresentationContext = "authored"): unknown {
  if (!value || typeof value !== "object") return value;
  const keyboard = value as TelegramKeyboard;
  if (!Array.isArray(keyboard.inline_keyboard)) return value;
  return {
    ...keyboard,
    inline_keyboard: keyboard.inline_keyboard.map((rawRow) =>
      Array.isArray(rawRow)
        ? rawRow.map((rawButton) => {
            if (!rawButton || typeof rawButton !== "object") return rawButton;
            const button = rawButton as TelegramButton;
            const text = typeof button.text === "string" ? button.text : "";
            const existingStyle = typeof button.style === "string" ? button.style : undefined;
            const existingIcon = typeof button.icon_custom_emoji_id === "string" ? button.icon_custom_emoji_id : undefined;
            const style = existingStyle ?? (DESTRUCTIVE.test(text) ? "danger" : ACTION.test(text) ? "success" : undefined);
            const generatedIcon = context === "platform" && ACTION.test(text) ? CARTEL_CUSTOM_EMOJI.announce.id : undefined;
            return {
              ...button,
              ...(style ? { style } : {}),
              ...((existingIcon ?? generatedIcon) ? { icon_custom_emoji_id: existingIcon ?? generatedIcon } : {}),
            };
          })
        : rawRow,
    ),
  };
}

const HEADER_LABEL = "PEPECARTEL · CARTEL HQ";
const HEADER_ACCENT: keyof typeof CARTEL_CUSTOM_EMOJI = "energy";

/** Telegram limits are measured after entity parsing. */
export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Creates one generated header; authored HTML is never searched or rewritten. */
export function brandedHeader(accent: keyof typeof CARTEL_CUSTOM_EMOJI = HEADER_ACCENT): string {
  const selected = CARTEL_CUSTOM_EMOJI[accent];
  return `<tg-emoji emoji-id="${selected.id}">${selected.emoji}</tg-emoji> <b>${HEADER_LABEL}</b>`;
}

/** Visible plain header used for messages without parse_mode. */
export const PLAIN_BRANDED_HEADER = `${CARTEL_CUSTOM_EMOJI[HEADER_ACCENT].emoji} ${HEADER_LABEL}`;
const PLAIN_PREFIX = `${PLAIN_BRANDED_HEADER}\n\n`;
/** UTF-16 length of the visible decoration (same for HTML and plain). */
const PREFIX_VISIBLE_LENGTH = PLAIN_PREFIX.length;

/**
 * Conservative visible length (UTF-16 code units) of Telegram HTML after
 * parsing: tags removed, character references counted as what they decode to.
 */
export function telegramHtmlVisibleLength(html: string): number {
  const withoutTags = html.replace(/<[^>]*>/g, "");
  let length = 0;
  const ref = /&(#x[0-9a-f]+|#[0-9]+|lt|gt|amp|quot);/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = ref.exec(withoutTags))) {
    length += match.index - last;
    const body = match[1]!.toLowerCase();
    let decoded = "?";
    if (body.startsWith("#x")) decoded = String.fromCodePoint(Math.min(parseInt(body.slice(2), 16) || 63, 0x10ffff));
    else if (body.startsWith("#")) decoded = String.fromCodePoint(Math.min(parseInt(body.slice(1), 10) || 63, 0x10ffff));
    length += decoded.length;
    last = match.index + match[0].length;
  }
  return length + (withoutTags.length - last);
}

function fitsWithPrefix(visibleLength: number, limit: number) {
  return visibleLength + PREFIX_VISIBLE_LENGTH <= limit;
}

export function presentHtmlText(
  text: string,
  context: TelegramPresentationContext = "authored",
  limit: number = TELEGRAM_TEXT_LIMIT,
): string {
  if (!text || context !== "platform" || text.startsWith("<tg-emoji") || text.startsWith(PLAIN_BRANDED_HEADER)) return text;
  // At capacity the decoration is omitted; authored content is never truncated.
  if (!fitsWithPrefix(telegramHtmlVisibleLength(text), limit)) return text;
  return `${brandedHeader()}\n\n${text}`;
}

type TelegramEntity = { type: string; offset: number; length: number } & Record<string, unknown>;

/**
 * Plain (no parse_mode) platform text: prepend the visible header and attach
 * an animated custom-emoji entity + bold entity. Existing entities are kept
 * and shifted by the exact UTF-16 prefix length; the text is never escaped or
 * reinterpreted. Returns null when decoration must be omitted.
 */
export function presentPlainText(
  text: string,
  entities: unknown,
  limit: number,
): { text: string; entities: TelegramEntity[] } | null {
  if (!text || text.startsWith(PLAIN_BRANDED_HEADER)) return null;
  if (entities !== undefined && !Array.isArray(entities)) return null;
  if (!fitsWithPrefix(text.length, limit)) return null;
  const existing = (entities ?? []) as TelegramEntity[];
  if (existing.some((e) => !e || typeof e.offset !== "number" || typeof e.length !== "number")) return null;
  const accent = CARTEL_CUSTOM_EMOJI[HEADER_ACCENT];
  const generated: TelegramEntity[] = [
    { type: "custom_emoji", offset: 0, length: accent.emoji.length, custom_emoji_id: accent.id },
    { type: "bold", offset: accent.emoji.length + 1, length: HEADER_LABEL.length },
  ];
  return {
    text: `${PLAIN_PREFIX}${text}`,
    entities: [...generated, ...existing.map((e) => ({ ...e, offset: e.offset + PLAIN_PREFIX.length }))],
  };
}

const TEXT_METHODS = /^(sendMessage|editMessageText)$/;
const CAPTION_METHODS = /^(sendPhoto|sendAnimation|sendDocument|sendVideo|editMessageCaption)$/;

/** Decorates the one text/caption field in place on a plain record. */
function presentTextField(method: string, next: Record<string, unknown>) {
  const isText = TEXT_METHODS.test(method);
  const isCaption = CAPTION_METHODS.test(method);
  if (!isText && !isCaption) return;
  const field = isText ? "text" : "caption";
  const entitiesField = isText ? "entities" : "caption_entities";
  const limit = isText ? TELEGRAM_TEXT_LIMIT : TELEGRAM_CAPTION_LIMIT;
  const value = next[field];
  if (typeof value !== "string" || !value) return;
  const parseMode = next["parse_mode"];
  const hasEntities = next[entitiesField] !== undefined;
  if (parseMode === "HTML" && !hasEntities) {
    next[field] = presentHtmlText(value, "platform", limit);
  } else if (parseMode === undefined || parseMode === null || parseMode === "") {
    const decorated = presentPlainText(value, next[entitiesField], limit);
    if (decorated) {
      next[field] = decorated.text;
      next[entitiesField] = decorated.entities;
    }
  }
  // Markdown/MarkdownV2 (or ambiguous parse_mode + entities): left untouched.
}

/**
 * Applies presentation without changing delivery semantics. Authored/frozen
 * text stays byte-identical; platform text (HTML or plain) gets one generated
 * animated header when it fits the Telegram limit; keyboards get native Bot
 * API styles plus validated custom-emoji icons.
 */
export function presentTelegramPayload(
  method: string,
  body: Record<string, unknown>,
  context: TelegramPresentationContext = "authored",
): Record<string, unknown> {
  if (!/^(sendMessage|sendPhoto|sendAnimation|sendDocument|sendVideo|sendSticker|editMessageText|editMessageCaption|editMessageReplyMarkup)$/.test(method)) {
    return body;
  }
  const next = { ...body };
  if (next.reply_markup) next.reply_markup = presentInlineKeyboard(next.reply_markup, context);
  if (context === "platform") presentTextField(method, next);
  return next;
}

/**
 * Same presentation for a multipart (FormData) payload, e.g. photo mission
 * cards. Returns a new FormData; file parts are carried over untouched.
 */
export function presentTelegramFormData(
  method: string,
  form: FormData,
  context: TelegramPresentationContext = "authored",
): FormData {
  if (context !== "platform") return form;
  const record: Record<string, unknown> = {};
  for (const key of ["text", "caption", "parse_mode", "reply_markup", "entities", "caption_entities"]) {
    const raw = form.get(key);
    if (typeof raw !== "string") continue;
    if (key === "reply_markup" || key === "entities" || key === "caption_entities") {
      try { record[key] = JSON.parse(raw); } catch { return form; }
    } else record[key] = raw;
  }
  const presented = presentTelegramPayload(method, record, context);
  const out = new FormData();
  const replaced = new Set(Object.keys(presented));
  for (const [key, value] of form.entries()) {
    if (replaced.has(key)) continue;
    out.append(key, value);
  }
  for (const [key, value] of Object.entries(presented)) {
    if (value === undefined) continue;
    out.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return out;
}
