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
            const existingStyle = typeof button.style === "string" ? button.style : undefined;
            const existingIcon = typeof button.icon_custom_emoji_id === "string" ? button.icon_custom_emoji_id : undefined;
            const style = existingStyle ?? (DESTRUCTIVE.test(text) ? "danger" : ACTION.test(text) ? "success" : undefined);
            return {
              ...button,
              ...(style ? { style } : {}),
              ...(existingIcon ? { icon_custom_emoji_id: existingIcon } : {}),
            };
          })
        : rawRow,
    ),
  };
}

/** Creates one generated header; authored HTML is never searched or rewritten. */
export function brandedHeader(accent: keyof typeof CARTEL_CUSTOM_EMOJI = "energy"): string {
  const selected = CARTEL_CUSTOM_EMOJI[accent];
  return `<tg-emoji emoji-id="${selected.id}">${selected.emoji}</tg-emoji> <b>PEPECARTEL · CARTEL HQ</b>`;
}

export function presentHtmlText(text: string, context: TelegramPresentationContext = "authored"): string {
  if (!text || context !== "platform" || text.startsWith("<tg-emoji")) return text;
  return `${brandedHeader()}\n\n${text}`;
}

/**
 * Applies presentation without changing delivery semantics. Plain/frozen text
 * stays byte-identical; HTML gets one animated accent and keyboards get native
 * Bot API styles plus validated custom-emoji icons.
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
  if (next.reply_markup) next.reply_markup = presentInlineKeyboard(next.reply_markup);
  if (context === "platform" && next.parse_mode === "HTML") {
    if (typeof next.text === "string") next.text = presentHtmlText(next.text, context);
    if (typeof next.caption === "string") next.caption = presentHtmlText(next.caption, context);
  }
  return next;
}