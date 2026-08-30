import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Phase 5 — Launch notification worker.
 *
 * A dedicated, separate worker from sticker-drops. It is invoked by the
 * scheduler with a custom secret header (verify_jwt = false) and never trusts
 * anything other than that secret. All queue state transitions live in the
 * authoritative external Supabase project; this worker only claims work,
 * revalidates it against CURRENT database state, sends Telegram DMs and
 * records the outcome.
 *
 * Duplicate-DM avoidance is the priority. Telegram cannot guarantee
 * exactly-once delivery, so any uncertain outcome becomes `ambiguous` and is
 * never retried automatically.
 */

const TG_BASE = "https://api.telegram.org";
const CLAIM_LIMIT = 100;
const SEND_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BUFFER_SECONDS = 5;
const REMINDER_OFFSET_MS: Record<string, number> = {
  REMINDER_24H: 24 * 60 * 60 * 1000,
  REMINDER_1H: 60 * 60 * 1000,
};
const SCHEDULE_DRIFT_TOLERANCE_MS = 60_000;
const REMINDER_STALE_MS = 20 * 60 * 1000;

const TRUST_STATEMENT =
  `<b>What "verified" means:</b> this information was supplied by the authenticated Cartel HQ project that controls this launch. ` +
  `It is <b>not</b> a safety audit, token safety verification, rug-proof guarantee or investment endorsement. Always do your own research.`;

const REMINDER_DISCLAIMER =
  `This is a countdown reminder for a launch you chose to watch. It is not a safety check, audit, verification or endorsement of any token.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Formats an instant in the launch timezone, falling back to UTC. */
function formatInZone(iso: string, timeZone: string | null) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const render = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} (${zone})`;
  };
  if (timeZone) {
    try {
      return render(timeZone);
    } catch {
      // fall through to UTC
    }
  }
  return render("UTC");
}

type ClaimRow = {
  delivery_id: string;
  event_id: string;
  launch_id: string;
  subscription_id: string;
  telegram_user_id: number;
  event_type: string;
  scheduled_for: string;
  payload: unknown;
  attempt_count: number;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: "not_configured" }, 503);
  }

  const suppliedSecret = req.headers.get("x-cartel-launch-scheduler-secret") ?? "";
  if (!suppliedSecret) return json({ ok: false, error: "forbidden" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretOk, error: secretError } = await admin.rpc(
    "launch_notification_scheduler_secret_matches",
    { p_secret: suppliedSecret },
  );
  if (secretError) return json({ ok: false, error: "auth_check_failed" }, 503);
  if (secretOk !== true) return json({ ok: false, error: "forbidden" }, 403);

  const counts = { processed: 0, sent: 0, retry: 0, failed: 0, ambiguous: 0, skipped: 0 };

  // ---- Queue maintenance ---------------------------------------------------
  // Stale claims become `ambiguous`, never automatically retried.
  const { error: staleError } = await admin.rpc("mark_stale_launch_notification_claims");
  if (staleError) console.error("mark_stale_launch_notification_claims failed", staleError.message);

  const { error: enqueueError } = await admin.rpc("enqueue_due_launch_reminder_events", {});
  if (enqueueError) console.error("enqueue_due_launch_reminder_events failed", enqueueError.message);

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_launch_notification_deliveries",
    { _limit: CLAIM_LIMIT },
  );
  if (claimError) return json({ ok: false, error: "claim_failed" }, 503);

  const claims = (Array.isArray(claimed) ? claimed : []) as ClaimRow[];

  const finalize = async (deliveryId: string, patch: Record<string, unknown>) => {
    const { error } = await admin
      .from("launch_notification_deliveries")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", deliveryId);
    return error ?? null;
  };

  const skip = async (deliveryId: string, reason: string) => {
    counts.skipped += 1;
    const error = await finalize(deliveryId, {
      status: "skipped",
      error_class: "skipped",
      last_error: reason,
    });
    if (error) console.error("skip persistence failed", deliveryId, error.message);
  };

  // Sequential processing: conservative with Telegram rate limits.
  for (const claim of claims) {
    counts.processed += 1;
    const deliveryId = String(claim.delivery_id);
    const eventType = String(claim.event_type);

    try {
      // ---- Revalidate against CURRENT state ------------------------------
      const { data: subscription, error: subError } = await admin
        .from("launch_watch_subscriptions")
        .select("id,is_active,reminders_enabled")
        .eq("id", claim.subscription_id)
        .maybeSingle();
      if (subError) throw new Error("subscription_read_failed");
      if (!subscription?.id || subscription.is_active !== true) {
        await skip(deliveryId, "watcher_inactive");
        continue;
      }
      const isReminder = eventType === "REMINDER_24H" || eventType === "REMINDER_1H";
      if (isReminder && subscription.reminders_enabled !== true) {
        await skip(deliveryId, "reminders_muted");
        continue;
      }

      const { data: launch, error: launchError } = await admin
        .from("launches")
        .select(
          "id,status,launch_at,launch_window_start,launch_window_end,timezone,official_contract_address,launch_watch_token,project_profile_id,token_name,ticker,chain",
        )
        .eq("id", claim.launch_id)
        .maybeSingle();
      if (launchError) throw new Error("launch_read_failed");
      if (!launch?.id) {
        await skip(deliveryId, "launch_missing");
        continue;
      }

      const { data: profile, error: profileError } = await admin
        .from("project_profiles")
        .select("project_name,website_url,telegram_url,x_url,discovery_status")
        .eq("id", launch.project_profile_id)
        .maybeSingle();
      if (profileError) throw new Error("profile_read_failed");
      if (!profile || String(profile.discovery_status ?? "") !== "published") {
        await skip(deliveryId, "profile_not_published");
        continue;
      }

      const status = String(launch.status ?? "");
      const isLiveOrDone = status === "LIVE" || status === "COMPLETED";
      const nowMs = Date.now();

      if (eventType === "OFFICIAL_CONTRACT_REGISTERED") {
        if (isLiveOrDone) {
          // The launch-live packet already carries the registered contract.
          await skip(deliveryId, "superseded_by_live");
          continue;
        }
        if (!launch.official_contract_address) {
          await skip(deliveryId, "contract_missing");
          continue;
        }
      }

      if (isReminder) {
        if (isLiveOrDone) {
          await skip(deliveryId, "launch_already_live");
          continue;
        }
        const anchorIso = (launch.launch_at ?? launch.launch_window_start) as string | null;
        if (!anchorIso) {
          await skip(deliveryId, "schedule_missing");
          continue;
        }
        const anchorMs = new Date(anchorIso).getTime();
        if (Number.isNaN(anchorMs)) {
          await skip(deliveryId, "schedule_invalid");
          continue;
        }
        const expectedMs = anchorMs - (REMINDER_OFFSET_MS[eventType] ?? 0);
        const scheduledMs = new Date(String(claim.scheduled_for)).getTime();
        if (Number.isNaN(scheduledMs)) {
          await skip(deliveryId, "schedule_invalid");
          continue;
        }
        if (Math.abs(expectedMs - scheduledMs) > SCHEDULE_DRIFT_TOLERANCE_MS) {
          await skip(deliveryId, "schedule_changed");
          continue;
        }
        if (nowMs - scheduledMs > REMINDER_STALE_MS) {
          await skip(deliveryId, "stale_reminder");
          continue;
        }
      }

      // ---- Build the message ---------------------------------------------
      const projectName = escapeHtml(String(profile.project_name ?? "Project"));
      const identity =
        `<b>${projectName}</b>\n` +
        `${escapeHtml(String(launch.token_name ?? ""))} • ${escapeHtml(String(launch.ticker ?? ""))} • ${escapeHtml(String(launch.chain ?? ""))}`;
      const timezone = typeof launch.timezone === "string" && launch.timezone ? launch.timezone : null;
      const anchorIso = (launch.launch_at ?? launch.launch_window_start) as string | null;
      const timingLabel = anchorIso ? formatInZone(anchorIso, timezone) : null;
      const timingLine = timingLabel
        ? `\n${launch.launch_at ? "Announced launch time" : "Launch window starts"}: <b>${escapeHtml(timingLabel)}</b>`
        : "";

      const packetLines: string[] = [];
      if (launch.official_contract_address) {
        packetLines.push(
          `\nOfficial contract registered by the authenticated project:\n<code>${escapeHtml(String(launch.official_contract_address))}</code>`,
        );
      }

      const linkLines: string[] = [];
      if (isHttpUrl(profile.website_url)) linkLines.push(`Website: ${escapeHtml(profile.website_url.trim())}`);
      if (isHttpUrl(profile.telegram_url)) linkLines.push(`Telegram: ${escapeHtml(profile.telegram_url.trim())}`);
      if (isHttpUrl(profile.x_url)) linkLines.push(`X: ${escapeHtml(profile.x_url.trim())}`);
      const linksBlock = linkLines.length ? `\n\n<b>Official project links</b>\n${linkLines.join("\n")}` : "";

      let text: string;
      if (isReminder) {
        const window = eventType === "REMINDER_24H" ? "~24 hours" : "~1 hour";
        text =
          `<b>⏳ LAUNCH COUNTDOWN</b>\n\n${identity}\n\n` +
          `About <b>${window}</b> until the ${launch.launch_at ? "announced launch time" : "launch window start"}.` +
          `${timingLine}${linksBlock}\n\n${REMINDER_DISCLAIMER}`;
      } else if (eventType === "OFFICIAL_CONTRACT_REGISTERED") {
        text =
          `<b>📦 VERIFIED LAUNCH PACKET</b>\n\n${identity}\n${packetLines.join("\n")}` +
          `${timingLine}${linksBlock}\n\n${TRUST_STATEMENT}`;
      } else if (eventType === "LAUNCH_LIVE") {
        text =
          `<b>🚀 LAUNCH IS LIVE</b>\n\n${identity}\n\n<b>📦 VERIFIED LAUNCH PACKET</b>${packetLines.join("\n")}` +
          `${timingLine}${linksBlock}\n\n${TRUST_STATEMENT}`;
      } else {
        await skip(deliveryId, "unknown_event_type");
        continue;
      }

      // ---- Keyboard --------------------------------------------------------
      const keyboardRows: Array<Array<Record<string, string>>> = [];
      const linkRow: Array<Record<string, string>> = [];
      if (isHttpUrl(profile.website_url)) linkRow.push({ text: "🌐 Website", url: profile.website_url.trim() });
      if (isHttpUrl(profile.telegram_url)) linkRow.push({ text: "💬 Telegram", url: profile.telegram_url.trim() });
      if (isHttpUrl(profile.x_url)) linkRow.push({ text: "𝕏 X", url: profile.x_url.trim() });
      if (linkRow.length) keyboardRows.push(linkRow);

      const token = typeof launch.launch_watch_token === "string" ? launch.launch_watch_token : null;
      if (token && /^[a-f0-9]{24}$/.test(token)) {
        const controls: Array<Record<string, string>> = [
          { text: "🔕 Stop watching", callback_data: `lw_unwatch_${token}` },
        ];
        if (isReminder || status !== "LIVE") {
          controls.push({ text: "🔇 Mute countdowns", callback_data: `ln_reminders_off_${token}` });
        }
        keyboardRows.push(controls);
      }

      // ---- Send -------------------------------------------------------------
      let sendResult:
        | { kind: "sent"; messageId: number | null }
        | { kind: "retry"; retryAfter: number; description: string }
        | { kind: "failed"; description: string }
        | { kind: "ambiguous"; description: string };

      try {
        telegramAttempted = true;
        const response = await fetch(`${TG_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {

          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: claim.telegram_user_id,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...(keyboardRows.length ? { reply_markup: { inline_keyboard: keyboardRows } } : {}),
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });

        let body: any = null;
        let parsed = true;
        try {
          body = await response.json();
        } catch {
          parsed = false;
        }

        if (!parsed || body === null || typeof body !== "object" || typeof body.ok !== "boolean") {
          // Unparseable/unknown response: the DM may or may not have arrived.
          sendResult = { kind: "ambiguous", description: `unparseable_response_${response.status}` };
        } else if (body.ok === true) {
          const messageId = Number(body?.result?.message_id);
          sendResult = { kind: "sent", messageId: Number.isFinite(messageId) ? messageId : null };
        } else {
          const errorCode = Number(body?.error_code ?? response.status);
          const description = String(body?.description ?? `telegram_error_${errorCode}`).slice(0, 400);
          const retryAfter = Number(body?.parameters?.retry_after);
          if (errorCode === 429 && Number.isFinite(retryAfter)) {
            sendResult =
              Number(claim.attempt_count ?? 0) < MAX_ATTEMPTS
                ? { kind: "retry", retryAfter, description }
                : { kind: "failed", description };
          } else {
            sendResult = { kind: "failed", description };
          }
        }
      } catch (sendError) {
        // Network failure / AbortError: outcome genuinely unknown.
        const description =
          sendError instanceof Error ? `${sendError.name}: ${sendError.message}`.slice(0, 400) : "send_exception";
        sendResult = { kind: "ambiguous", description };
      }

      // ---- Persist the outcome ---------------------------------------------
      if (sendResult.kind === "sent") {
        counts.sent += 1;
        const persistError = await finalize(deliveryId, {
          status: "sent",
          sent_at: new Date().toISOString(),
          telegram_message_id: sendResult.messageId,
          error_class: null,
          last_error: null,
        });
        if (persistError) {
          // The DM was delivered. Leaving the row in `processing` is the safe
          // outcome: mark_stale_launch_notification_claims() will later mark
          // it ambiguous rather than resending a duplicate.
          console.error("sent-state persistence failed; leaving processing", deliveryId, persistError.message);
        }
        continue;
      }

      if (sendResult.kind === "retry") {
        counts.retry += 1;
        const nextAttemptAt = new Date(
          Date.now() + (sendResult.retryAfter + RETRY_BUFFER_SECONDS) * 1000,
        ).toISOString();
        const persistError = await finalize(deliveryId, {
          status: "retry",
          next_attempt_at: nextAttemptAt,
          error_class: "rate_limited",
          last_error: sendResult.description,
        });
        if (persistError) console.error("retry persistence failed", deliveryId, persistError.message);
        continue;
      }

      if (sendResult.kind === "failed") {
        counts.failed += 1;
        const persistError = await finalize(deliveryId, {
          status: "failed",
          error_class: "telegram_rejected",
          last_error: sendResult.description,
        });
        if (persistError) console.error("failed persistence failed", deliveryId, persistError.message);
        continue;
      }

      counts.ambiguous += 1;
      const persistError = await finalize(deliveryId, {
        status: "ambiguous",
        error_class: "uncertain_outcome",
        last_error: sendResult.description,
      });
      if (persistError) console.error("ambiguous persistence failed", deliveryId, persistError.message);
    } catch (error) {
      const description = error instanceof Error ? error.message.slice(0, 400) : "processing_error";
      if (!telegramAttempted) {
        // Telegram was definitively never called: no duplicate-DM risk, so a
        // bounded retry is the correct category rather than `ambiguous`.
        if (Number(claim.attempt_count ?? 0) < MAX_ATTEMPTS) {
          counts.retry += 1;
          const persistError = await finalize(deliveryId, {
            status: "retry",
            next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
            error_class: "processing_retry",
            last_error: description,
          });
          if (persistError) console.error("processing-retry persistence failed", deliveryId, persistError.message);
        } else {
          counts.failed += 1;
          const persistError = await finalize(deliveryId, {
            status: "failed",
            error_class: "processing_failed",
            last_error: description,
          });
          if (persistError) console.error("processing-failed persistence failed", deliveryId, persistError.message);
        }
      } else {
        // A send attempt had already begun with no reliable Telegram verdict.
        counts.ambiguous += 1;
        const persistError = await finalize(deliveryId, {
          status: "ambiguous",
          error_class: "uncertain_outcome",
          last_error: description,
        });
        if (persistError) console.error("post-attempt persistence failed", deliveryId, persistError.message);
      }
    }

  }

  // Aggregate counts only. No Telegram identifiers ever leave this worker.
  return json({ ok: true, ...counts });
});
