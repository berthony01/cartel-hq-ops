import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Phase 5.2 — Durable Telegram message cleanup worker.
 *
 * Public group Launch Watch cards live for 5–60 minutes. An Edge Function
 * cannot stay alive that long, so the producing functions queue a durable
 * cleanup job and this dedicated worker deletes the message when it is due.
 *
 * It is invoked by a scheduler with a custom secret header (verify_jwt=false)
 * and trusts nothing else. It only claims cleanup jobs and records the
 * outcome — it never touches subscriptions, launches or notifications.
 * Deleting an already-deleted message is a success, so retries are idempotent.
 */

const TG_BASE = "https://api.telegram.org";
const CLAIM_LIMIT = 50;
const DELETE_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const MAX_RETRY_AFTER_SECONDS = 3600;

type ClaimedJob = {
  job_id: string;
  telegram_chat_id: number | string;
  telegram_message_id: number | string;
  attempt_count: number;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Deletes one message. Never returns raw Telegram bodies to the caller. */
async function deleteMessage(token: string, chatId: string, messageId: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    const response = await fetch(`${TG_BASE}/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      signal: controller.signal,
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { payload = null; }
    return {
      httpStatus: response.status,
      ok: payload?.ok === true,
      description: typeof payload?.description === "string" ? payload.description : "",
      retryAfter: Number(payload?.parameters?.retry_after) || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Telegram's wording for a message that is already gone or unreachable. */
function alreadyGone(description: string) {
  const text = description.toLowerCase();
  return text.includes("message to delete not found")
    || text.includes("message can't be deleted")
    || text.includes("message identifier is not specified")
    || text.includes("message is not found");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ error: "NOT_CONFIGURED" }, 500);
  }

  const providedSecret = request.headers.get("x-cartel-cleanup-scheduler-secret") ?? "";
  if (!providedSecret) return json({ error: "UNAUTHORIZED" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The secret itself is only ever compared inside the database.
  const { data: secretOk, error: secretError } = await admin.rpc(
    "telegram_message_cleanup_scheduler_secret_matches",
    { p_secret: providedSecret },
  );
  if (secretError || secretOk !== true) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_telegram_message_cleanup_jobs",
    { _limit: CLAIM_LIMIT },
  );
  if (claimError) {
    console.error("[telegram-message-cleanup] claim failed");
    return json({ error: "CLAIM_FAILED" }, 500);
  }

  const jobs = (claimed ?? []) as ClaimedJob[];
  let deleted = 0;
  let retry = 0;
  let failed = 0;

  for (const job of jobs) {
    const chatId = String(job.telegram_chat_id);
    const messageId = Number(job.telegram_message_id);
    const attempt = Number(job.attempt_count) || 1;

    const markDeleted = async () => {
      await admin.from("telegram_message_cleanup_jobs").update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
        claimed_at: null,
        error_class: null,
        last_error: null,
      }).eq("id", job.job_id);
      deleted += 1;
    };

    const markRetry = async (seconds: number, errorClass: string, message: string) => {
      await admin.from("telegram_message_cleanup_jobs").update({
        status: "retry",
        claimed_at: null,
        next_attempt_at: new Date(Date.now() + seconds * 1000).toISOString(),
        error_class: errorClass,
        last_error: message,
      }).eq("id", job.job_id);
      retry += 1;
    };

    const markFailed = async (errorClass: string, message: string) => {
      await admin.from("telegram_message_cleanup_jobs").update({
        status: "failed",
        claimed_at: null,
        error_class: errorClass,
        last_error: message,
      }).eq("id", job.job_id);
      failed += 1;
    };

    const backoff = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];

    try {
      const result = await deleteMessage(TELEGRAM_BOT_TOKEN, chatId, messageId);

      if (result.ok || alreadyGone(result.description)) {
        // Already gone counts as success: cleanup is idempotent by design.
        await markDeleted();
      } else if (result.httpStatus === 429) {
        const wait = Math.min(Math.max(result.retryAfter || backoff, 1), MAX_RETRY_AFTER_SECONDS);
        if (attempt >= MAX_ATTEMPTS) await markFailed("rate_limited", "Telegram rate limit persisted across attempts.");
        else await markRetry(wait, "rate_limited", "Telegram rate limited this deletion.");
      } else if (result.httpStatus >= 500) {
        if (attempt >= MAX_ATTEMPTS) await markFailed("telegram_server_error", "Telegram server error persisted across attempts.");
        else await markRetry(backoff, "telegram_server_error", "Telegram returned a server error.");
      } else {
        // Explicit 4xx/403: no blind retry.
        await markFailed("telegram_rejected", "Telegram rejected the deletion request.");
      }
    } catch (_e) {
      // Network/timeout — the outcome is unknown but re-deleting is harmless.
      if (attempt >= MAX_ATTEMPTS) await markFailed("network_error", "Telegram was unreachable across attempts.");
      else await markRetry(backoff, "network_error", "Telegram request failed or timed out.");
    }
  }

  return json({ claimed: jobs.length, deleted, retry, failed });
});
