/**
 * SE-16.0 — Telegram Mini App auth primitives (server-only).
 *
 * This module is the MANDATORY first gate of the Mini App bridge: Mini App
 * users have no Supabase JWT, so the only trusted identity is the Telegram
 * `initData` signature produced with the bot token.
 *
 * Official bot-token HMAC algorithm (Telegram Mini Apps — "Validating data
 * received via the Mini App"):
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)   // raw bytes
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * `data_check_string` is every received field EXCEPT `hash`, sorted
 * alphabetically and joined with "\n" as `key=value`.
 *
 * `signature` is deliberately KEPT inside the data-check-string: only
 * Telegram's separate Ed25519 third-party algorithm excludes both `hash` and
 * `signature`. SE-16.0 uses the bot-token HMAC path.
 *
 * Secrets: the bot token is passed in by the caller from per-request server
 * env. It is never returned, never embedded in a result, and never logged.
 * `initDataUnsafe`, or any separately supplied Telegram user id, is NEVER an
 * authorization input.
 */

/** Only `hash` is removed from the bot-token HMAC data-check-string. */
export const INIT_DATA_HMAC_EXCLUDED_FIELDS = ["hash"] as const;

/** Keys that must never appear more than once in a signed payload. */
export const INIT_DATA_CRITICAL_KEYS = ["hash", "auth_date", "user"] as const;

/** Default freshness window for `auth_date`. */
export const INIT_DATA_MAX_AGE_SECONDS = 15 * 60;

/** Tolerated clock skew for an `auth_date` in the future. */
export const INIT_DATA_FUTURE_SKEW_SECONDS = 60;

/** Hard bound so an oversized body can never be parsed or hashed. */
export const INIT_DATA_MAX_LENGTH = 4096;

export type TelegramInitDataUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  languageCode: string;
  isPremium: boolean;
};

export type InitDataFailureReason =
  | "missing_bot_token"
  | "missing_init_data"
  | "init_data_too_large"
  | "malformed_init_data"
  | "duplicate_field"
  | "missing_hash"
  | "missing_auth_date"
  | "invalid_auth_date"
  | "missing_user"
  | "malformed_user"
  | "invalid_user_id"
  | "stale_auth_date"
  | "future_auth_date"
  | "bad_signature";

export type InitDataResult =
  | {
      ok: true;
      user: TelegramInitDataUser;
      authDate: number;
      /**
       * `start_param` from the SIGNED payload (covered by the HMAC above).
       * "absent" = ordinary launch; "invalid" = present but duplicated,
       * oversized or illegal (callers must refuse, never treat as ordinary).
       * A routing hint only — it never grants authority by itself.
       */
      startParam: StartParamState;
    }
  | { ok: false; reason: InitDataFailureReason };

export type StartParamState =
  | { state: "absent" }
  | { state: "valid"; value: string }
  | { state: "invalid" };

/** Telegram `startapp` payloads: up to 512 chars of A-Z a-z 0-9 _ -. */
export const START_PARAM_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** `mc_<connection UUID>[_<opaque close token>]` -> bounded routing parts. */
const MISSION_CONTROL_START_PARAM =
  /^mc_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_([A-Za-z0-9_-]{22,64}))?$/i;
const MISSION_SETUP_START_PARAM =
  /^ms_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_([A-Za-z0-9_-]{22,64}))?$/i;
export function parseMissionControlStartParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(MISSION_CONTROL_START_PARAM);
  return match ? match[1]!.toLowerCase() : null;
}

export function parseMissionControlCloseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(MISSION_CONTROL_START_PARAM);
  return match?.[2] ?? null;
}

export function parseMissionSetupStartParam(value: unknown): {
  candidateId: string;
  connectionId: string;
  closeToken: string | null;
} | null {
  if (typeof value !== "string") return null;
  const match = value.match(MISSION_SETUP_START_PARAM);
  if (!match) return null;
  return {
    candidateId: match[1]!.toLowerCase(),
    connectionId: match[2]!.toLowerCase(),
    closeToken: match[3] ?? null,
  };
}

/**
 * Length- and value-independent comparison of two hex digests.
 *
 * A naive `===` on a secret-derived hash short-circuits at the first differing
 * character and leaks position information, so it is never used here.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array | string,
  data: string,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const rawKey = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

/** Bot-token HMAC data-check-string: everything except `hash`, sorted, "\n"-joined. */
export function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if ((INIT_DATA_HMAC_EXCLUDED_FIELDS as readonly string[]).includes(key)) continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  return pairs.join("\n");
}

/** Computes the official bot-token initData hash for a data-check-string. */
export async function computeInitDataHash(
  dataCheckString: string,
  botToken: string,
): Promise<string> {
  // Secret key is the RAW HMAC output, not its hex encoding.
  const secret = await hmacSha256("WebAppData", botToken);
  return toHex(await hmacSha256(secret, dataCheckString));
}

/** Validates raw `Telegram.WebApp.initData`. Returns a bounded typed result only. */
export async function validateTelegramInitData(
  initData: unknown,
  botToken: string,
  options: { now?: number; maxAgeSeconds?: number; futureSkewSeconds?: number } = {},
): Promise<InitDataResult> {
  if (!botToken) return { ok: false, reason: "missing_bot_token" };
  if (typeof initData !== "string" || initData.length === 0) {
    return { ok: false, reason: "missing_init_data" };
  }
  if (initData.length > INIT_DATA_MAX_LENGTH) {
    return { ok: false, reason: "init_data_too_large" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "malformed_init_data" };
  }

  // A duplicated security-critical key is rejected outright rather than
  // silently resolving to the first or last occurrence.
  for (const key of INIT_DATA_CRITICAL_KEYS) {
    if (params.getAll(key).length > 1) return { ok: false, reason: "duplicate_field" };
  }

  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "missing_hash" };

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { ok: false, reason: "missing_auth_date" };
  if (!/^[0-9]{1,15}$/.test(authDateRaw)) return { ok: false, reason: "invalid_auth_date" };
  const authDate = Number(authDateRaw);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return { ok: false, reason: "invalid_auth_date" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing_user" };
  let parsedUser: Record<string, unknown>;
  try {
    const candidate = JSON.parse(userRaw) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, reason: "malformed_user" };
    }
    parsedUser = candidate as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed_user" };
  }
  // Telegram ids can exceed 32 bits but stay inside 52 significant bits, so a
  // safe-integer test is the correct bound.
  const userId = Number(parsedUser["id"]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false, reason: "invalid_user_id" };
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const maxAge = options.maxAgeSeconds ?? INIT_DATA_MAX_AGE_SECONDS;
  const skew = options.futureSkewSeconds ?? INIT_DATA_FUTURE_SKEW_SECONDS;
  if (authDate > now + skew) return { ok: false, reason: "future_auth_date" };
  if (now - authDate > maxAge) return { ok: false, reason: "stale_auth_date" };

  const expected = await computeInitDataHash(buildDataCheckString(params), botToken);
  if (!constantTimeEqualHex(expected, hash)) return { ok: false, reason: "bad_signature" };

  // Read only AFTER the signature check: start_param is part of the signed
  // data-check-string, so a tampered value already failed above.
  const startParams = params.getAll("start_param");
  const startParam: StartParamState =
    startParams.length === 0
      ? { state: "absent" }
      : startParams.length === 1 && START_PARAM_PATTERN.test(startParams[0]!)
        ? { state: "valid", value: startParams[0]! }
        : { state: "invalid" };

  return {
    ok: true,
    authDate,
    startParam,
    user: {
      id: userId,
      firstName: String(parsedUser["first_name"] ?? ""),
      lastName: String(parsedUser["last_name"] ?? ""),
      username: String(parsedUser["username"] ?? ""),
      languageCode: String(parsedUser["language_code"] ?? ""),
      isPremium: parsedUser["is_premium"] === true,
    },
  };
}

/** RFC-4122 shape only; the value itself is client-generated and never trusted as identity. */
export const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Deterministic bounded idempotency key for the existing SE-15 RPC contract.
 *
 * Derived from the VALIDATED Telegram user id, the action and the client
 * request id, so the same retried mutation is absorbed as a replay by the RPC
 * instead of mutating twice or appending a second audit entry.
 */
export async function miniAppIdempotencyKey(
  telegramUserId: number,
  action: string,
  requestId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`se16-miniapp:${telegramUserId}:${action}:${requestId}`),
  );
  return toHex(digest).slice(0, 40);
}

/** Hard timeout around the single Telegram Bot API call this bridge makes. */
export const TELEGRAM_TIMEOUT_MS = 10_000;

/**
 * Bounded server-only `getChatMember`. Parses ONLY the status string; the raw
 * Telegram payload never leaves this function and is never logged. Fails
 * CLOSED on timeout, transport error or any non-ok response.
 */
export async function isCurrentChatAdmin(
  botToken: string,
  chatId: string,
  telegramUserId: number,
): Promise<boolean> {
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: telegramUserId }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const payload = (await res.json().catch(() => null)) as
      | { ok?: unknown; result?: { status?: unknown } }
      | null;
    if (payload?.ok !== true) return false;
    const status = String(payload.result?.status ?? "");
    return status === "administrator" || status === "creator";
  } catch {
    return false;
  }
}
