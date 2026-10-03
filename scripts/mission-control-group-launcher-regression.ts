/**
 * MC-GL — `/missioncontrol` group launcher -> Mission Control Mini App.
 * Behavior tests: run the PRODUCTION modules against controlled DB/Telegram
 * doubles. No network, no real messages, no writes.
 * Run: bun scripts/mission-control-group-launcher-regression.ts
 */
import { readFileSync } from "node:fs";
import {
  computeInitDataHash,
  buildDataCheckString,
  isCurrentChatAdmin,
  validateTelegramInitData,
} from "../src/lib/telegram-miniapp-auth.server";
import {
  COMMUNITY_MISSION_LIMIT,
  fetchCommunityLiveMissions,
  resolveCommunityLaunchCore,
  resolveCommunityMissionBindingCore,
  routeStartParam,
  type CommunityDeps,
  type CommunityMissionDeps,
} from "../src/lib/mission-control-community.server";
import {
  MISSION_CONTROL_ADMIN_ONLY_TEXT,
  MISSION_CONTROL_GROUP_TEXT,
  MISSION_CONTROL_NOT_CONNECTED_TEXT,
  MISSION_CONTROL_UNAVAILABLE_TEXT,
  buildMissionControlDirectLink,
  isMissionControlCommand,
  runMissionControlGroupLauncher,
  type LauncherDeps,
} from "../supabase/functions/_shared/mission-control-launcher";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const TOKEN = "123456:TEST_ONLY_TOKEN";
const NOW = 1_800_000_000_000;
const CONN = "11111111-2222-4333-8444-555555555555";
const WS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WS_OTHER = "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHAT_A = "-1001";
const CHAT_B = "-1002";

async function signed(extra: [string, string][]): Promise<string> {
  const params = new URLSearchParams();
  params.append("auth_date", String(Math.floor(NOW / 1000)));
  params.append("user", JSON.stringify({ id: 42, first_name: "T" }));
  for (const [k, v] of extra) params.append(k, v);
  params.append("hash", await computeInitDataHash(buildDataCheckString(params), TOKEN));
  return params.toString();
}
async function startState(extra: [string, string][]) {
  const r = await validateTelegramInitData(await signed(extra), TOKEN, { now: NOW });
  return r.ok ? r.startParam : null;
}

// ---------- 1. Signed start_param -> route ----------
{
  const absent = await startState([]);
  check("1.1 absent start_param -> ordinary", absent?.state === "absent" && routeStartParam(absent).kind === "ordinary");
  const valid = await startState([["start_param", `mc_${CONN}`]]);
  const r = valid ? routeStartParam(valid) : null;
  check("1.2 signed mc_<uuid> -> community", r?.kind === "community" && r.connectionId === CONN);
  const upper = await startState([["start_param", `MC_${CONN.toUpperCase()}`]]);
  const ru = upper ? routeStartParam(upper) : null;
  check("1.3 MC_ prefix (any case) -> community, lowercased", ru?.kind === "community" && ru.connectionId === CONN);
  const dup = await startState([["start_param", `mc_${CONN}`], ["start_param", `mc_${CONN}`]]);
  check("1.4 duplicated signed start_param -> invalid refusal", dup?.state === "invalid" && routeStartParam(dup).kind === "invalid");
  const big = await startState([["start_param", "a".repeat(513)]]);
  check("1.5 oversized signed start_param -> invalid refusal", big?.state === "invalid" && routeStartParam(big).kind === "invalid");
  const illegal = await startState([["start_param", "mc_bad value!"]]);
  check("1.6 illegal chars -> invalid refusal", illegal?.state === "invalid" && routeStartParam(illegal).kind === "invalid");
  const malformed = await startState([["start_param", "mc_not-a-uuid"]]);
  check("1.7 malformed mc_ -> invalid refusal", malformed !== null && routeStartParam(malformed).kind === "invalid");
  const mixed = await startState([["start_param", "Mc_zz"]]);
  check("1.8 mixed-case malformed Mc_ -> invalid (no case gap)", mixed !== null && routeStartParam(mixed).kind === "invalid");
  const other = await startState([["start_param", "ref_abc"]]);
  check("1.9 unrelated payload -> ordinary", other !== null && routeStartParam(other).kind === "ordinary");
  const tampered = (await signed([["start_param", `mc_${CONN}`]])).replace(CONN, WS);
  const t = await validateTelegramInitData(tampered, TOKEN, { now: NOW });
  check("1.10 tampered start_param fails signature", !t.ok && t.reason === "bad_signature");
}

// ---------- 2. resolveCommunityLaunchCore ----------
const goodRow = () => ({
  id: CONN,
  workspace_id: WS,
  telegram_chat_id: CHAT_A,
  title: "Group A",
  bot_is_admin: true,
  metadata: {} as Record<string, unknown>,
});
function deps(o: Partial<{
  workspaces: unknown[];
  wsError: boolean;
  rows: Record<string, unknown>[];
  rowError: boolean;
  admin: boolean | (() => Promise<boolean>);
}> = {}): CommunityDeps & { adminCalls: string[] } {
  const adminCalls: string[] = [];
  return {
    adminCalls,
    listOperatorWorkspaces: async () => ({ rows: o.workspaces ?? [{ workspace_id: WS, workspace_name: "W" }], error: !!o.wsError }),
    findConnection: async () => ({ rows: o.rows ?? [goodRow()], error: !!o.rowError }),
    isChatAdmin: async (chatId) => {
      adminCalls.push(chatId);
      const a = o.admin ?? true;
      return typeof a === "function" ? a() : a;
    },
  };
}
{
  const d = deps();
  const ok = await resolveCommunityLaunchCore(d, 42, CONN);
  check("2.1 operator + live admin in exact chat -> launch", ok.ok && ok.chatId === CHAT_A && ok.launch.workspaceId === WS && d.adminCalls.join() === CHAT_A);

  const reasons: [string, CommunityDeps][] = [
    ["non-admin", deps({ admin: false })],
    ["admin API failure", deps({ admin: async () => false })],
    ["foreign workspace", deps({ workspaces: [{ workspace_id: WS_OTHER }] })],
    ["no operator workspaces (copied link)", deps({ workspaces: [] })],
    ["missing connection", deps({ rows: [] })],
    ["duplicate connection rows", deps({ rows: [goodRow(), goodRow()] })],
    ["revoked (bot removed)", deps({ rows: [{ ...goodRow(), metadata: { bot_removed_at: "2026-01-01" } }] })],
    ["bot no longer admin", deps({ rows: [{ ...goodRow(), bot_is_admin: false }] })],
  ];
  for (const [label, dd] of reasons) {
    const r = await resolveCommunityLaunchCore(dd, 42, CONN);
    check(`2.2 ${label} -> uniform community_launch_unavailable`, !r.ok && r.reason === "community_launch_unavailable");
  }
  const foreignD = deps({ workspaces: [{ workspace_id: WS_OTHER }] });
  await resolveCommunityLaunchCore(foreignD, 42, CONN);
  check("2.3 foreign workspace never reaches Telegram admin call", foreignD.adminCalls.length === 0);
  const outage = await resolveCommunityLaunchCore(deps({ wsError: true }), 42, CONN);
  const dbOut = await resolveCommunityLaunchCore(deps({ rowError: true }), 42, CONN);
  check("2.4 backend outage -> unavailable (separate)", !outage.ok && outage.reason === "unavailable" && !dbOut.ok && dbOut.reason === "unavailable");
  const noChangeInfo = await resolveCommunityLaunchCore(deps({ rows: [{ ...goodRow(), metadata: { bot_can_change_info: false } }] }), 42, CONN);
  check("2.5 bot_can_change_info=false does NOT block Mission Control", noChangeInfo.ok);

  // Real production getChatMember helper fails closed on transport errors / non-admin.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  const t1 = await isCurrentChatAdmin(TOKEN, CHAT_A, 42);
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { status: "member" } }))) as typeof fetch;
  const t2 = await isCurrentChatAdmin(TOKEN, CHAT_A, 42);
  globalThis.fetch = (async () => new Response("{}", { status: 400 })) as typeof fetch;
  const t3 = await isCurrentChatAdmin(TOKEN, CHAT_A, 42);
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { status: "creator" } }))) as typeof fetch;
  const t4 = await isCurrentChatAdmin(TOKEN, CHAT_A, 42);
  globalThis.fetch = realFetch;
  check("2.6 isCurrentChatAdmin fails closed (throw/member/400) and allows creator", !t1 && !t2 && !t3 && t4);
}

// ---------- 3. Scoped mission read: chat filter before limit ----------
type Mission = { id: string; workspace_id: string; status: string; started_at: string; ends_at: string | null; social_posts: { author_handle: string } | null; social_mission_targets: { telegram_chat_id: string }[] };
function fakeDb(missions: Mission[]) {
  const calls: string[] = [];
  const from = (table: string) => {
    calls.push(`from:${table}`);
    const filters: [string, unknown][] = [];
    let orderBy: string | null = null;
    const q = {
      select: (c: string) => { calls.push(`select:${c}`); return q; },
      eq: (col: string, v: unknown) => { calls.push(`eq:${col}`); filters.push([col, v]); return q; },
      order: (col: string, o: { ascending: boolean }) => { calls.push(`order:${col}:${o.ascending}`); orderBy = col; return q; },
      limit: async (n: number) => {
        calls.push(`limit:${n}`);
        // Generic PostgREST semantics: filters (incl. !inner embedded) -> order -> limit.
        let rows = missions.map((m) => ({ ...m, social_mission_targets: [...m.social_mission_targets] }));
        for (const [col, v] of filters) {
          if (col.includes(".")) {
            const [rel, field] = col.split(".") as [keyof Mission, string];
            rows = rows
              .map((r) => ({ ...r, [rel]: (r[rel] as Record<string, unknown>[]).filter((x) => String(x[field]) === String(v)) }))
              .filter((r) => (r[rel] as unknown[]).length > 0);
          } else rows = rows.filter((r) => String((r as Record<string, unknown>)[col]) === String(v));
        }
        if (orderBy) rows.sort((a, b) => String(b[orderBy as keyof Mission]).localeCompare(String(a[orderBy as keyof Mission])));
        return { data: rows.slice(0, n), error: null };
      },
    };
    return q;
  };
  return { from, calls };
}
{
  const mk = (id: string, ws: string, chat: string, minute: number, status = "LIVE"): Mission => ({
    id, workspace_id: ws, status, started_at: `2026-10-03T10:${String(minute).padStart(2, "0")}:00Z`, ends_at: null,
    social_posts: { author_handle: `h_${id}` }, social_mission_targets: [{ telegram_chat_id: chat }],
  });
  const data: Mission[] = [
    mk("a-old-1", WS, CHAT_A, 1),
    mk("a-old-2", WS, CHAT_A, 2),
    mk("a-ended", WS, CHAT_A, 3, "ENDED"),
    mk("x-foreign", WS_OTHER, CHAT_A, 59),
    ...Array.from({ length: 12 }, (_, i) => mk(`b-new-${i}`, WS, CHAT_B, 20 + i)),
  ];
  // Baseline proof of the defect: workspace-wide top-10 then chat filter hides Group A.
  const wsTop10 = data.filter((m) => m.workspace_id === WS && m.status === "LIVE").sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10);
  check("3.0 old path (limit before chat filter) would hide every Group A mission", wsTop10.filter((m) => m.social_mission_targets[0]!.telegram_chat_id === CHAT_A).length === 0);

  const db = fakeDb(data);
  const res = await fetchCommunityLiveMissions(db.from as never, WS, CHAT_A);
  const ids = res.ok ? res.rows.map((r) => r["mission_id"]).join(",") : "";
  check("3.1 >10 newer sibling-group missions do not hide target group", ids === "a-old-2,a-old-1");
  check("3.2 no foreign-workspace or non-LIVE rows", !ids.includes("x-foreign") && !ids.includes("a-ended"));
  const iFilter = db.calls.indexOf("eq:social_mission_targets.telegram_chat_id");
  const iLimit = db.calls.indexOf(`limit:${COMMUNITY_MISSION_LIMIT}`);
  check("3.3 chat filter + inner join issued before limit", iFilter >= 0 && iLimit > iFilter && db.calls.some((c) => c.includes("social_mission_targets!inner")));
  check("3.4 rows carry exact target chat + author", res.ok && res.rows.every((r) => r["telegram_chat_id"] === CHAT_A) && res.rows[0]!["author_handle"] === "h_a-old-2");
  const resB = await fetchCommunityLiveMissions(fakeDb(data).from as never, WS, CHAT_B);
  check("3.5 Group B capped at limit, only B rows", resB.ok && resB.rows.length === COMMUNITY_MISSION_LIMIT && resB.rows.every((r) => String(r["mission_id"]).startsWith("b-")));
  const errDb = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit: async () => ({ data: null, error: { message: "x" } }) }) };
  const er = await fetchCommunityLiveMissions(errDb.from as never, WS, CHAT_A);
  check("3.6 DB error fails closed", !er.ok);
}

// ---------- 4. Group launcher flow ----------
type Log = string[];
function launcher(o: Partial<LauncherDeps> & { rows?: unknown[]; status?: string | Error; sendOk?: boolean; deleteThrows?: boolean } = {}) {
  const log: Log = [];
  const d: LauncherDeps = {
    botUsername: "PepeCartelHQBot",
    configuredLink: "https://t.me/PepeCartelHQBot",
    anonymousAdmin: false,
    getSenderStatus: async () => {
      log.push("getChatMember");
      if (o.status instanceof Error) throw o.status;
      return o.status ?? "administrator";
    },
    findConnections: async () => ({ rows: o.rows ?? [{ id: CONN, bot_is_admin: true, metadata: {} }], error: null }),
    sendText: async (t) => { log.push(`text:${t}`); return { message_id: 9 }; },
    sendLauncher: async (t, url) => { log.push(`launcher:${url}`); return o.sendOk === false ? null : { message_id: 10 }; },
    deleteCommand: async (id) => { log.push(`delete:${id}`); if (o.deleteThrows) throw new Error("no rights"); },
    sourceMessageId: 777,
    ...o,
  };
  return { d, log };
}
{
  check("4.0 command parsing", isMissionControlCommand("/missioncontrol", "PepeCartelHQBot") &&
    isMissionControlCommand("/MissionControl@pepecartelhqbot ", "PepeCartelHQBot") &&
    !isMissionControlCommand("/missioncontrol@OtherBot", "PepeCartelHQBot") &&
    !isMissionControlCommand("/missioncontrol now", "PepeCartelHQBot") &&
    !isMissionControlCommand("/mission manage", "PepeCartelHQBot"));

  let t = launcher({ status: "member" });
  let out = await runMissionControlGroupLauncher(t.d);
  check("4.1 non-admin refused, no link, no delete", out === "refused_not_admin" && t.log.join("|") === `getChatMember|text:${MISSION_CONTROL_ADMIN_ONLY_TEXT}`);

  t = launcher({ status: new Error("timeout") });
  out = await runMissionControlGroupLauncher(t.d);
  check("4.2 failed admin API -> refused", out === "refused_not_admin" && !t.log.some((l) => l.startsWith("launcher")));

  t = launcher({ anonymousAdmin: true, status: "member" });
  out = await runMissionControlGroupLauncher(t.d);
  check("4.3 anonymous admin skips getChatMember, gets launcher", out === "launcher_sent" && !t.log.includes("getChatMember"));

  for (const [label, rows] of [
    ["unconnected", []],
    ["duplicate connections", [{ id: CONN, bot_is_admin: true, metadata: {} }, { id: WS, bot_is_admin: true, metadata: {} }]],
    ["revoked", [{ id: CONN, bot_is_admin: true, metadata: { bot_removed_at: "x" } }]],
    ["bot not admin", [{ id: CONN, bot_is_admin: false, metadata: {} }]],
  ] as [string, unknown[]][]) {
    t = launcher({ rows });
    out = await runMissionControlGroupLauncher(t.d);
    check(`4.4 ${label} -> not connected, no link`, out === "not_connected" && t.log.at(-1) === `text:${MISSION_CONTROL_NOT_CONNECTED_TEXT}` && !t.log.some((l) => l.startsWith("launcher") || l.startsWith("delete")));
  }
  t = launcher({ findConnections: async () => ({ rows: [], error: { message: "db" } }) });
  check("4.5 DB error -> not connected", (await runMissionControlGroupLauncher(t.d)) === "not_connected");

  t = launcher({ rows: [{ id: CONN, bot_is_admin: true, metadata: { bot_can_change_info: false } }] });
  check("4.6 bot_can_change_info=false still launches", (await runMissionControlGroupLauncher(t.d)) === "launcher_sent");

  for (const link of ["", "https://t.me/OtherBot", "http://t.me/PepeCartelHQBot", "https://t.me/PepeCartelHQBot/a b"]) {
    t = launcher({ configuredLink: link });
    out = await runMissionControlGroupLauncher(t.d);
    check(`4.7 link "${link}" -> unavailable copy, no button`, out === "link_unavailable" && t.log.at(-1) === `text:${MISSION_CONTROL_UNAVAILABLE_TEXT}` && !t.log.some((l) => l.startsWith("launcher")));
  }

  t = launcher({ sendOk: false });
  out = await runMissionControlGroupLauncher(t.d);
  check("4.8 unconfirmed launcher post -> command NOT deleted", out === "launcher_failed" && !t.log.some((l) => l.startsWith("delete")));

  t = launcher();
  out = await runMissionControlGroupLauncher(t.d);
  const li = t.log.findIndex((l) => l.startsWith("launcher:"));
  const di = t.log.indexOf("delete:777");
  check("4.9 confirmed post then delete exactly the original command once", out === "launcher_sent" && li >= 0 && di > li && t.log.filter((l) => l.startsWith("delete")).length === 1);
  check("4.10 Main Mini App URL carries mc_<connection>", t.log[li] === `launcher:https://t.me/PepeCartelHQBot?startapp=mc_${CONN}`);

  t = launcher({ configuredLink: "https://t.me/PepeCartelHQBot/missions" });
  await runMissionControlGroupLauncher(t.d);
  check("4.11 named app URL form", t.log.some((l) => l === `launcher:https://t.me/PepeCartelHQBot/missions?startapp=mc_${CONN}`));

  t = launcher({ deleteThrows: true });
  check("4.12 cleanup failure tolerated", (await runMissionControlGroupLauncher(t.d)) === "launcher_sent");
  t = launcher({ sourceMessageId: undefined });
  await runMissionControlGroupLauncher(t.d);
  check("4.13 no message id -> no delete", !t.log.some((l) => l.startsWith("delete")));
  check("4.14 launcher text promises no access by itself", MISSION_CONTROL_GROUP_TEXT.includes("grants no access"));
  check("4.15 link builder rejects non-UUID connection", buildMissionControlDirectLink("https://t.me/PepeCartelHQBot", "x", "PepeCartelHQBot") === null);
}

// ---------- 5. Wiring (production files use the tested modules) ----------
{
  const hook = readFileSync("supabase/functions/telegram-webhook/index.ts", "utf8");
  const mirror = readFileSync("backend-source/edge-functions/telegram-webhook/index.ts", "utf8");
  const shared = readFileSync("supabase/functions/_shared/mission-control-launcher.ts", "utf8");
  const sharedMirror = readFileSync("backend-source/edge-functions/_shared/mission-control-launcher.ts", "utf8");
  const bridge = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");
  const home = readFileSync("src/routes/tg.index.tsx", "utf8");
  check("5.1 webhook + shared mirrors byte-identical", hook === mirror && shared === sharedMirror);
  check("5.2 webhook delegates to shared launcher", hook.includes('from "../_shared/mission-control-launcher.ts"') && hook.includes("runMissionControlGroupLauncher({") && hook.includes("isMissionControlCommand(text, BOT_USERNAME)"));
  check("5.3 legacy /mission manage + private entry retained", hook.includes("mission_manage") && hook.includes("mcOpenConsole("));
  check("5.4 help + setMyCommands list missioncontrol", hook.includes("/missioncontrol") && hook.includes('command: "missioncontrol"'));
  check("5.5 bridge uses tested core + scoped read", bridge.includes("resolveCommunityLaunchCore(communityDeps(admin, token)") && bridge.includes("routeStartParam(auth.startParam)") && bridge.includes("fetchCommunityLiveMissions("));
  check("5.6 private/null path keeps workspace RPC", /scopedChatId === null\)[\s\S]{0,200}admin\.rpc\(MINIAPP_RPC\.missions/.test(bridge));
  check("5.7 entitlement gate still precedes reads", bridge.indexOf('"x_missions"') < bridge.indexOf("fetchCommunityLiveMissions(\n"));
  check("5.8 detail/mutation paths re-check live admin in mission's own chat", bridge.includes("isCurrentChatAdmin(token, binding.chatId, auth.user.id)"));
  check("5.9 refusal never auto-selects another workspace", home.includes("if (!communityLaunch) return null;") && home.includes("if (launchRefused)"));
  check("5.10 picker hidden + scoped request in community mode", home.includes("workspaces.length > 1 && !communityLaunch") && home.includes("groupConnectionId: communityLaunch?.connectionId ?? null"));
  check("5.11 initDataUnsafe never read", !home.includes(".initDataUnsafe"));
}

// 6. Exact-mission community binding (detail / edit / lifecycle).
{
  const W = "11111111-1111-4111-8111-111111111111";
  const W2 = "22222222-2222-4222-8222-222222222222";
  const CONN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CONN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const CONN_F = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const CHAT_A = "-1001", CHAT_B = "-1002", CHAT_F = "-1009";
  const USER = 42;
  const target = "99999999-9999-4999-8999-999999999999";
  const ended = "88888888-8888-4888-8888-888888888888";
  type M = { id: string; workspace_id: string; status: string; started_at: string; chats: string[] };
  const missions: M[] = [
    { id: target, workspace_id: W, status: "LIVE", started_at: "2026-01-01", chats: [CHAT_B, CHAT_A] },
    { id: ended, workspace_id: W, status: "COMPLETED", started_at: "2026-01-02", chats: [CHAT_A] },
  ];
  for (let i = 0; i < 12; i++) {
    missions.push({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, workspace_id: W, status: "LIVE", started_at: `2026-02-${String(i + 1).padStart(2, "0")}`, chats: [CHAT_B] });
  }
  const conns: Record<string, Record<string, unknown>> = {
    [CONN_A]: { id: CONN_A, workspace_id: W, telegram_chat_id: CHAT_A, title: "A", bot_is_admin: true, metadata: {} },
    [CONN_B]: { id: CONN_B, workspace_id: W, telegram_chat_id: CHAT_B, title: "B", bot_is_admin: true, metadata: {} },
    [CONN_F]: { id: CONN_F, workspace_id: W2, telegram_chat_id: CHAT_F, title: "F", bot_is_admin: true, metadata: {} },
  };
  const make = (o: { admins?: string[]; revokeA?: boolean; operatorWs?: string[] } = {}) => {
    const calls = { listRpc: 0 };
    const deps: CommunityMissionDeps = {
      listOperatorWorkspaces: async () => ({ rows: (o.operatorWs ?? [W]).map((w) => ({ workspace_id: w, workspace_name: "WS" })), error: false }),
      findConnection: async (id) => {
        const r = conns[id];
        if (!r) return { rows: [], error: false };
        if (o.revokeA && id === CONN_A) return { rows: [{ ...r, metadata: { bot_removed_at: "x" } }], error: false };
        return { rows: [r], error: false };
      },
      isChatAdmin: async (chat) => (o.admins ?? [CHAT_A, CHAT_B, CHAT_F]).includes(chat),
      readMission: async (id, ws) => {
        const m = missions.find((x) => x.id === id && x.workspace_id === ws);
        return { row: m ? { id: m.id, workspace_id: m.workspace_id, status: m.status } : null, error: false };
      },
      readTargetChats: async (id, ws) => ({ chats: missions.find((x) => x.id === id && x.workspace_id === ws)?.chats ?? [], error: false }),
    };
    return { deps, calls };
  };
  // Old limited list: newest 10 LIVE targets for workspace — target would be absent.
  const oldList = missions.filter((m) => m.status === "LIVE").sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10);
  check("6.0 baseline: workspace top-10 list excludes the target mission", !oldList.some((m) => m.id === target));

  const live = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_A, target, { requireLive: true });
  check("6.1 >10 newer sibling missions do not block target detail", live.ok === true);
  check("6.2 multi-target mission binds originating group A (not B, B is first target)", live.ok && live.binding.chatId === CHAT_A && live.binding.workspaceId === W);
  const viaB = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_B, target, { requireLive: true });
  check("6.3 same mission via group B binds B's target", viaB.ok && viaB.binding.chatId === CHAT_B);
  const tamper = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_B, ended, { requireLive: false });
  check("6.4 mission not delivered to session group refused", !tamper.ok && tamper.reason === "not_found");
  const foreign = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_F, target, { requireLive: true });
  check("6.5 foreign-workspace connection refused uniformly", !foreign.ok && foreign.reason === "community_launch_unavailable");
  const revoked = await resolveCommunityMissionBindingCore(make({ revokeA: true }).deps, USER, CONN_A, target, { requireLive: true });
  check("6.6 revoked connection refused uniformly", !revoked.ok && revoked.reason === "community_launch_unavailable");
  const nonAdmin = await resolveCommunityMissionBindingCore(make({ admins: [CHAT_B] }).deps, USER, CONN_A, target, { requireLive: true });
  check("6.7 non-admin in session group refused (no fallback to group B where admin)", !nonAdmin.ok && nonAdmin.reason === "community_launch_unavailable");
  const missing = await resolveCommunityMissionBindingCore(make().deps, USER, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", target, { requireLive: true });
  check("6.8 unknown connection refused uniformly", !missing.ok && missing.reason === "community_launch_unavailable");
  const notOp = await resolveCommunityMissionBindingCore(make({ operatorWs: [W2] }).deps, USER, CONN_A, target, { requireLive: true });
  check("6.9 non-operator refused", !notOp.ok && notOp.reason === "community_launch_unavailable");
  const endedPanel = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_A, ended, { requireLive: true });
  check("6.10 panel/edit keep LIVE requirement", !endedPanel.ok && endedPanel.reason === "not_found");
  const r1 = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_A, ended, { requireLive: false });
  const r2 = await resolveCommunityMissionBindingCore(make().deps, USER, CONN_A, ended, { requireLive: false });
  check("6.11 lifecycle replay on COMPLETED reaches same target each retry", r1.ok && r2.ok && r1.binding.chatId === CHAT_A && r2.binding.chatId === CHAT_A && r1.binding.missionStatus === "COMPLETED");
  const err = await resolveCommunityMissionBindingCore({ ...make().deps, readMission: async () => ({ row: null, error: true }) }, USER, CONN_A, target, { requireLive: true });
  check("6.12 mission read error fails closed as unavailable", !err.ok && err.reason === "unavailable");
  const terr = await resolveCommunityMissionBindingCore({ ...make().deps, readTargetChats: async () => ({ chats: [], error: true }) }, USER, CONN_A, target, { requireLive: true });
  check("6.13 target read error fails closed", !terr.ok && terr.reason === "unavailable");
  const bridge6 = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");
  const am = bridge6.slice(bridge6.indexOf("async function authorizeMission("), bridge6.indexOf("async function resolveLifecycleCandidates"));
  const al = bridge6.slice(bridge6.indexOf("async function authorizeLifecycle("), bridge6.indexOf("function hexDigest"));
  check("6.14 authorizeMission: community path uses exact binding (requireLive true) before list RPC fallback", am.includes("routeStartParam(auth.startParam)") && am.includes("requireLive: true") && am.indexOf("resolveCommunityMissionBindingCore") < am.indexOf("resolveBinding(admin"));
  check("6.15 authorizeLifecycle: community path pinned (requireLive false) and still calls authorize RPC", al.includes("requireLive: false") && al.includes("MINIAPP_RPC.authorize"));
  check("6.16 invalid start_param refused in both gates", am.includes('fail("community_launch_invalid")') && al.includes('fail("community_launch_invalid")'));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
