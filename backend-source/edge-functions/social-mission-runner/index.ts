/**
 * SE-4B — `social-mission-runner`.
 *
 * REPOSITORY SOURCE PARITY COPY. Lovable never deploys this function; the
 * authoritative deployment is performed externally against the Supabase
 * project `ocoinbnjgstkmnwwvnhi` with `verify_jwt=false`.
 *
 * Why verify_jwt=false: this worker is cron-only. It is never called by a
 * browser and carries no user session. Authentication is the dedicated
 * scheduler secret header, compared ONLY inside the database through
 * `social_mission_scheduler_secret_matches`. The secret is never logged and
 * never returned in a response body. This is the same model as the existing
 * `telegram-message-cleanup` worker.
 *
 * Frozen behaviour:
 *   * ZERO X / provider calls. ZERO metric reads. No usage ledger.
 *   * PULSE  — exactly one `sendMessage`, replying to the canonical mission
 *              card, with an OPEN ON X button built from the authoritative
 *              `social_posts.canonical_url`. Never `sendPhoto`, never a
 *              resend of the branded card. A confirmed pulse is queued into
 *              the EXISTING `telegram_message_cleanup_jobs` table with
 *              `cleanup_kind='social_mission_pulse'` and
 *              `delete_after = sent_at + 120 seconds`. The cleanup worker
 *              itself is untouched.
 *   * COMPLETE — the mission is ALREADY COMPLETED in the database by the claim
 *              RPC. This worker then makes exactly ONE idempotent
 *              `edit_mission` call against the existing transport using the
 *              stored `client_request_id`. A failed or ambiguous edit NEVER
 *              reverts completion and NEVER sends a replacement message.
 *   * No retries. An ambiguous outcome is recorded as AMBIGUOUS and is
 *              terminal; losing an ephemeral pulse is safer than duplicate
 *              spam.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SCHEDULER_HEADER = "x-cartel-social-mission-scheduler-secret";
const TELEGRAM_API = "https://api.telegram.org";
const PULSE_LIFETIME_SECONDS = 120;
const CLAIM_LIMIT = 25;
const TELEGRAM_TIMEOUT_MS = 10_000;
const TRANSPORT_TIMEOUT_MS = 20_000;

/** This worker is one of the two exact internal callers of the transport. */
const INTERNAL_SOURCE_HEADER_VALUE = "social-mission-runner";

type ClaimedEvent = {
  event_id: string;
  event_type: "PULSE" | "COMPLETE";
  sequence_no: number;
  workspace_id: string;
  mission_id: string;
  target_id: string;
  client_request_id: string;
  edit_revision: number;
  telegram_chat_id: number;
  telegram_message_id: number | null;
  group_connection_id: string;
  mission_created_by: string | null;
  canonical_url: string | null;
};

type TelegramOutcome =
  | { kind: "ok"; messageId: number | null }
  | { kind: "rejected"; description: string }
  | { kind: "uncertain"; description: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Narrow, pure validator. The OPEN ON X button is only ever built from a
 * canonical public X/Twitter status URL. Arbitrary HTTPS links, credentials,
 * explicit ports and non-status paths are all refused, and no network call is
 * made. An invalid URL simply means no button.
 */
const PULSE_X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];

export function isCanonicalXStatusUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  if (!PULSE_X_HOSTS.includes(url.hostname.toLowerCase())) return false;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) return false;
  const handle = String(segments[0]).toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || handle === "i") return false;
  if (String(segments[1]).toLowerCase() !== "status") return false;
  return /^[0-9]{1,32}$/.test(String(segments[2]));
}

/**
 * Pulse copy. Short, factual, and about natural participation only. No
 * quotas, points, rewards, streaks, counts or mandatory likes/reposts, and no
 * claim about what the post will do.
 */
export const PULSE_TEXT =
  "This Social Mission is still active. Read the official post above and join the conversation naturally if you have something to add.";

export function pulseKeyboard(canonicalUrl: unknown) {
  return isCanonicalXStatusUrl(canonicalUrl)
    ? { inline_keyboard: [[{ text: "OPEN ON X", url: String(canonicalUrl).trim() }]] }
    : null;
}

async function callTelegram(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramOutcome> {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch {
    // Transport-level uncertainty: Telegram may or may not have acted.
    return { kind: "uncertain", description: "Telegram did not answer in time." };
  }

  // 429 and 5xx are never definite: the message may still have been delivered.
  if (response.status === 429 || response.status >= 500) {
    return { kind: "uncertain", description: `Telegram responded ${response.status}.` };
  }

  let body: { ok?: boolean; description?: string; result?: { message_id?: number } } | null = null;
  try {
    body = await response.json();
  } catch {
    return { kind: "uncertain", description: "Telegram returned an unreadable response." };
  }

  if (body?.ok === true) {
    const messageId = typeof body.result?.message_id === "number" ? body.result.message_id : null;
    return { kind: "ok", messageId };
  }
  if (body?.ok === false) {
    return { kind: "rejected", description: String(body.description ?? "Telegram rejected the request.") };
  }
  return { kind: "uncertain", description: "Telegram returned an inconclusive response." };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !BOT_TOKEN) {
    return json({ error: "Runner is not configured." }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // The secret is compared only inside the database and never echoed back.
  const presented = request.headers.get(SCHEDULER_HEADER) ?? "";
  const { data: secretOk, error: secretError } = await admin.rpc(
    "social_mission_scheduler_secret_matches",
    { p_secret: presented },
  );
  if (secretError || secretOk !== true) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_due_social_mission_schedule_events",
    { _limit: CLAIM_LIMIT },
  );
  if (claimError) {
    return json({ error: "Could not claim due schedule events." }, 500);
  }

  const events = (claimed ?? []) as ClaimedEvent[];
  let pulsesSent = 0;
  let completionsEdited = 0;
  let unresolved = 0;
  let failed = 0;

  for (const event of events) {
    if (event.event_type === "PULSE") {
      if (event.telegram_message_id === null) {
        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "FAILED",
          _telegram_message_id: null,
          _last_error: "The canonical mission message id is missing.",
        });
        failed += 1;
        continue;
      }

      const keyboard = pulseKeyboard(event.canonical_url);
      // Exactly ONE sendMessage. Never sendPhoto, never the branded card.
      const outcome = await callTelegram(BOT_TOKEN, "sendMessage", {
        chat_id: event.telegram_chat_id,
        text: PULSE_TEXT,
        // No allow_sending_without_reply: a pulse is meaningful ONLY as a
        // reply to the canonical mission card. If that card is gone, Telegram
        // rejects the send and the event is finalized FAILED rather than
        // posting an orphan reminder.
        reply_to_message_id: event.telegram_message_id,
        disable_web_page_preview: true,
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });

      if (outcome.kind === "ok" && outcome.messageId !== null) {
        const deleteAfter = new Date(Date.now() + PULSE_LIFETIME_SECONDS * 1000).toISOString();
        const { error: cleanupError } = await admin.from("telegram_message_cleanup_jobs").insert({
          workspace_id: event.workspace_id,
          group_connection_id: event.group_connection_id,
          telegram_chat_id: event.telegram_chat_id,
          telegram_message_id: outcome.messageId,
          cleanup_kind: "social_mission_pulse",
          delete_after: deleteAfter,
          next_attempt_at: deleteAfter,
        });

        if (cleanupError) {
          // A pulse with no durable expiry path is removed immediately. One
          // attempt only, and never a replacement message.
          await callTelegram(BOT_TOKEN, "deleteMessage", {
            chat_id: event.telegram_chat_id,
            message_id: outcome.messageId,
          });
        }

        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "SENT",
          _telegram_message_id: outcome.messageId,
          _last_error: cleanupError ? "Pulse cleanup could not be scheduled; the pulse was deleted." : null,
        });
        pulsesSent += 1;
        continue;
      }

      if (outcome.kind === "rejected") {
        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "FAILED",
          _telegram_message_id: null,
          _last_error: outcome.description.slice(0, 1000),
        });
        failed += 1;
        continue;
      }

      // Uncertain, or an ok response with no message id: never retried.
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "AMBIGUOUS",
        _telegram_message_id: null,
        _last_error: (outcome.kind === "uncertain" ? outcome.description : "Telegram confirmed no message id.").slice(0, 1000),
      });
      unresolved += 1;
      continue;
    }

    // COMPLETE. The mission is ALREADY COMPLETED in the database; this is the
    // single same-message edit attempt and it can never revert completion.
    if (!event.mission_created_by || event.telegram_message_id === null) {
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "FAILED",
        _telegram_message_id: null,
        _last_error: "The completion edit has no actor or no canonical message.",
      });
      failed += 1;
      continue;
    }

    let transport: { editState?: string; message?: string } | null = null;
    let transportStatus = 0;
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/social-mission-telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "X-Cartel-Internal-Source": INTERNAL_SOURCE_HEADER_VALUE,
          "X-Cartel-Actor-User-Id": event.mission_created_by,
        },
        body: JSON.stringify({
          action: "edit_mission",
          workspaceId: event.workspace_id,
          missionId: event.mission_id,
          targetId: event.target_id,
          clientRequestId: event.client_request_id,
          revision: Number(event.edit_revision ?? 0) + 1,
        }),
        signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
      });
      transportStatus = response.status;
      transport = (await response.json().catch(() => null)) as typeof transport;
    } catch {
      transport = null;
    }

    const editState = String(transport?.editState ?? "");
    if (editState === "EDITED") {
      // A duplicate request id replays the recorded EDITED outcome: success.
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "SENT",
        _telegram_message_id: null,
        _last_error: null,
      });
      completionsEdited += 1;
      continue;
    }

    if (editState === "FAILED") {
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "FAILED",
        _telegram_message_id: null,
        _last_error: String(transport?.message ?? "The completion edit was rejected.").slice(0, 1000),
      });
      failed += 1;
      continue;
    }

    await admin.rpc("finish_social_mission_schedule_event", {
      _event_id: event.event_id,
      _state: "AMBIGUOUS",
      _telegram_message_id: null,
      _last_error: String(
        transport?.message ?? `The completion edit is unresolved (status ${transportStatus}).`,
      ).slice(0, 1000),
    });
    unresolved += 1;
  }

  return json({
    ok: true,
    claimed: events.length,
    pulsesSent,
    completionsEdited,
    unresolved,
    failed,
  });
});
