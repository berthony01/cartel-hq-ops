/**
 * Phase 5.2 — Durable Telegram message cleanup worker (pure request handler).
 *
 * Two lanes share one processor:
 *  - Scheduler lane (cron, once per minute): requires the existing
 *    `x-cartel-cleanup-scheduler-secret`, compared only inside the database.
 *  - Fast lane (Mission Control "Close & clear"): requires the exact
 *    service-role bearer, a valid UUID job id, NO scheduler secret, and a real
 *    `EdgeRuntime.waitUntil` function. It claims exactly one
 *    `mission_control_launcher` job ~5 seconds later; the durable queue + cron
 *    remain the fallback if the fast attempt never runs.
 *
 * For each job the Telegram outcome is classified first (desired state), then
 * persisted exactly once. A database persistence failure is never reclassified
 * as a Telegram network error; the row stays `processing` and the claim RPC
 * reclaims it after its lease.
 */

const TG_BASE = "https://api.telegram.org";
export const CLAIM_LIMIT = 50;
const DELETE_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const MAX_RETRY_AFTER_SECONDS = 3600;
export const FAST_PATH_DELAY_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClaimedJob = {
  job_id: string;
  telegram_chat_id: number | string;
  telegram_message_id: number | string;
  attempt_count: number;
  cleanup_kind?: string;
};

export type CleanupEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
};

export type CleanupDeps = {
  env: CleanupEnv;
  createAdmin: (url: string, key: string) => any;
  fetchImpl?: typeof fetch;
  /** Must be the runtime's real waitUntil; absent => fast lane unavailable. */
  waitUntil?: unknown;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Deletes one message. Never returns raw Telegram bodies to the caller. */
async function deleteMessage(fetchImpl: typeof fetch, token: string, chatId: string, messageId: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${TG_BASE}/bot${token}/deleteMessage`, {
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

/** Only wording that unambiguously means the message no longer exists. */
function alreadyGone(description: string) {
  const text = description.toLowerCase();
  return text.includes("message to delete not found")
    || text.includes("message is not found");
}

type Desired =
  | { kind: "deleted" }
  | { kind: "retry"; seconds: number; errorClass: string; message: string }
  | { kind: "failed"; errorClass: string; message: string };

export async function processJobs(
  admin: any,
  token: string,
  jobs: ClaimedJob[],
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = (m) => console.error(m),
) {
  let deleted = 0;
  let retry = 0;
  let failed = 0;

  for (const job of jobs) {
    const chatId = String(job.telegram_chat_id);
    const messageId = Number(job.telegram_message_id);
    const attempt = Number(job.attempt_count) || 1;
    const backoff = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];

    // Step 1: classify the desired final state from Telegram only.
    let desired: Desired;
    try {
      const result = await deleteMessage(fetchImpl, token, chatId, messageId);
      if (result.ok || alreadyGone(result.description)) {
        desired = { kind: "deleted" };
      } else if (result.httpStatus === 429) {
        const wait = Math.min(Math.max(result.retryAfter || backoff, 1), MAX_RETRY_AFTER_SECONDS);
        desired = attempt >= MAX_ATTEMPTS
          ? { kind: "failed", errorClass: "rate_limited", message: "Telegram rate limit persisted across attempts." }
          : { kind: "retry", seconds: wait, errorClass: "rate_limited", message: "Telegram rate limited this deletion." };
      } else if (result.httpStatus >= 500) {
        desired = attempt >= MAX_ATTEMPTS
          ? { kind: "failed", errorClass: "telegram_server_error", message: "Telegram server error persisted across attempts." }
          : { kind: "retry", seconds: backoff, errorClass: "telegram_server_error", message: "Telegram returned a server error." };
      } else {
        desired = { kind: "failed", errorClass: "telegram_rejected", message: "Telegram rejected the deletion request." };
      }
    } catch {
      desired = attempt >= MAX_ATTEMPTS
        ? { kind: "failed", errorClass: "network_error", message: "Telegram was unreachable across attempts." }
        : { kind: "retry", seconds: backoff, errorClass: "network_error", message: "Telegram request failed or timed out." };
    }

    // Step 2: persist exactly that state, once. No fallback to another status.
    const update = desired.kind === "deleted"
      ? { status: "deleted", deleted_at: new Date().toISOString(), claimed_at: null, error_class: null, last_error: null }
      : desired.kind === "retry"
        ? { status: "retry", claimed_at: null, next_attempt_at: new Date(Date.now() + desired.seconds * 1000).toISOString(), error_class: desired.errorClass, last_error: desired.message }
        : { status: "failed", claimed_at: null, error_class: desired.errorClass, last_error: desired.message };
    try {
      const { error } = await admin.from("telegram_message_cleanup_jobs").update(update).eq("id", job.job_id);
      if (error) throw new Error("cleanup state update failed");
      if (desired.kind === "deleted") deleted += 1;
      else if (desired.kind === "retry") retry += 1;
      else failed += 1;
    } catch {
      log("[telegram-message-cleanup] cleanup state update failed");
    }
  }
  return { claimed: jobs.length, deleted, retry, failed };
}

export async function handleCleanupRequest(request: Request, deps: CleanupDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN } = deps.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ error: "NOT_CONFIGURED" }, 500);
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? ((m: string) => console.error(m));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const providedSecret = request.headers.get("x-cartel-cleanup-scheduler-secret") ?? "";
  const fastJobHeader = request.headers.get("x-cartel-cleanup-job-id");

  // ---------------- Fast lane ----------------
  if (fastJobHeader !== null) {
    if (providedSecret) return json({ error: "UNAUTHORIZED" }, 401);
    const bearer = request.headers.get("authorization") ?? "";
    if (bearer !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return json({ error: "UNAUTHORIZED" }, 401);
    const fastJobId = fastJobHeader.trim();
    if (!UUID.test(fastJobId)) return json({ error: "INVALID_JOB" }, 400);
    if (typeof deps.waitUntil !== "function") return json({ error: "FAST_PATH_UNAVAILABLE" }, 503);
    const waitUntil = deps.waitUntil as (p: Promise<unknown>) => void;

    const admin = deps.createAdmin(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const delayed = sleep(FAST_PATH_DELAY_MS).then(async () => {
      const { data, error } = await admin.rpc("claim_mission_control_launcher_cleanup_job", { _job_id: fastJobId });
      const jobs = (data ?? []) as ClaimedJob[];
      // Not claimable (already done, not yet due, wrong kind): cron remains the fallback.
      if (error || jobs.length !== 1 || jobs[0]?.cleanup_kind !== "mission_control_launcher") return;
      await processJobs(admin, TELEGRAM_BOT_TOKEN, jobs, fetchImpl, log);
    }).catch(() => log("[telegram-message-cleanup] fast cleanup failed"));
    try { waitUntil(delayed); } catch { return json({ error: "FAST_PATH_UNAVAILABLE" }, 503); }
    return json({ accepted: true }, 202);
  }

  // ---------------- Scheduler lane ----------------
  if (!providedSecret) return json({ error: "UNAUTHORIZED" }, 401);
  const admin = deps.createAdmin(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
    log("[telegram-message-cleanup] claim failed");
    return json({ error: "CLAIM_FAILED" }, 500);
  }
  return json(await processJobs(admin, TELEGRAM_BOT_TOKEN, (claimed ?? []) as ClaimedJob[], fetchImpl, log));
}
