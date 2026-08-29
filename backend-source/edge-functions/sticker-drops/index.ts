import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TG_BASE = "https://api.telegram.org";
const MAX_DUE_PER_RUN = 100;
const AUTO_PAUSE_FAILURES = 3;
const NATIVE_SYNC_ERROR = "Published Telegram sticker set is out of sync with this Cartel HQ pack. Refresh or republish before native delivery.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function telegramJson(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null) as any;
  if (!res.ok || !payload?.ok) throw new Error(String(payload?.description ?? `Telegram request failed (${res.status}).`));
  return payload.result;
}

function localClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year"), month = get("month"), day = get("day");
  const hour = Number(get("hour")), minute = Number(get("minute"));
  return { localDate: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
}

function timeToMinutes(value: string) {
  const [h, m] = value.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function withinActiveWindow(nowMinutes: number, startValue: string, endValue: string) {
  const start = timeToMinutes(startValue), end = timeToMinutes(endValue);
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function firstEmoji(value: unknown) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

async function reconcileNativeStickerIds(
  admin: ReturnType<typeof createClient>,
  token: string,
  packId: string,
  setName: string,
) {
  const [{ data: localRows, error: localError }, set] = await Promise.all([
    admin
      .from("stickers")
      .select("id,label,telegram_file_id,sort_order,emoji_list,status")
      .eq("pack_id", packId)
      .eq("status", "published")
      .order("sort_order", { ascending: true }),
    telegramJson(token, "getStickerSet", { name: setName }),
  ]);
  if (localError) throw localError;
  const local = localRows ?? [];
  const native = Array.isArray(set?.stickers) ? set.stickers : [];
  if (local.length === 0 || local.length !== native.length) throw new Error(NATIVE_SYNC_ERROR);

  const reconciled: any[] = [];
  for (let i = 0; i < local.length; i++) {
    const row: any = local[i];
    const tg: any = native[i];
    const nativeId = typeof tg?.file_id === "string" ? tg.file_id : "";
    if (!nativeId) throw new Error(NATIVE_SYNC_ERROR);
    const localEmoji = firstEmoji(row.emoji_list);
    const telegramEmoji = typeof tg?.emoji === "string" ? tg.emoji : "";
    if (localEmoji && telegramEmoji && localEmoji !== telegramEmoji) throw new Error(NATIVE_SYNC_ERROR);
    if (row.telegram_file_id !== nativeId) {
      const { error: updateError } = await admin
        .from("stickers")
        .update({ telegram_file_id: nativeId })
        .eq("id", row.id)
        .eq("pack_id", packId);
      if (updateError) throw updateError;
    }
    reconciled.push({ ...row, telegram_file_id: nativeId });
  }
  return reconciled;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !TELEGRAM_BOT_TOKEN) return json({ error: "WORKER_NOT_CONFIGURED" }, 503);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const schedulerSecret = req.headers.get("x-cartel-scheduler-secret") ?? "";
  if (!schedulerSecret) return json({ error: "UNAUTHORIZED" }, 401);
  const { data: secretOk, error: secretError } = await admin.rpc("sticker_drop_scheduler_secret_matches", { p_secret: schedulerSecret });
  if (secretError || secretOk !== true) return json({ error: "UNAUTHORIZED" }, 401);

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: due, error: dueError } = await admin
    .from("sticker_drop_schedules")
    .select("*")
    .eq("enabled", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(MAX_DUE_PER_RUN);
  if (dueError) return json({ error: "LOAD_DUE_FAILED", message: dueError.message }, 500);

  const results: any[] = [];

  for (const schedule of due ?? []) {
    let localDate = nowIso.slice(0, 10);
    let telegramSent = false;
    try {
      const clock = localClock(now, String(schedule.timezone ?? "UTC"));
      localDate = clock.localDate;

      if (schedule.next_run_at) {
        const { data: alreadySent, error: recoveryError } = await admin
          .from("sticker_drop_events")
          .select("sticker_id,created_at")
          .eq("schedule_id", schedule.id)
          .eq("status", "sent")
          .gte("created_at", schedule.next_run_at)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recoveryError) throw recoveryError;
        if (alreadySent) {
          const sentAt = new Date(alreadySent.created_at);
          const { error: recoverUpdateError } = await admin.from("sticker_drop_schedules").update({
            last_sticker_id: alreadySent.sticker_id,
            last_sent_at: alreadySent.created_at,
            next_run_at: addMinutes(sentAt, Number(schedule.interval_minutes)),
            consecutive_failures: 0,
            paused_reason: null,
          }).eq("id", schedule.id);
          if (recoverUpdateError) throw recoverUpdateError;
          results.push({ scheduleId: schedule.id, status: "skipped", reason: "recovered_prior_send" });
          continue;
        }
      }

      const { data: control } = await admin
        .from("sticker_drop_workspace_controls")
        .select("kill_switch")
        .eq("workspace_id", schedule.workspace_id)
        .maybeSingle();
      if (control?.kill_switch === true) {
        await admin.from("sticker_drop_schedules").update({ next_run_at: addMinutes(now, 15) }).eq("id", schedule.id);
        results.push({ scheduleId: schedule.id, status: "skipped", reason: "kill_switch" });
        continue;
      }

      if (!withinActiveWindow(clock.minutes, String(schedule.active_start), String(schedule.active_end))) {
        await admin.from("sticker_drop_schedules").update({ next_run_at: addMinutes(now, 15) }).eq("id", schedule.id);
        results.push({ scheduleId: schedule.id, status: "skipped", reason: "quiet_hours" });
        continue;
      }

      const { count: sentToday, error: countError } = await admin
        .from("sticker_drop_events")
        .select("id", { count: "exact", head: true })
        .eq("group_connection_id", schedule.group_connection_id)
        .eq("local_date", localDate)
        .eq("status", "sent");
      if (countError) throw countError;
      if ((sentToday ?? 0) >= Number(schedule.daily_cap)) {
        await admin.from("sticker_drop_schedules").update({ next_run_at: addMinutes(now, 60) }).eq("id", schedule.id);
        results.push({ scheduleId: schedule.id, status: "skipped", reason: "daily_cap" });
        continue;
      }

      const [{ data: group, error: groupError }, { data: pack, error: packError }] = await Promise.all([
        admin.from("telegram_group_connections").select("id,workspace_id,telegram_chat_id,title,bot_is_admin").eq("id", schedule.group_connection_id).eq("workspace_id", schedule.workspace_id).maybeSingle(),
        admin.from("sticker_packs").select("id,workspace_id,title,status,telegram_set_name").eq("id", schedule.pack_id).eq("workspace_id", schedule.workspace_id).maybeSingle(),
      ]);
      if (groupError) throw groupError;
      if (packError) throw packError;
      if (!group) throw new Error("Connected Telegram group no longer exists.");
      if (!group.bot_is_admin) throw new Error("CARTEL HQ bot is no longer verified as a group administrator.");
      if (!pack || pack.status !== "published" || !pack.telegram_set_name) throw new Error("Sticker Drop pack is no longer published to Telegram.");

      let eligible = await reconcileNativeStickerIds(admin, TELEGRAM_BOT_TOKEN, String(pack.id), String(pack.telegram_set_name));
      const selectedIds = Array.isArray(schedule.selected_sticker_ids) ? schedule.selected_sticker_ids.map(String).filter(Boolean) : [];
      if (selectedIds.length > 0) eligible = eligible.filter((s: any) => selectedIds.includes(String(s.id)));
      if (eligible.length === 0) throw new Error("No approved published Telegram stickers are available for this schedule.");
      if (schedule.no_immediate_repeat === true && eligible.length > 1 && schedule.last_sticker_id) {
        const withoutLast = eligible.filter((s: any) => String(s.id) !== String(schedule.last_sticker_id));
        if (withoutLast.length > 0) eligible = withoutLast;
      }
      const sticker = eligible[Math.floor(Math.random() * eligible.length)] as any;

      const message = await telegramJson(TELEGRAM_BOT_TOKEN, "sendSticker", {
        chat_id: String(group.telegram_chat_id),
        sticker: sticker.telegram_file_id,
        disable_notification: schedule.silent === true,
      });
      if (!message?.sticker?.file_id) throw new Error("Telegram did not return a native sticker message. Native Sticker Drop delivery was not confirmed.");
      telegramSent = true;

      const { error: scheduleUpdateError } = await admin.from("sticker_drop_schedules").update({
        last_sticker_id: sticker.id,
        last_sent_at: nowIso,
        next_run_at: addMinutes(now, Number(schedule.interval_minutes)),
        consecutive_failures: 0,
        paused_reason: null,
      }).eq("id", schedule.id);

      const { error: eventError } = await admin.from("sticker_drop_events").insert({
        schedule_id: schedule.id,
        workspace_id: schedule.workspace_id,
        group_connection_id: schedule.group_connection_id,
        pack_id: schedule.pack_id,
        sticker_id: sticker.id,
        status: "sent",
        local_date: localDate,
        telegram_message_id: message?.message_id ?? null,
        created_at: nowIso,
      });

      if (scheduleUpdateError) console.error("[sticker-drops] Telegram send succeeded but schedule update failed", schedule.id, scheduleUpdateError);
      if (eventError) console.error("[sticker-drops] Telegram send succeeded but event insert failed", schedule.id, eventError);

      results.push({
        scheduleId: schedule.id,
        status: "sent",
        groupTitle: group.title,
        stickerId: sticker.id,
        stickerLabel: sticker.label,
        nativeStickerConfirmed: true,
        persistenceWarning: scheduleUpdateError || eventError ? true : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sticker Drop failed.";
      if (telegramSent) {
        console.error("[sticker-drops] post-send persistence exception", schedule.id, err);
        results.push({ scheduleId: schedule.id, status: "sent", persistenceWarning: true, message });
        continue;
      }

      const nextFailures = Number(schedule.consecutive_failures ?? 0) + 1;
      await admin.from("sticker_drop_events").insert({
        schedule_id: schedule.id,
        workspace_id: schedule.workspace_id,
        group_connection_id: schedule.group_connection_id,
        pack_id: schedule.pack_id,
        sticker_id: null,
        status: "failed",
        local_date: localDate,
        error_message: message.slice(0, 1000),
        created_at: nowIso,
      }).catch(() => undefined);

      if (nextFailures >= AUTO_PAUSE_FAILURES) {
        await admin.from("sticker_drop_schedules").update({
          enabled: false,
          consecutive_failures: nextFailures,
          paused_reason: `Automatically paused after ${AUTO_PAUSE_FAILURES} consecutive failures: ${message}`.slice(0, 1000),
        }).eq("id", schedule.id).catch(() => undefined);
      } else {
        await admin.from("sticker_drop_schedules").update({
          consecutive_failures: nextFailures,
          next_run_at: addMinutes(now, Math.max(15, Number(schedule.interval_minutes ?? 60))),
          paused_reason: null,
        }).eq("id", schedule.id).catch(() => undefined);
      }
      results.push({ scheduleId: schedule.id, status: "failed", failures: nextFailures, autoPaused: nextFailures >= AUTO_PAUSE_FAILURES, message });
    }
  }

  return json({ ok: true, processed: results.length, sent: results.filter((r) => r.status === "sent").length, failed: results.filter((r) => r.status === "failed").length, skipped: results.filter((r) => r.status === "skipped").length, results });
});
