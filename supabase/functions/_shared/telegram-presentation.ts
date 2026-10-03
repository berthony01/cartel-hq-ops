/**
 * CARTEL HQ Telegram presentation layer.
 *
 * Pure and transport-agnostic: callers apply it immediately before their one
 * existing send/edit call. It never sends, retries, changes callback data or
 * URLs, and it keeps the visible Unicode emoji as a static fallback.
 */

export const TELEGRAM_PRESENTATION_VERSION = "pepecartel_v1";

export const CARTEL_CUSTOM_EMOJI = {
  announce: { emoji: "📣", id: "5309984423003823246", animated: true, video: false },
  energy: { emoji: "🔥", id: "5312241539987020022", animated: true, video: false },
  premium: { emoji: "💎", id: "5309958691854754293", animated: true, video: false },
  achievement: { emoji: "🏆", id: "5312315739842026755", animated: true, video: false },
  success: { emoji: "✅", id: "5237699328843200968", animated: true, video: false },
} as const;

type TelegramButton = Record<string, unknown> & { text?: unknown };
type TelegramKeyboard = { inline_keyboard?: unknown } & Record<string, unknown>;

const ACCENTS = Object.values(CARTEL_CUSTOM_EMOJI);
const DESTRUCTIVE = /\b(stop|delete|remove|cancel|end|mute|disconnect|close)\b/i;
const ACTION = /\b(open|start|join|watch|enable|save|send|confirm|retry|publish|connect|add|continue|view|reply|launch|manage)\b/i;

function accentFor(text: string) {
  return ACCENTS.find((accent) => text.includes(accent.emoji)) ?? null;
}

/** Adds only Bot API presentation fields; callback_data and url are untouched. */
export function presentInlineKeyboard(value: unknown): unknown {
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
            const accent = accentFor(text);
            const style = DESTRUCTIVE.test(text) ? "danger" : ACTION.test(text) ? "success" : undefined;
            return {
              ...button,
              ...(style ? { style } : {}),
              ...(accent ? { icon_custom_emoji_id: accent.id } : {}),
            };
          })
        : rawRow,
    ),
  };
}

/** Animates one existing accent in HTML while preserving its visible fallback. */
export function presentHtmlText(text: string): string {
  if (!text || text.includes("<tg-emoji")) return text;
  const accent = accentFor(text);
  if (!accent) return text;
  return text.replace(
    accent.emoji,
    `<tg-emoji emoji-id="${accent.id}">${accent.emoji}</tg-emoji>`,
  );
}

/**
 * Applies presentation without changing delivery semantics. Plain/frozen text
 * stays byte-identical; HTML gets one animated accent and keyboards get native
 * Bot API styles plus validated custom-emoji icons.
 */
export function presentTelegramPayload(
  method: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!/^(sendMessage|sendPhoto|sendAnimation|editMessageText|editMessageCaption)$/.test(method)) {
    return body;
  }
  const next = { ...body };
  if (next.reply_markup) next.reply_markup = presentInlineKeyboard(next.reply_markup);
  if (next.parse_mode === "HTML") {
    if (typeof next.text === "string") next.text = presentHtmlText(next.text);
    if (typeof next.caption === "string") next.caption = presentHtmlText(next.caption);
  }
  return next;
}