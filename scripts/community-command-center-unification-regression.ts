/**
 * Step 1C regression — source-only.
 *
 * ZERO network, ZERO database, ZERO Telegram, ZERO X, ZERO secrets. Every
 * assertion is a static source check or a pure call into the dependency-free
 * presentation helpers of the new read-only mission module.
 *
 * Run: bun scripts/community-command-center-unification-regression.ts
 */

import { readFileSync } from "node:fs";
import {
  isMissionActive,
  missionTimeRemaining,
  missionStatusTone,
  deliveryTone,
  eventStateTone,
  formatMetric,
  formatMissionTime,
  rollupMissions,
  MISSION_OPERATOR_GUIDANCE,
  type MissionRow,
  type MissionView,
} from "../src/lib/social-missions";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const ROUTE_PATH = "src/routes/_authenticated/telegram.tsx";
const LIB_PATH = "src/lib/social-missions.ts";
const PANEL_PATH = "src/components/cartel/SocialMissionsPanel.tsx";
const ANALYTICS_PATH = "src/components/cartel/CommunityAnalyticsPanel.tsx";
const NAV_PATH = "src/lib/nav.ts";
const ADMIN_PATH = "src/routes/_authenticated/admin.tsx";

const routeSrc = readFileSync(ROUTE_PATH, "utf8");
const libSrc = readFileSync(LIB_PATH, "utf8");
const panelSrc = readFileSync(PANEL_PATH, "utf8");
const analyticsSrc = readFileSync(ANALYTICS_PATH, "utf8");
const navSrc = readFileSync(NAV_PATH, "utf8");
const adminSrc = readFileSync(ADMIN_PATH, "utf8");

/** Behavioural assertions read CODE, not the comments that legitimately name
 *  the things this phase excludes. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const libCode = stripComments(libSrc);
const panelCode = stripComments(panelSrc);
const analyticsCode = stripComments(analyticsSrc);
const routeCode = stripComments(routeSrc);

// ---------------------------------------------------------------------------
// 1. Route: title, tab set, order, legacy compatibility
// ---------------------------------------------------------------------------

check("1.1 page retitled to Community Command Center", routeCode.includes('title="Community Command Center"'));
check("1.2 head title retitled", routeCode.includes('{ title: "Community Command Center — CARTEL HQ" }'));
check("1.3 route path unchanged", routeCode.includes('createFileRoute("/_authenticated/telegram")'));

const tabKeyBlock = routeCode.slice(routeCode.indexOf("const TAB_KEYS"), routeCode.indexOf("type TabKey"));
for (const key of ["overview", "communities", "missions", "broadcasts", "inbox", "audience", "analytics"]) {
  check(`1.4 tab key present: ${key}`, tabKeyBlock.includes(`"${key}"`));
}
check("1.5 history is NOT a live tab key", !tabKeyBlock.includes('"history"'));

const tabsBlock = routeCode.slice(routeCode.indexOf("const TABS:"), routeCode.indexOf("StateMetric"));
const labelOrder = [...tabsBlock.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
check(
  "1.6 visible tab order is Overview|Telegram|Missions|Broadcasts|Inbox|Launch Watch|Analytics",
  labelOrder.join("|") === "Overview|Telegram|Missions|Broadcasts|Inbox|Launch Watch|Analytics",
);
check("1.7 Communities presentation renamed to Telegram", !tabsBlock.includes('label: "Communities"'));
check("1.8 Audience presentation renamed to Launch Watch", !tabsBlock.includes('label: "Audience"'));
check("1.9 legacy history alias maps to overview", routeCode.includes("LEGACY_TAB_ALIASES") && routeCode.includes('history: "overview"'));
check("1.10 legacy alias is applied in validateSearch", routeCode.includes("LEGACY_TAB_ALIASES[rawTab]"));
check("1.11 communities tab keeps forceMount", /value="communities"[\s\S]{0,200}forceMount/.test(routeCode));
check("1.12 retired ComingSoonPanel removed", !routeCode.includes("ComingSoonPanel"));

// Existing panels still mounted, unchanged call sites.
check("1.13 BroadcastsPanel still mounted", routeCode.includes("<BroadcastsPanel"));
check("1.14 AudiencePanel still mounted for Launch Watch", routeCode.includes("<AudiencePanel"));
check("1.15 ProjectInboxPanel still mounted", routeCode.includes("<ProjectInboxPanel"));
check("1.16 TelegramGroupCard still mounted", routeCode.includes("<TelegramGroupCard"));
check("1.17 Missions tab renders the read-only panel", routeCode.includes("<SocialMissionsPanel"));
check("1.18 Analytics tab renders the summary panel", routeCode.includes("<CommunityAnalyticsPanel"));
check("1.19 Overview renders the mission summary strip", routeCode.includes("<SocialMissionsSummary"));
check("1.20 mission surfaces are workspace-scoped from context", routeCode.includes("workspaceId={workspaceId ?? null}"));

// ---------------------------------------------------------------------------
// 2. Read-only guarantees of the new data module
// ---------------------------------------------------------------------------

for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "functions.invoke"]) {
  check(`2.1 no mutation primitive in social-missions: ${forbidden}`, !libCode.includes(forbidden));
}
check("2.2 every mission table read is workspace-filtered", (libCode.match(/\.from\("/g) ?? []).length === (libCode.match(/\.eq\("workspace_id", workspaceId\)/g) ?? []).length);
check("2.3 no polling interval", !libCode.includes("refetchInterval") && !panelCode.includes("refetchInterval") && !analyticsCode.includes("refetchInterval"));
check("2.4 no service-role / secret usage", !libCode.includes("service_role") && !libCode.includes("SERVICE_ROLE"));
check("2.5 no provider or Telegram call from the browser module", !libCode.includes("fetch(") && !libCode.includes("api.telegram.org") && !libCode.includes("x.com/i/api"));
check("2.6 reads only the approved existing tables", ["social_missions", "social_mission_targets", "social_mission_schedule_events", "social_posts", "telegram_group_connections", "social_metric_snapshots"].every((t) => libCode.includes(`.from("${t}")`)));
check("2.7 mission read is bounded", libCode.includes("MISSION_READ_LIMIT") && libCode.includes(".limit(MISSION_READ_LIMIT)"));

for (const forbidden of [".insert(", ".update(", ".delete(", ".rpc(", "functions.invoke", "sendMissionCard", "editMissionCard"]) {
  check(`2.8 panel has no mutation/transport call: ${forbidden}`, !panelCode.includes(forbidden));
  check(`2.9 analytics panel has no mutation/transport call: ${forbidden}`, !analyticsCode.includes(forbidden));
}
check("2.10 panel does not reuse the Owner Console fixture control", !panelCode.includes("SocialMissionTestControl") && !panelCode.includes("pepe_cartel_community_v1"));
check("2.11 owner console test controls left untouched", adminSrc.includes("<SocialMissionTestControl />") && adminSrc.includes("<BrandedSocialMissionTestControl />"));

// ---------------------------------------------------------------------------
// 3. Required mission fields are surfaced
// ---------------------------------------------------------------------------

check("3.1 status shown", panelCode.includes("mission.status"));
check("3.2 canonical URL shown", panelCode.includes("canonicalUrl"));
check("3.3 target community title shown", panelCode.includes("groupTitle"));
check("3.4 delivery state shown", panelCode.includes("target.delivery_state"));
check("3.5 edit state shown", panelCode.includes("target.edit_state"));
check("3.6 started/ends/completed shown", panelCode.includes("mission.started_at") && panelCode.includes("mission.ends_at") && panelCode.includes("mission.completed_at"));
check("3.7 remaining/expired derived client-side", panelCode.includes("missionTimeRemaining"));
check("3.8 schedule timeline rendered", panelCode.includes("scheduleEvents") && panelCode.includes("event.event_type") && panelCode.includes("event.due_at") && panelCode.includes("event.state"));
check("3.9 latest stored snapshot rendered", panelCode.includes("latestSnapshot"));
check("3.10 operator guidance present", panelCode.includes("MISSION_OPERATOR_GUIDANCE"));
check("3.11 start guidance text", MISSION_OPERATOR_GUIDANCE.start === "Start: /mission <X link>");
check("3.12 close guidance text", MISSION_OPERATOR_GUIDANCE.close === "Close: /mission close");

// ---------------------------------------------------------------------------
// 4. Analytics panel uses current data only
// ---------------------------------------------------------------------------

check("4.1 community count surfaced", analyticsCode.includes("connectedGroupCount"));
check("4.2 ready count surfaced", analyticsCode.includes("readyGroupCount"));
check("4.3 active/completed mission counts surfaced", analyticsCode.includes("rollup.active") && analyticsCode.includes("rollup.completed"));
check("4.4 delivery health counts surfaced", ["deliverySent", "deliveryPending", "deliveryAmbiguous", "deliveryFailed"].every((k) => analyticsCode.includes(`rollup.${k}`)));
check("4.5 analytics reuses the same read-only query", analyticsCode.includes("useWorkspaceMissions"));

// ---------------------------------------------------------------------------
// 5. Nav label only
// ---------------------------------------------------------------------------

check("5.1 sidebar label updated", navSrc.includes('label: "Community Command Center"'));
check("5.2 route unchanged in nav", navSrc.includes('to: "/telegram"'));
check("5.3 mobile label unchanged", navSrc.includes('mobileLabel: "Community"'));
check("5.4 no new nav destination added", (navSrc.match(/to: "\//g) ?? []).length === 14);

// ---------------------------------------------------------------------------
// 6. Pure helper behaviour
// ---------------------------------------------------------------------------

const base: MissionRow = {
  baseline_comments: null,
  baseline_likes: null,
  baseline_observed_at: null,
  baseline_saves: null,
  baseline_shares: null,
  baseline_views: null,
  completed_at: null,
  created_at: "2026-09-13T20:00:00.000Z",
  created_by: null,
  ends_at: null,
  id: "m1",
  metadata: {},
  social_post_id: "p1",
  started_at: null,
  status: "DRAFT",
  updated_at: "2026-09-13T20:00:00.000Z",
  workspace_id: "w1",
};

const now = Date.parse("2026-09-13T21:00:00.000Z");
check("6.1 draft mission is not active", !isMissionActive(base));
check("6.2 live mission without completion is active", isMissionActive({ ...base, status: "LIVE" }));
check("6.3 completed live mission is not active", !isMissionActive({ ...base, status: "LIVE", completed_at: "2026-09-13T20:45:00.000Z" }));
check("6.4 no ends_at reads as not started", missionTimeRemaining(base, now).label === "Not started");
check("6.5 future ends_at reports remaining minutes", missionTimeRemaining({ ...base, status: "LIVE", ends_at: "2026-09-13T21:30:00.000Z" }, now).label === "29m 60s left" || missionTimeRemaining({ ...base, status: "LIVE", ends_at: "2026-09-13T21:30:00.000Z" }, now).label === "30m 00s left");
check("6.6 past ends_at is expired", missionTimeRemaining({ ...base, status: "LIVE", ends_at: "2026-09-13T20:45:00.000Z" }, now).expired);
check("6.7 completed wins over ends_at", missionTimeRemaining({ ...base, completed_at: "2026-09-13T20:45:00.000Z", ends_at: "2026-09-13T21:30:00.000Z" }, now).label === "Completed");
check("6.8 LIVE tone is green", missionStatusTone("LIVE") === "green");
check("6.9 unsynced completion tone is red", missionStatusTone("COMPLETED_UNSYNCED") === "red");
check("6.10 ambiguous delivery is never green", deliveryTone("AMBIGUOUS") === "gold");
check("6.11 failed delivery is red", deliveryTone("FAILED") === "red");
check("6.12 cancelled event is muted", eventStateTone("CANCELLED") === "muted");
check("6.13 unknown metric renders as a dash, never zero", formatMetric(null) === "—" && formatMetric(undefined) === "—");
check("6.14 zero metric still renders zero", formatMetric(0) === "0");
check("6.15 null timestamp renders as a dash", formatMissionTime(null) === "—");

const views: MissionView[] = [
  {
    mission: { ...base, id: "a", status: "LIVE" },
    canonicalUrl: "https://x.com/demo/status/1",
    authorHandle: "demo",
    targets: [
      { workspace_id: "w1", id: "t1", mission_id: "a", delivery_state: "SENT", edit_state: "IDLE", telegram_chat_id: -1, groupTitle: "Alpha" } as never,
      { workspace_id: "w1", id: "t2", mission_id: "a", delivery_state: "AMBIGUOUS", edit_state: "IDLE", telegram_chat_id: -2, groupTitle: null } as never,
    ],
    scheduleEvents: [],
    latestSnapshot: null,
  },
  {
    mission: { ...base, id: "b", status: "COMPLETED", completed_at: "2026-09-13T20:45:00.000Z" },
    canonicalUrl: null,
    authorHandle: null,
    targets: [{ workspace_id: "w1", id: "t3", mission_id: "b", delivery_state: "FAILED", edit_state: "FAILED", telegram_chat_id: -3, groupTitle: null } as never],
    scheduleEvents: [],
    latestSnapshot: null,
  },
];
const rollup = rollupMissions(views);
check("6.16 rollup total", rollup.total === 2);
check("6.17 rollup active", rollup.active === 1);
check("6.18 rollup completed", rollup.completed === 1);
check("6.19 rollup delivery sent", rollup.deliverySent === 1);
check("6.20 rollup delivery ambiguous", rollup.deliveryAmbiguous === 1);
check("6.21 rollup delivery failed", rollup.deliveryFailed === 1);
check("6.22 empty rollup is all zero", rollupMissions([]).total === 0);

// ---------------------------------------------------------------------------
// 7. Negative tripwires — phase boundaries
// ---------------------------------------------------------------------------

const allNewSources = `${libCode}\n${panelCode}\n${analyticsCode}`;
for (const forbidden of ["oauth", "OAuth", "connect_x", "contributor", "Contributor", "reward", "points_", "stripe", "Stripe", "price_", "billing"]) {
  check(`7.1 no out-of-phase concept: ${forbidden}`, !allNewSources.includes(forbidden));
}
check("7.2 no second navigation system introduced", !routeCode.includes("SidebarNav") && !routeCode.includes("MobileTabBar"));
check("7.3 tab bar remains a single Tabs list", (routeCode.match(/<TabsList/g) ?? []).length === 1);

// ---------------------------------------------------------------------------

console.log(`Community Command Center unification regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
