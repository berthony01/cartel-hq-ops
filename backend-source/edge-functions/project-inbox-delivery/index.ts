import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * C7.3D — Durable Project Inbox team-reply delivery worker.
 *
 * DEPLOYED and ACTIVE. This Edge Function is scheduled every minute by the
 * cron job `cartel-project-inbox-delivery-runner`. The cron invokes
 * `public.invoke_project_inbox_delivery_scheduler()`, a database helper that
 * reads the dedicated scheduler secret from Vault and POSTs to this function
 * with the `x-cartel-inbox-scheduler-secret` header.
 *
 * `verify_jwt=false` is intentional: this worker authenticates using that
 * custom scheduler secret, which is compared inside the database.
 *
 * Design rules:
 *  - Invoked by a scheduler with a dedicated custom secret header
 *    (verify_jwt=false). The secret is only ever compared inside the database.
 *  - It sends the FROZEN `delivered_text_snapshot` captured when the operator
 *    pressed send. Live message text is never re-read, so an edited row can
 *    never change what a member already received.
 *  - Authorization, contact identity and message identity are revalidated
 *    against CURRENT state immediately before Telegram is contacted. Any
 *    mismatch is a definite failure with no send attempt.
 *  - Deliveries are processed strictly one at a time. The claim RPC already
 *    refuses to hand out a reply while an earlier reply in the same
 *    conversation is unresolved, so ordering is preserved.
 *  - Outcomes are explicit: sent / retry / failed / ambiguous. A network,
 *    timeout or unparseable response is AMBIGUOUS, never retried, because
 *    Telegram may already have delivered it. Only the operator resolves it.
 *  - It never writes conversation status directly; the finalize RPC owns it.
 */

const TG_BASE = "https://api.telegram.org";
const CLAIM_LIMIT = 25;
const SEND_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_SECONDS = [60, 300, 900];
const MAX_RETRY_AFTER_SECONDS = 3600;
const MAX_DELIVERED_TEXT = 4096;

type ClaimedDelivery = {
  delivery_id: string;
  conversation_id: string;
  message_id: string;
  telegram_user_id: number | string;
  delivered_text_snapshot: string;
  attempt_count: number;
  workspace_id: string;
  team_user_id: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type SendResult =
  | {
      parsed: true;
      httpStatus: number;
      ok: boolean;
      messageId: number;
      retryAfter: number;
    }
  | { parsed: false };

/** Sends one plain-text DM. Raw Telegram bodies are never returned upstream. */
async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<SendResult> {
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
    try {
      payload = await response.json();
    } catch {
      return { parsed: false };
    }
    if (payload == null || typeof payload !== "object" || typeof payload.ok !== "boolean") {
      return { parsed: false };
    }
    return {
      parsed: true,
      httpStatus: response.status,
      ok: payload.ok === true,
      messageId: Number(payload?.result?.message_id) || 0,
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

  const providedSecret = request.headers.get("x-cartel-inbox-scheduler-secret") ?? "";
  if (!providedSecret) return json({ error: "FORBIDDEN" }, 403);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretOk, error: secretError } = await admin.rpc(
    "project_inbox_delivery_scheduler_secret_matches",
    { p_secret: providedSecret },
  );
  if (secretError || secretOk !== true) return json({ error: "FORBIDDEN" }, 403);

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
    let desired: Desired | null = null;

    const text = delivery.delivered_text_snapshot ?? "";
    if (text.trim().length === 0 || text.length > MAX_DELIVERED_TEXT) {
      desired = {
        kind: "failed",
        errorClass: "invalid_snapshot",
        message: "The frozen reply text is missing or invalid.",
      };
    }

    // ------------------------------------------------ revalidate CURRENT state
    if (desired === null) {
      try {
        const [operatorRes, conversationRes, contactRes, messageRes] = await Promise.all([
          admin.rpc("is_workspace_operator", {
            _workspace_id: delivery.workspace_id,
            _user_id: delivery.team_user_id,
          }),
          admin
            .from("project_conversations")
            .select("id, contact_id, workspace_id")
            .eq("id", delivery.conversation_id)
            .eq("workspace_id", delivery.workspace_id)
            .maybeSingle(),
          admin
            .from("project_inbox_contacts")
            .select("id, workspace_id, status, telegram_user_id")
            .eq("workspace_id", delivery.workspace_id)
            .eq("telegram_user_id", delivery.telegram_user_id)
            .maybeSingle(),
          admin
            .from("project_conversation_messages")
            .select("id, conversation_id, author_type, channel, team_user_id")
            .eq("id", delivery.message_id)
            .maybeSingle(),
        ]);

        const dbError =
          operatorRes.error || conversationRes.error || contactRes.error || messageRes.error;
        if (dbError) throw dbError;

        const conversation = conversationRes.data as
          | { id: string; contact_id: string; workspace_id: string }
          | null;
        const contact = contactRes.data as
          | { id: string; workspace_id: string; status: string; telegram_user_id: number | string }
          | null;
        const message = messageRes.data as
          | {
              id: string;
              conversation_id: string;
              author_type: string;
              channel: string;
              team_user_id: string | null;
            }
          | null;

        if (operatorRes.data !== true) {
          desired = {
            kind: "failed",
            errorClass: "operator_revoked",
            message: "The sending operator no longer has permission in this workspace.",
          };
        } else if (!conversation) {
          desired = {
            kind: "failed",
            errorClass: "conversation_missing",
            message: "The conversation no longer exists in this workspace.",
          };
        } else if (
          !contact ||
          contact.status !== "ACTIVE" ||
          contact.id !== conversation.contact_id ||
          String(contact.telegram_user_id) !== String(delivery.telegram_user_id)
        ) {
          desired = {
            kind: "failed",
            errorClass: "contact_unavailable",
            message: "The member is blocked, missing or no longer matches this conversation.",
          };
        } else if (
          !message ||
          message.conversation_id !== delivery.conversation_id ||
          message.author_type !== "TEAM" ||
          // C7.3: a team reply may legitimately originate from the web inbox
          // ('WEB') or from the team-side Telegram bot console ('TELEGRAM').
          (message.channel !== "WEB" && message.channel !== "TELEGRAM") ||
          message.team_user_id !== delivery.team_user_id
        ) {
          desired = {
            kind: "failed",
            errorClass: "message_mismatch",
            message: "The queued reply no longer matches its conversation message.",
          };
        }
      } catch (_e) {
        // Transient database problem BEFORE any Telegram contact: nothing was
        // sent, so a bounded retry is safe while attempts remain.
        desired =
          attempt < MAX_ATTEMPTS
            ? {
                kind: "retry",
                seconds: backoff,
                errorClass: "revalidation_unavailable",
                message: "Delivery pre-checks could not be completed.",
              }
            : {
                kind: "failed",
                errorClass: "revalidation_unavailable",
                message: "Delivery pre-checks kept failing.",
              };
      }
    }

    // ------------------------------------------------------------ send attempt
    if (desired === null) {
      try {
        const result = await sendMessage(
          TELEGRAM_BOT_TOKEN,
          String(delivery.telegram_user_id),
          text,
        );

        if (!result.parsed) {
          desired = {
            kind: "ambiguous",
            errorClass: "unparseable_response",
            message: "Telegram returned an unreadable response; delivery is unconfirmed.",
          };
        } else if (result.ok && result.messageId > 0) {
          desired = { kind: "sent", telegramMessageId: result.messageId };
        } else if (result.ok) {
          desired = {
            kind: "ambiguous",
            errorClass: "unconfirmed_send",
            message: "Telegram accepted the send without a usable confirmation.",
          };
        } else if (result.httpStatus === 429) {
          const wait = Math.min(
            Math.max((result.retryAfter || backoff) + 5, 5),
            MAX_RETRY_AFTER_SECONDS,
          );
          desired =
            attempt >= MAX_ATTEMPTS
              ? {
                  kind: "failed",
                  errorClass: "rate_limited",
                  message: "Telegram rate limit persisted across attempts.",
                }
              : {
                  kind: "retry",
                  seconds: wait,
                  errorClass: "rate_limited",
                  message: "Telegram rate limited this reply.",
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
    const nextAttemptAt =
      desired.kind === "retry"
        ? new Date(Date.now() + desired.seconds * 1000).toISOString()
        : null;
    const { error: finalizeError } = await admin.rpc("finalize_project_inbox_delivery", {
      _delivery_id: delivery.delivery_id,
      _outcome: desired.kind,
      _telegram_message_id: desired.kind === "sent" ? desired.telegramMessageId : null,
      _next_attempt_at: nextAttemptAt,
      _error_class: desired.kind === "sent" ? null : desired.errorClass,
      _last_error: desired.kind === "sent" ? null : desired.message,
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
