/**
 * SE-6 — CARTEL SOCIAL mission tiers / pulse crossings / saved presets.
 *
 * Deterministic and offline: ZERO network, ZERO database, ZERO Telegram,
 * ZERO X. It asserts the frozen SE-6 contract against the repository sources.
 */

import { readFileSync } from "node:fs";

import {
  REFRESH_INTERVAL_MINUTES,
  refreshBucket,
  DEFAULT_PULSE_DELTAS,
  normalizePulseDeltas,
  evaluatePulseCrossings,
  buildCrossingPulseText,
  MILESTONE_ACTIVE,
  MILESTONE_TRENDING,
  MILESTONE_CLOSING_SOON,
  MILESTONE_COMPLETED,
  MILESTONE_KEYS,
  TIER_COUNT,
  tierKey,
  normalizeTierTargets,
  tierIsMet,
  highestTierMet,
  TRENDING_TIER,
  isClosingSoon,
  X_LINK_UNAVAILABLE_LABEL,
  isXLinkStatus,
} from "../backend-source/edge-functions/_shared/mission-progress.ts";

import {
  DEFAULT_PULSE_DELTAS as UI_PULSE_DELTAS,
  DEFAULT_TIER_TARGETS as UI_TIER_TARGETS,
  TIER_COUNT as UI_TIER_COUNT,
  blankTierPreset,
  defaultMissionSettings,
  normalizeTierTargets as uiNormalizeTierTargets,
  normalizePulseDeltas as uiNormalizePulseDeltas,
  tierSummaryChips,
  validateTierPreset,
} from "../src/lib/social-mission-settings.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SQL = read("docs/sql/SE6_mission_tiers_pulse_presets.sql");
const RUNNER = read("backend-source/edge-functions/social-mission-runner/index.ts");
const WEBHOOK = read("supabase/functions/telegram-webhook/index.ts");
const PROGRESS = read("backend-source/edge-functions/_shared/mission-progress.ts");
const PANEL = read("src/components/cartel/SocialMissionsPanel.tsx");
const SETTINGS_CARD = read("src/components/cartel/MissionSettingsCard.tsx");
const SETTINGS_LIB = read("src/lib/social-mission-settings.ts");

/* ---------------------------------------------------------------- 1. metrics */

check("shared module never fetches", !/\bfetch\s*\(/.test(PROGRESS));
check("shared module has no network host", !/https?:\/\//.test(PROGRESS.replace(/https?:\/\/[^\s]*x\.com[^\s]*/g, "")));
check("runner reads only the official X module", RUNNER.includes('from "../_shared/x-metrics.ts"'));
check("runner maps views/likes/comments/shares/saves", /_views: hit\.metrics\.views/.test(RUNNER) && /_saves: hit\.metrics\.saves/.test(RUNNER));
check("no synthetic zero fill for metrics", !/metrics\.(views|likes|comments|shares|saves)\s*\?\?\s*0/.test(RUNNER));

/* ------------------------------------------------- 2. five-minute central refresh */

check("refresh interval is five minutes", REFRESH_INTERVAL_MINUTES === 5);
check(
  "refresh bucket floors to a five-minute boundary",
  refreshBucket(Date.parse("2026-01-01T00:07:31.500Z")) === "2026-01-01T00:05:00.000Z",
);
check(
  "every second inside one window shares a bucket",
  refreshBucket(Date.parse("2026-01-01T00:05:00Z")) ===
    refreshBucket(Date.parse("2026-01-01T00:09:59Z")),
);
check("runner uses the five-minute bucket for the work list", /list_social_missions_due_for_metrics/.test(RUNNER));
check("runner passes the same bucket to the snapshot", /_poll_bucket: bucket/.test(RUNNER));
check(
  "work list excludes missions already snapshotted in the bucket",
  /NOT EXISTS[\s\S]{0,220}poll_bucket = _bucket/.test(SQL),
);
check("no browser-side provider call", !/api\.x\.com/.test(PANEL) && !/api\.x\.com/.test(SETTINGS_LIB));
check("panel performs no mutation", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(PANEL));

/* ------------------------------------------------------- 3. one canonical card */

check("runner edits, never re-sends, the card", /action: "edit_mission"/.test(RUNNER));
check("runner never calls sendPhoto", !/callTelegram\([^,]+, "sendPhoto"/.test(RUNNER));
check("card edit is gated on the visible signature", /signature === row\.last_metric_signature/.test(RUNNER));
check("card edit claim is atomic", /claim_social_mission_card_refresh/.test(RUNNER));
check("footer legend is stable and shared", /MISSION_FOOTER_LEGEND/.test(PROGRESS));

/* ------------------------------------------------------ 4. pulse crossings */

check("default deltas are +100/+10/+5/+5", DEFAULT_PULSE_DELTAS.views === 100 && DEFAULT_PULSE_DELTAS.likes === 10 && DEFAULT_PULSE_DELTAS.shares === 5 && DEFAULT_PULSE_DELTAS.comments === 5);
check("UI mirrors the frozen deltas", JSON.stringify(UI_PULSE_DELTAS) === JSON.stringify(DEFAULT_PULSE_DELTAS));
check("malformed deltas fall back", JSON.stringify(normalizePulseDeltas({ views: 0, likes: "x" })) === JSON.stringify(DEFAULT_PULSE_DELTAS));

const MARKS = { views: 500, likes: 20, shares: 2, comments: 4 };

const seed = evaluatePulseCrossings(null, {
  views: 500,
  likes: 20,
  comments: 4,
  shares: 2,
  saves: null,
});
check("first observation only seeds the marks", seed.crossings.length === 0);
check("seeding never pulses", buildCrossingPulseText(seed.crossings) === null);
check("seeded marks are the first observation", seed.nextMarks.views === 500);

const noGain = evaluatePulseCrossings(MARKS, {
  views: 540,
  likes: 25,
  comments: 5,
  shares: 3,
  saves: null,
});
check("partial gain does not pulse", noGain.crossings.length === 0);
check("a partial gain carries forward", noGain.nextMarks.views === 500);

const crossed = evaluatePulseCrossings(MARKS, {
  views: 705,
  likes: 41,
  comments: 9,
  shares: 7,
  saves: null,
});
check("crossing fires once past the step", crossed.crossings.length > 0);
check("simultaneous crossings are combined", crossed.crossings.length === 4);
check(
  "combined crossings render one line",
  (buildCrossingPulseText(crossed.crossings) ?? "").split("·").length === 4,
);
check("no crossing renders nothing", buildCrossingPulseText([]) === null);

const replay = evaluatePulseCrossings(crossed.nextMarks, {
  views: 705,
  likes: 41,
  comments: 9,
  shares: 7,
  saves: null,
});
check("the same crossing never pulses twice", replay.crossings.length === 0);
check("marks advance by whole steps only", crossed.nextMarks.views === 700);
check(
  "unknown metric cannot cross",
  evaluatePulseCrossings(MARKS, {
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
  }).crossings.length === 0,
);
check(
  "a decreasing metric never moves the mark backwards",
  evaluatePulseCrossings(MARKS, { views: 100, likes: 1, comments: 1, shares: 1, saves: null })
    .nextMarks.views === 500,
);
check("crossing evaluation is atomic in SQL", /FOR UPDATE/.test(SQL) && /evaluate_social_mission_pulse/.test(SQL));
check("pulse message is reply-only sendMessage", /sendMessage/.test(RUNNER) && /reply_to_message_id/.test(RUNNER));
check("pulse cleanup stays at 120 seconds", /PULSE_LIFETIME_SECONDS = 120/.test(RUNNER));
check("pulse cleanup reuses the existing kind", /cleanup_kind: "social_mission_pulse"/.test(RUNNER));

/* ------------------------------------------------------ 5. milestone events */

check("mission active milestone exists", MILESTONE_ACTIVE === "MISSION_ACTIVE");
check("trending milestone exists", MILESTONE_TRENDING === "PROJECT_TRENDING");
check("closing soon milestone exists", MILESTONE_CLOSING_SOON === "MISSION_CLOSING_SOON");
check("completed milestone exists", MILESTONE_COMPLETED === "MISSION_COMPLETED");
check("ten tiers are defined", TIER_COUNT === 10 && tierKey(7) === "TIER_7");
check("milestone key set is 14 keys", MILESTONE_KEYS.length === 14);
check("milestone idempotency is a unique index", /social_mission_milestone_events_uidx/.test(SQL));
check("milestone RPC returns first-entry only", /record_social_mission_milestone/.test(SQL) && /record_social_mission_milestone/.test(RUNNER));
check("runner marks mission active", RUNNER.includes("MILESTONE_ACTIVE"));
check("runner marks completion at the complete event", RUNNER.includes("MILESTONE_COMPLETED"));
check("trending is derived from a tier", TRENDING_TIER >= 1 && TRENDING_TIER <= TIER_COUNT);
check("closing soon uses the refresh window", isClosingSoon(new Date(Date.now() + 60_000).toISOString()) === true);
check("a distant end is not closing soon", isClosingSoon(new Date(Date.now() + 60 * 60_000).toISOString()) === false);
check("a missing end time is not closing soon", isClosingSoon(null) === false);

const targets = normalizeTierTargets([{ tier: 1, views: 100, likes: 5, shares: null, comments: null }]);
check("tier normalization always yields ten rows", targets.length === TIER_COUNT);
check("an unmet target blocks the tier", tierIsMet({ views: 99, likes: 5, comments: null, shares: null, saves: null }, targets[0]!) === false);
check("a met target passes the tier", tierIsMet({ views: 100, likes: 5, comments: null, shares: null, saves: null }, targets[0]!) === true);
check("an unknown metric blocks the tier", tierIsMet({ views: null, likes: 5, comments: null, shares: null, saves: null }, targets[0]!) === false);
check("highest tier met is monotonic", highestTierMet({ views: 100, likes: 5, comments: null, shares: null, saves: null }, targets) === 1);
check("no tier met returns zero", highestTierMet({ views: 1, likes: 1, comments: null, shares: null, saves: null }, targets) === 0);

/* ----------------------------------------------------------- 6. saved presets */

check("preset table is workspace scoped", /CREATE TABLE IF NOT EXISTS public\.social_mission_presets/.test(SQL));
check("preset names are unique per workspace", /social_mission_presets_workspace_name_uidx/.test(SQL));
check("presets grant member SELECT", /GRANT SELECT[^;]*ON TABLE public\.social_mission_presets TO authenticated/.test(SQL));
check("presets enable RLS", /ALTER TABLE public\.social_mission_presets ENABLE ROW LEVEL SECURITY/.test(SQL));
check("preset write is operator only", /social_mission_presets[\s\S]{0,900}is_workspace_operator/.test(SQL));
check("settings point at one active preset", /active_preset_id/.test(SQL) && /active_preset_id/.test(SETTINGS_LIB));
check("UI exposes ten editable tiers", UI_TIER_COUNT === 10 && UI_TIER_TARGETS.length === 10);
check("UI has a saved preset dropdown", /Saved preset/.test(SETTINGS_CARD));
check("UI shows a saved badge", /StatusBadge tone="gold">Saved</.test(SETTINGS_CARD));
check("UI shows compact summary chips", /tierSummaryChips/.test(SETTINGS_CARD));
check("mission code is optional", /Mission code \(optional\)/.test(SETTINGS_CARD));
check("a blank preset seeds the defaults", blankTierPreset("w").tier_targets.length === 10);
check("an unnamed preset is rejected", validateTierPreset(blankTierPreset("w")) !== null);
check(
  "a preset with no target at all is rejected",
  validateTierPreset({ ...blankTierPreset("w"), name: "Empty", tier_targets: uiNormalizeTierTargets([]) }) !== null,
);
check(
  "a named preset with one tier is accepted",
  validateTierPreset({ ...blankTierPreset("w"), name: "Launch day" }) === null,
);
check("chips skip empty tiers", tierSummaryChips({ ...blankTierPreset("w"), tier_targets: uiNormalizeTierTargets([{ tier: 2, views: 10 }]) }).length === 1);
check("UI delta normalization matches the worker", JSON.stringify(uiNormalizePulseDeltas({})) === JSON.stringify(DEFAULT_PULSE_DELTAS));
check("existing presets are adapted, not replaced", /base_preset/.test(SQL) && /STANDARD/.test(SQL) && /MAJOR_ANNOUNCEMENT/.test(SQL));
check("wallet targets are not introduced", !/wallet_target|wallet holders/i.test(SQL) && !/wallet/i.test(SETTINGS_CARD));

/* ------------------------------------------------------ 7. performance history */

check("history table exists", /CREATE TABLE IF NOT EXISTS public\.social_mission_performance_history/.test(SQL));
check("history is one row per mission", /ON CONFLICT \(mission_id\) DO NOTHING/.test(SQL));
check("history finalization is idempotent", /ON CONFLICT \(mission_id\) DO NOTHING/.test(SQL));
check("runner finalizes history at completion", /finalize_social_mission_performance/.test(RUNNER));
check("history is readable by members", /GRANT SELECT ON TABLE public\.social_mission_performance_history TO authenticated/.test(SQL));

/* ---------------------------------------------------------- 8. X link status */

check("link status is a known set", isXLinkStatus("OK") && isXLinkStatus("UNAVAILABLE") && isXLinkStatus("UNKNOWN") && !isXLinkStatus("GONE"));
check("runner records link status", /record_social_mission_link_status/.test(RUNNER));
check("a missing post marks UNAVAILABLE", /_status: "UNAVAILABLE"/.test(RUNNER));
check("a resolved post marks OK", /_status: "OK"/.test(RUNNER));
check("a provider outage does not mark UNAVAILABLE", /if \(!anyLookupOk\) return stats;/.test(RUNNER));
check("an unavailable link never closes the mission", !/UNAVAILABLE[\s\S]{0,200}COMPLETED/.test(RUNNER));
check("HQ surfaces the unavailable label", PANEL.includes("X link unavailable"));
check("the shared label is frozen", X_LINK_UNAVAILABLE_LABEL === "X link unavailable");

/* ------------------------------------------------------------ safety rails */

check("auto-pin is opt-in in the webhook", /auto_pin_mission"\] === true/.test(WEBHOOK));
check("auto-pin defaults to off in HQ", defaultMissionSettings("w").auto_pin_mission === false);
check("the migration flips the stored default to false", /auto_pin_mission SET DEFAULT false/.test(SQL));
check("no Connect X surface was added", !/oauth/i.test(SETTINGS_CARD) && !/Connect X/.test(SETTINGS_CARD));
check("no reward or points mechanic", !/reward|points/i.test(PROGRESS) && !/reward|points/i.test(SETTINGS_CARD));
check("no second scheduler was created", !/cron\.schedule/.test(SQL));
check("mission creation stays in Telegram", /\/mission/.test(PANEL));
check("service-only RPCs revoke public access", /REVOKE ALL ON FUNCTION[\s\S]{0,400}FROM PUBLIC/.test(SQL));
check("browser code never uses the service role", !/service_role/.test(SETTINGS_LIB) && !/service_role/.test(PANEL));

console.log(`SE-6 mission tiers / pulse / presets: ${passed}/${passed + failures.length} passed`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
