import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400); }

  const action = String(body.action ?? "status");
  const workspaceId = String(body.workspaceId ?? "");
  if (!workspaceId) return respond({ error: "WORKSPACE_REQUIRED", message: "Workspace is required." }, 400);

  const { data: membership, error: membershipError } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) return respond({ error: "MEMBERSHIP_CHECK_FAILED", message: "Could not verify workspace access." }, 500);
  if (!membership) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
  const canManage = membership.role === "owner" || membership.role === "admin";

  async function loadState() {
    const [groupsRes, packsRes, schedulesRes, controlRes, eventsRes] = await Promise.all([
      admin.from("telegram_group_connections").select("id,title,username,chat_type,bot_is_admin,can_set_sticker_set,verified_at,metadata,connected_at").eq("workspace_id", workspaceId).order("connected_at", { ascending: false }),
      admin.from("sticker_packs").select("id,title,theme,pack_size,status,telegram_set_name,telegram_set_url,telegram_published_at,updated_at").eq("workspace_id", workspaceId).eq("status", "published").not("telegram_set_name", "is", null).order("updated_at", { ascending: false }),
      admin.from("sticker_drop_schedules").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      admin.from("sticker_drop_workspace_controls").select("workspace_id,kill_switch,updated_at,updated_by").eq("workspace_id", workspaceId).maybeSingle(),
      admin.from("sticker_drop_events").select("id,schedule_id,group_connection_id,pack_id,sticker_id,status,local_date,telegram_message_id,error_message,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const result of [groupsRes, packsRes, schedulesRes, eventsRes]) {
      if (result.error) throw result.error;
    }
    if (controlRes.error) throw controlRes.error;

    const packIds = (packsRes.data ?? []).map((p: any) => String(p.id));
    let stickers: any[] = [];
    if (packIds.length > 0) {
      const stickersRes = await admin
        .from("stickers")
        .select("id,pack_id,label,emoji_list,status,telegram_file_id,sort_order,image_asset_id")
        .in("pack_id", packIds)
        .eq("status", "published")
        .not("telegram_file_id", "is", null)
        .order("sort_order", { ascending: true });
      if (stickersRes.error) throw stickersRes.error;
      stickers = stickersRes.data ?? [];
    }

    return {
      canManage,
      role: membership.role,
      control: controlRes.data ?? { workspace_id: workspaceId, kill_switch: false, updated_at: null, updated_by: null },
      groups: groupsRes.data ?? [],
      packs: packsRes.data ?? [],
      stickers,
      schedules: schedulesRes.data ?? [],
      events: eventsRes.data ?? [],
    };
  }

  try {
    if (action === "status") return respond(await loadState());
    if (!canManage) return respond({ error: "MANAGER_REQUIRED", message: "Only workspace owners and admins can manage Sticker Drops." }, 403);

    if (action === "save_schedule") {
      const scheduleId = body.scheduleId ? String(body.scheduleId) : "";
      const groupConnectionId = String(body.groupConnectionId ?? "");
      const packId = String(body.packId ?? "");
      const intervalMinutes = Number(body.intervalMinutes ?? 60);
      const timezone = String(body.timezone ?? "UTC");
      const activeStart = String(body.activeStart ?? "08:00");
      const activeEnd = String(body.activeEnd ?? "23:00");
      const dailyCap = Number(body.dailyCap ?? 8);
      const silent = body.silent !== false;
      const noImmediateRepeat = body.noImmediateRepeat !== false;
      const selectedStickerIds = Array.isArray(body.selectedStickerIds)
        ? Array.from(new Set(body.selectedStickerIds.map((v) => String(v)).filter(Boolean)))
        : [];

      if (!groupConnectionId || !packId) return respond({ error: "GROUP_AND_PACK_REQUIRED", message: "Choose a connected group and a published sticker pack." }, 400);
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 720) return respond({ error: "INVALID_INTERVAL", message: "Sticker Drops must be between 15 and 720 minutes apart." }, 400);
      if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 24) return respond({ error: "INVALID_DAILY_CAP", message: "Daily cap must be between 1 and 24 stickers." }, 400);
      if (!validTimezone(timezone)) return respond({ error: "INVALID_TIMEZONE", message: "Choose a valid timezone." }, 400);
      if (!validTime(activeStart) || !validTime(activeEnd)) return respond({ error: "INVALID_ACTIVE_HOURS", message: "Active hours must use a valid 24-hour time." }, 400);

      const mutableFields = {
        workspace_id: workspaceId,
        group_connection_id: groupConnectionId,
        pack_id: packId,
        interval_minutes: intervalMinutes,
        timezone,
        active_start: activeStart,
        active_end: activeEnd,
        daily_cap: dailyCap,
        silent,
        approved_only: true,
        no_immediate_repeat: noImmediateRepeat,
        selected_sticker_ids: selectedStickerIds,
      };

      let saved;
      if (scheduleId) {
        const { data: existing, error: existingError } = await admin.from("sticker_drop_schedules").select("id").eq("id", scheduleId).eq("workspace_id", workspaceId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) return respond({ error: "SCHEDULE_NOT_FOUND", message: "That Sticker Drop schedule no longer exists." }, 404);
        const { data, error } = await admin.from("sticker_drop_schedules").update(mutableFields).eq("id", scheduleId).eq("workspace_id", workspaceId).select("*").single();
        if (error) throw error;
        saved = data;
      } else {
        const { data: existingForGroup, error: existingGroupError } = await admin
          .from("sticker_drop_schedules")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("group_connection_id", groupConnectionId)
          .maybeSingle();
        if (existingGroupError) throw existingGroupError;

        if (existingForGroup) {
          const { data, error } = await admin
            .from("sticker_drop_schedules")
            .update(mutableFields)
            .eq("id", existingForGroup.id)
            .eq("workspace_id", workspaceId)
            .select("*")
            .single();
          if (error) throw error;
          saved = data;
        } else {
          const { data, error } = await admin
            .from("sticker_drop_schedules")
            .insert({ ...mutableFields, created_by: authData.user.id, enabled: false })
            .select("*")
            .single();
          if (error) throw error;
          saved = data;
        }
      }
      return respond({ saved: true, schedule: saved, state: await loadState() });
    }

    if (action === "set_schedule_enabled") {
      const scheduleId = String(body.scheduleId ?? "");
      const enabled = body.enabled === true;
      if (!scheduleId) return respond({ error: "SCHEDULE_REQUIRED", message: "Schedule is required." }, 400);
      const { data, error } = await admin.from("sticker_drop_schedules").update({ enabled, paused_reason: enabled ? null : "Paused by workspace admin" }).eq("id", scheduleId).eq("workspace_id", workspaceId).select("*").maybeSingle();
      if (error) throw error;
      if (!data) return respond({ error: "SCHEDULE_NOT_FOUND", message: "That Sticker Drop schedule no longer exists." }, 404);
      return respond({ updated: true, schedule: data, state: await loadState() });
    }

    if (action === "delete_schedule") {
      const scheduleId = String(body.scheduleId ?? "");
      if (!scheduleId) return respond({ error: "SCHEDULE_REQUIRED", message: "Schedule is required." }, 400);
      const { error } = await admin.from("sticker_drop_schedules").delete().eq("id", scheduleId).eq("workspace_id", workspaceId);
      if (error) throw error;
      return respond({ deleted: true, state: await loadState() });
    }

    if (action === "set_kill_switch") {
      const killSwitch = body.killSwitch === true;
      const { error } = await admin.from("sticker_drop_workspace_controls").upsert({ workspace_id: workspaceId, kill_switch: killSwitch, updated_by: authData.user.id, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
      if (error) throw error;
      return respond({ updated: true, killSwitch, state: await loadState() });
    }

    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Sticker Drops action." }, 400);
  } catch (err) {
    console.error("[sticker-drop-config]", err);
    const message = err instanceof Error ? err.message : "Sticker Drops request failed.";
    return respond({ error: "STICKER_DROP_CONFIG_ERROR", message }, 400);
  }
});
