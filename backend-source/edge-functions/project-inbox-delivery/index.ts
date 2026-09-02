import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * C7.3D D1 — Durable Project Inbox team-reply delivery worker.
 *
 * SOURCE ONLY in D1: this function is deliberately NOT deployed and NOT
 * scheduled in this phase. It is committed so the delivery contract can be
 * reviewed before anything can ever talk to Telegram.
 *
 * Design rules:
 *  - Invoked by a scheduler with a dedicated custom secret header
 *    (verify_jwt=false). The secret is only ever compared inside the database.
 *  - It sends the FROZEN body snapshot captured when the operator pressed
 *    send. Live message text is never re-read, so an edited row can never
 *    change what a member already received.
 *  - Deliveries are processed strictly one at a time. The claim RPC already
 *    refuses to hand out a reply while an earlier reply in the same
 *    conversation is unresolved, so ordering is preserved.
 *  - Outcomes are explicit: sent / retry / failed / ambiguous. A network or
 *    timeout failure is AMBIGUOUS, never retried, because Telegram may have
 *    already delivered it. Only the operator resolves ambiguity.
 *  - It never reads or writes conversation status directly; the finalize RPC
 *    owns that transition.
 */

const TG_BASE = "https://api.telegram.org";
const CLAIM_LIMIT = 25;
const SEND_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const MAX_RETRY_AFTER_SECONDS = 3600;

type ClaimedDelivery = {
  delivery_id: string;
  conversation_id: string;
  message_id: string;
  workspace_id: string;
  team_user_id: string;
  telegram_user_id: number | string;
  body_snapshot: string;
  attempt_count: number;
  contact_blocked: boolean;
  replies_enabled: boolean;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Sends one plain-text DM. Raw Telegram bodies are never returned upstream. */
async function sendMessage(token: string, chatId: string, text: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { payload = null; }
    return {
      httpStatus: response.status,
      ok: payload?.ok === true,
      messageId: Number(payload?.result?.message_id) || 0,
      description: typeof payload?.description === "string" ? payload.description : "",
      retryAfter: Number(payload?.parameters?.retry_after) || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ error: "NOT_CONFIGURED" }, 500);
  }

  const providedSecret = request.headers.get("x-cartel-inbox-delivery-scheduler-secret") ?? "";
  if (!providedSecret) return json({ error: "UNAUTHORIZED" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretOk, error: secretError } = await admin.rpc(
    "project_inbox_delivery_scheduler_secret_matches",
    { p_secret: providedSecret },
  );
  if (secretError || secretOk !== true) return json({ error: "UNAUTHORIZED" }, 401);

  // Stale claims become ambiguous BEFORE new work is claimed, so an
  // interrupted run never leaves a reply stuck in `processing`.
  const { error: staleError } = await admin.rpc("mark_stale_project_inbox_delivery_claims");
  if (staleError) {
    console.error("[project-inbox-delivery] stale maintenance failed");
    return json({ error: "MAINTENANCE_FAILED" }, 500);
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_project_inbox_deliveries",
    { _limit: CLAIM_LIMIT },
  );
  if (claimError) {
    console.error("[project-inbox-delivery] claim failed");
    return json({ error: "CLAIM_FAILED" }, 500);
  }

  const deliveries = (claimed ?? []) as ClaimedDelivery[];
  let sent = 0;
  let retry = 0;
  let failed = 0;
  let ambiguous = 0;

  for (const delivery of deliveries) {
    const attempt = Number(delivery.attempt_count) || 1;
    const backoff = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)]!;

    type Desired =
      | { kind: "sent"; telegramMessageId: number }
      | { kind: "retry"; seconds: number; errorClass: string; message: string }
      | { kind: "failed"; errorClass: string; message: string }
      | { kind: "ambiguous"; errorClass: string; message: string };
    let desired: Desired;

    // Authorization is revalidated at delivery time, not only at send time.
    if (delivery.contact_blocked) {
      desired = {
        kind: "failed",
        errorClass: "contact_blocked",
        message: "The member was blocked before this reply was delivered.",
      };
    } else if (!delivery.replies_enabled) {
      desired = {
        kind: "failed",
        errorClass: "replies_disabled",
        message: "Reply capture was turned off before this reply was delivered.",
      };
    } else {
      try {
        const result = await sendMessage(
          TELEGRAM_BOT_TOKEN,
          String(delivery.telegram_user_id),
          delivery.body_snapshot,
        );

        if (result.ok && result.messageId > 0) {
          desired = { kind: "sent", telegramMessageId: result.messageId };
        } else if (result.ok) {
          // Accepted but unusable confirmation: do not claim delivery.
          desired = {
            kind: "ambiguous",
            errorClass: "unconfirmed_send",
            message: "Telegram accepted the send without a usable confirmation.",
          };
        } else if (result.httpStatus === 429) {
          const wait = Math.min(Math.max(result.retryAfter || backoff, 1), MAX_RETRY_AFTER_SECONDS);
          desired = attempt >= MAX_ATTEMPTS
            ? { kind: "failed", errorClass: "rate_limited", message: "Telegram rate limit persisted across attempts." }
            : { kind: "retry", seconds: wait, errorClass: "rate_limited", message: "Telegram rate limited this reply." };
        } else if (result.httpStatus >= 500) {
          // A 5xx may or may not have been applied — never blindly resend.
          desired = {
            kind: "ambiguous",
            errorClass: "telegram_server_error",
            message: "Telegram returned a server error; delivery is unconfirmed.",
          };
        } else {
          desired = {
            kind: "failed",
            errorClass: "telegram_rejected",
            message: "Telegram rejected this reply.",
          };
        }
      } catch (_e) {
        // Network/timeout: the send may have landed. Ambiguous, never retried.
        desired = {
          kind: "ambiguous",
          errorClass: "network_error",
          message: "Telegram was unreachable or timed out; delivery is unconfirmed.",
        };
      }
    }

    // Persist exactly that outcome, once, through the single finalize RPC.
    // A failure here leaves the row in `processing`, which the next run's
    // stale maintenance converts to ambiguous — never to a silent resend.
    const { error: finalizeError } = await admin.rpc("finalize_project_inbox_delivery", {
      _delivery_id: delivery.delivery_id,
      _outcome: desired.kind,
      _telegram_message_id: desired.kind === "sent" ? desired.telegramMessageId : null,
      _error_class: desired.kind === "sent" ? null : desired.errorClass,
      _last_error: desired.kind === "sent" ? null : desired.message,
      _retry_after_seconds: desired.kind === "retry" ? desired.seconds : null,
    });
    if (finalizeError) {
      console.error("[project-inbox-delivery] finalize failed");
      continue;
    }

    if (desired.kind === "sent") sent += 1;
    else if (desired.kind === "retry") retry += 1;
    else if (desired.kind === "failed") failed += 1;
    else ambiguous += 1;
  }

  return json({ claimed: deliveries.length, sent, retry, failed, ambiguous });
});
