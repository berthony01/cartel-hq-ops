import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Owner-only Telegram system messages. Defaults mirror the telegram-webhook fallback copy.
const TEMPLATE_DEFAULTS: Record<string, string> = {
  bot_installed: [
    "<b>🐸 PEPECARTEL HQ BOT INSTALLED</b>",
    "",
    "<b>{group_title}</b> has added @PepeCartelHQBot.",
    "",
    "This community is <b>not connected to a Cartel HQ workspace yet.</b>",
    "",
    "Cartel HQ is the command center where community owners configure tools and automations. The bot carries approved actions out here in Telegram.",
    "",
    "<b>Available through Cartel HQ</b>",
    "👋 Welcome &amp; onboarding",
    "🎨 Telegram sticker packs",
    "🤖 Native Sticker Drops",
    "",
    "<b>Coming next</b>",
    "📢 Community automations",
    "🚀 Launch Watch &amp; official launch alerts",
    "🛡 Project verification",
    "",
    "New to Cartel HQ? Join Early Access below. Already have an account? Connect your Telegram account in Cartel HQ, then connect this community from your workspace.",
  ].join("\n"),
  account_found: [
    "<b>🐸 CARTEL HQ ACCOUNT FOUND</b>",
    "",
    "We recognize the Cartel HQ account linked to the Telegram user who added @PepeCartelHQBot to <b>{group_title}</b>.",
    "",
    "This community is <b>not connected to a Cartel HQ workspace yet.</b>",
    "",
    "Return to Cartel HQ and use <b>Connect Community</b> from the workspace that should control this group. Once verified, the bot will activate that workspace's approved community tools here.",
  ].join("\n"),
  community_connected: [
    "<b>✅ CARTEL HQ CONNECTED</b>",
    "",
    "<b>{group_title}</b> is now connected to Cartel HQ.",
    "",
    "🐸 <b>@PepeCartelHQBot is active in this community.</b>",
    "",
    "Community owners configure tools and automations inside <b>Cartel HQ</b>, and the bot carries them out here in Telegram.",
    "",
    "<b>Available now</b>",
    "👋 Welcome &amp; onboarding",
    "🎨 Telegram sticker packs",
    "🤖 Native Sticker Drops",
    "",
    "<b>Coming through Cartel HQ</b>",
    "📢 Community automations",
    "📊 Polls, milestones &amp; community intelligence",
    "🚀 Launch Watch &amp; official launch alerts",
    "🛡 Project verification",
    "⚡ More community &amp; launch tools",
    "",
    "Return to Cartel HQ to configure this community.",
  ].join("\n"),
};


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return respond({ error: "ADMIN_SERVICE_NOT_CONFIGURED" }, 503);
  }
  if (!authHeader.startsWith("Bearer ")) {
    return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400);
  }

  const action = String(body.action ?? "status");
  const TEMPLATE_ACTIONS = [
    "templates_list",
    "templates_save_draft",
    "templates_publish",
    "templates_restore_default",
  ];
  if (action !== "status" && !TEMPLATE_ACTIONS.includes(action)) {
    return respond({ error: "UNKNOWN_ACTION", message: "Unknown owner-console action." }, 400);
  }

  const userId = authData.user.id;
  const [{ data: ownerCheck, error: ownerError }, { data: unrestricted, error: unrestrictedError }] =
    await Promise.all([
      admin.rpc("is_platform_owner", { _user_id: userId }),
      admin.rpc("has_platform_unrestricted_access", { _user_id: userId }),
    ]);

  if (ownerError || unrestrictedError) {
    console.error("[platform-admin] role lookup failed", ownerError ?? unrestrictedError);
    return respond({ error: "OWNER_CHECK_FAILED" }, 500);
  }

  const isPlatformOwner = ownerCheck === true;
  if (!isPlatformOwner) {
    if (TEMPLATE_ACTIONS.includes(action)) {
      return respond({ error: "FORBIDDEN", message: "Platform owner access is required." }, 403);
    }
    return respond({
      isPlatformOwner: false,
      hasUnrestrictedAccess: false,
      role: null,
      capabilities: [],
      metrics: null,
      details: null,
    });
  }

  if (TEMPLATE_ACTIONS.includes(action)) {
    const TEMPLATE_COLUMNS =
      "key,draft_body,published_body,draft_updated_at,published_at,updated_at";
    const listTemplates = async () => {
      const { data, error } = await admin
        .from("platform_message_templates")
        .select(TEMPLATE_COLUMNS)
        .order("key", { ascending: true });
      if (error) {
        console.error("[platform-admin] template list failed", error);
        return respond({ error: "TEMPLATES_READ_FAILED", message: "Could not load templates." }, 500);
      }
      return respond({ templates: data ?? [] });
    };

    if (action === "templates_list") return await listTemplates();

    const key = String(body.key ?? "");
    if (!Object.prototype.hasOwnProperty.call(TEMPLATE_DEFAULTS, key)) {
      return respond({ error: "INVALID_KEY", message: "Unknown message template." }, 400);
    }
    const now = new Date().toISOString();

    if (action === "templates_restore_default") {
      const { error } = await admin
        .from("platform_message_templates")
        .update({ draft_body: TEMPLATE_DEFAULTS[key], draft_updated_at: now, updated_by: userId })
        .eq("key", key);
      if (error) {
        console.error("[platform-admin] template restore failed", error);
        return respond({ error: "TEMPLATE_WRITE_FAILED", message: "Could not restore the default." }, 500);
      }
      return await listTemplates();
    }

    const rawBody = body.body === undefined || body.body === null ? null : String(body.body);
    if (rawBody !== null && rawBody.length > 3500) {
      return respond({ error: "BODY_TOO_LONG", message: "Message must be 3500 characters or fewer." }, 400);
    }

    if (action === "templates_save_draft") {
      if (rawBody === null) {
        return respond({ error: "MISSING_BODY", message: "Draft content is required." }, 400);
      }
      const { error } = await admin
        .from("platform_message_templates")
        .update({ draft_body: rawBody, draft_updated_at: now, updated_by: userId })
        .eq("key", key);
      if (error) {
        console.error("[platform-admin] template draft save failed", error);
        return respond({ error: "TEMPLATE_WRITE_FAILED", message: "Could not save the draft." }, 500);
      }
      return await listTemplates();
    }

    // templates_publish
    let publishBody = rawBody;
    if (publishBody === null) {
      const { data: current, error: readError } = await admin
        .from("platform_message_templates")
        .select("draft_body")
        .eq("key", key)
        .maybeSingle();
      if (readError || !current) {
        console.error("[platform-admin] template publish read failed", readError);
        return respond({ error: "TEMPLATES_READ_FAILED", message: "Could not load the draft." }, 500);
      }
      publishBody = String(current.draft_body ?? "");
    }
    if (!publishBody.trim()) {
      return respond({ error: "EMPTY_BODY", message: "Published content cannot be blank." }, 400);
    }
    const { error: publishError } = await admin
      .from("platform_message_templates")
      .update({
        draft_body: publishBody,
        published_body: publishBody,
        draft_updated_at: now,
        published_at: now,
        updated_by: userId,
      })
      .eq("key", key);
    if (publishError) {
      console.error("[platform-admin] template publish failed", publishError);
      return respond({ error: "TEMPLATE_WRITE_FAILED", message: "Could not publish the message." }, 500);
    }
    return await listTemplates();
  }


  const [
    roleRes,
    metricsRes,
    workspacesRes,
    membersRes,
    groupsRes,
    packsRes,
    schedulesRes,
    eventsRes,
    aiJobsRes,
    betaRes,
    authUsersRes,
  ] = await Promise.all([
    admin.from("platform_user_roles").select("role,created_at,updated_at").eq("user_id", userId).maybeSingle(),
    admin.rpc("get_platform_owner_dashboard_metrics"),
    admin.from("workspaces").select("id,name,slug,owner_id,created_at,updated_at").order("created_at", { ascending: false }).limit(25),
    admin.from("workspace_members").select("workspace_id,user_id,role,created_at").limit(500),
    admin.from("telegram_group_connections").select("id,workspace_id,title,username,chat_type,bot_is_admin,verified_at,connected_at").order("connected_at", { ascending: false }).limit(50),
    admin.from("sticker_packs").select("id,workspace_id,title,status,telegram_set_name,telegram_set_url,telegram_published_at,created_at,updated_at").order("updated_at", { ascending: false }).limit(50),
    admin.from("sticker_drop_schedules").select("id,workspace_id,group_connection_id,pack_id,enabled,interval_minutes,timezone,active_start,active_end,daily_cap,silent,approved_only,no_immediate_repeat,selected_sticker_ids,last_sent_at,next_run_at,consecutive_failures,paused_reason,created_at,updated_at").order("created_at", { ascending: false }).limit(50),
    admin.from("sticker_drop_events").select("id,schedule_id,workspace_id,group_connection_id,pack_id,sticker_id,status,error_message,created_at").order("created_at", { ascending: false }).limit(50),
    admin.from("ai_jobs").select("id,workspace_id,job_type,provider,provider_model,status,error_code,error_message,created_at,completed_at").order("created_at", { ascending: false }).limit(30),
    admin.from("telegram_beta_contacts").select("id,subject_type,telegram_username,first_name,last_name,chat_title,source,source_chat_title,opted_in,last_seen_at,created_at").order("created_at", { ascending: false }).limit(30),
    admin.auth.admin.listUsers({ page: 1, perPage: 50 }),
  ]);

  const queryErrors = [
    roleRes.error,
    metricsRes.error,
    workspacesRes.error,
    membersRes.error,
    groupsRes.error,
    packsRes.error,
    schedulesRes.error,
    eventsRes.error,
    aiJobsRes.error,
    betaRes.error,
    authUsersRes.error,
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    console.error("[platform-admin] dashboard load failed", queryErrors[0]);
    return respond({ error: "OWNER_DASHBOARD_FAILED" }, 500);
  }

  const workspaces = workspacesRes.data ?? [];
  const members = membersRes.data ?? [];
  const groups = groupsRes.data ?? [];
  const packs = packsRes.data ?? [];
  const schedules = schedulesRes.data ?? [];
  const events = eventsRes.data ?? [];
  const aiJobs = aiJobsRes.data ?? [];
  const betaContacts = betaRes.data ?? [];

  const workspaceName = new Map(workspaces.map((w: any) => [String(w.id), String(w.name)]));
  const groupById = new Map(groups.map((g: any) => [String(g.id), g]));
  const packById = new Map(packs.map((p: any) => [String(p.id), p]));

  const workspaceSummaries = workspaces.map((w: any) => {
    const id = String(w.id);
    const wsMembers = members.filter((m: any) => String(m.workspace_id) === id);
    const wsGroups = groups.filter((g: any) => String(g.workspace_id) === id);
    const wsPacks = packs.filter((p: any) => String(p.workspace_id) === id);
    const wsSchedules = schedules.filter((s: any) => String(s.workspace_id) === id);
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      created_at: w.created_at,
      members: wsMembers.length,
      groups: wsGroups.length,
      packs: wsPacks.length,
      published_packs: wsPacks.filter((p: any) => p.status === "published").length,
      schedules: wsSchedules.length,
      enabled_schedules: wsSchedules.filter((s: any) => s.enabled === true).length,
    };
  });

  const scheduleDetails = schedules.map((s: any) => {
    const group = groupById.get(String(s.group_connection_id));
    const pack = packById.get(String(s.pack_id));
    return {
      ...s,
      workspace_name: workspaceName.get(String(s.workspace_id)) ?? "Workspace",
      group_title: group?.title ?? "Telegram group",
      group_username: group?.username ?? null,
      group_bot_is_admin: group?.bot_is_admin === true,
      pack_title: pack?.title ?? "Sticker pack",
    };
  });

  const recentDropEvents = events.map((e: any) => {
    const group = groupById.get(String(e.group_connection_id));
    const pack = packById.get(String(e.pack_id));
    return {
      ...e,
      workspace_name: workspaceName.get(String(e.workspace_id)) ?? "Workspace",
      group_title: group?.title ?? "Telegram group",
      pack_title: pack?.title ?? "Sticker pack",
    };
  });

  const recentAiJobs = aiJobs.map((j: any) => ({
    ...j,
    workspace_name: workspaceName.get(String(j.workspace_id)) ?? "Workspace",
  }));

  const recentUsers = (authUsersRes.data?.users ?? []).map((u: any) => ({
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
  }));

  return respond({
    isPlatformOwner: true,
    hasUnrestrictedAccess: unrestricted === true,
    role: roleRes.data?.role ?? "owner",
    capabilities: [
      "owner_console",
      "unrestricted_platform_access",
      "future_billing_bypass",
      "read_platform_metrics",
      "read_platform_operations",
    ],
    metrics: metricsRes.data ?? {},
    details: {
      users: recentUsers,
      workspaces: workspaceSummaries,
      telegramGroups: groups,
      stickerPacks: packs,
      stickerDropSchedules: scheduleDetails,
      recentDropEvents,
      recentAiJobs,
      betaContacts,
    },
  });
});
