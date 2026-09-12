/**
 * SE-1 Cartel Social Engine schema/RLS foundation — source-only regression.
 *
 * Read-only. Performs NO database access, NO provider call, NO Telegram call.
 * It asserts that the repository parity copies of the two applied migrations, plus the
 * generated Supabase types, describe the intended FINAL COMBINED state.
 *
 * The first migration's mission-target policies are an intentional intermediate state;
 * the second hardening migration replaces them. Assertions below evaluate the combined
 * result, never the first file in isolation.
 *
 * Run: bunx tsx scripts/se1-social-engine-schema-regression.ts
 *   or: bun scripts/se1-social-engine-schema-regression.ts
 */
import { readFileSync } from "node:fs";

const FOUNDATION = "docs/sql/20260912222624_se1_social_engine_schema_foundation.sql";
const HARDENING = "docs/sql/20260912222700_se1_social_engine_target_integrity_hardening.sql";
const TYPES = "src/integrations/supabase/types.ts";

const foundation = readFileSync(FOUNDATION, "utf8");
const hardening = readFileSync(HARDENING, "utf8");
const types = readFileSync(TYPES, "utf8");

const SOCIAL_TABLES = [
  "social_sources",
  "social_posts",
  "social_missions",
  "social_mission_targets",
  "social_metric_snapshots",
] as const;

let failures = 0;
function check(id: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`);
}

/** Final policy text for social_mission_targets = hardening file only. */
function finalTargetPolicies(): string {
  return hardening;
}

// --- 1. Tables exist in the parity migration and in generated types ------------------
for (const table of SOCIAL_TABLES) {
  check(
    `table:${table}`,
    foundation.includes(`create table public.${table} (`),
    "created in the SE-1 foundation parity copy",
  );
  check(
    `types:${table}`,
    new RegExp(`^ {6}${table}: \\{$`, "m").test(types),
    "present in generated Supabase types",
  );
}

// --- 2. RLS enabled and forced on all five ------------------------------------------
for (const table of SOCIAL_TABLES) {
  check(
    `rls:${table}`,
    foundation.includes(`alter table public.${table} enable row level security;`) &&
      foundation.includes(`alter table public.${table} force row level security;`),
    "row level security enabled AND forced",
  );
}

// --- 3. No anon access anywhere -----------------------------------------------------
const anonGrant = /grant[^;]*\bto\b[^;]*\banon\b/i.test(foundation + hardening);
check("grants:no-anon", !anonGrant, "no grant to anon on any SE-1 table");
for (const table of SOCIAL_TABLES) {
  check(
    `grants:revoke:${table}`,
    foundation.includes(
      `revoke all on table public.${table} from public, anon, authenticated, service_role;`,
    ),
    "baseline revoke from public/anon/authenticated/service_role",
  );
}

// --- 4. Member SELECT on all five ---------------------------------------------------
for (const table of SOCIAL_TABLES) {
  check(
    `policy:select-member:${table}`,
    foundation.includes(
      `create policy ${table}_select_member on public.${table} for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())))`,
    ),
    "workspace-member SELECT policy",
  );
}

// --- 5. Observation tables are read-only for authenticated --------------------------
for (const table of ["social_posts", "social_metric_snapshots"] as const) {
  check(
    `grants:observation:${table}`,
    foundation.includes(`grant select on table public.${table} to authenticated;`) &&
      !foundation.includes(`grant select, insert, update, delete on table public.${table} to authenticated;`),
    "authenticated has SELECT only",
  );
  const writePolicy = new RegExp(
    `create policy ${table}_(insert|update|delete)`,
    "",
  ).test(foundation + hardening);
  check(`policy:observation-no-write:${table}`, !writePolicy, "no authenticated write policy exists");
}
check(
  "grants:service_role:social_metric_snapshots",
  foundation.includes("grant select, insert on table public.social_metric_snapshots to service_role;"),
  "service_role limited to SELECT + INSERT",
);
check(
  "grants:service_role:social_posts",
  foundation.includes("grant select, insert, update on table public.social_posts to service_role;"),
  "service_role limited to SELECT + INSERT + UPDATE",
);

// --- 6. Operator write boundary on sources and missions -----------------------------
for (const verb of ["insert", "update", "delete"] as const) {
  check(
    `policy:sources-operator-${verb}`,
    new RegExp(`create policy social_sources_${verb}_operator[\\s\\S]*?is_workspace_operator`).test(foundation),
    "owner/admin gate via is_workspace_operator",
  );
}
check(
  "policy:missions-operator-write",
  /create policy social_missions_insert_operator[\s\S]*?is_workspace_operator/.test(foundation) &&
    /create policy social_missions_update_operator[\s\S]*?is_workspace_operator/.test(foundation),
  "owner/admin create + update on missions",
);
check(
  "policy:missions-delete-draft-only",
  /create policy social_missions_delete_draft_operator[\s\S]*?is_workspace_operator[\s\S]*?status = 'DRAFT'/.test(
    foundation,
  ),
  "mission delete restricted to DRAFT",
);

// --- 7. FINAL mission-target integrity (hardening migration is authoritative) -------
const finalTargets = finalTargetPolicies();
check(
  "hardening:drops-intermediate-policies",
  ["insert_operator", "update_operator", "delete_draft_operator"].every((p) =>
    hardening.includes(`drop policy social_mission_targets_${p} on public.social_mission_targets;`),
  ),
  "all three intermediate target policies dropped",
);
check(
  "hardening:composite-fk",
  hardening.includes(
    "foreign key (group_connection_id, workspace_id, telegram_chat_id)",
  ) &&
    hardening.includes(
      "references public.telegram_group_connections(id, workspace_id, telegram_chat_id)",
    ) &&
    hardening.includes("on delete set null (group_connection_id)"),
  "workspace + exact Telegram chat enforced by composite FK, SET NULL on group only",
);
check(
  "hardening:old-fk-dropped",
  hardening.includes("drop constraint social_mission_targets_group_workspace_fkey;"),
  "two-column group FK replaced",
);
check(
  "final:target-insert-requires-group",
  /create policy social_mission_targets_insert_operator[\s\S]*?is_workspace_operator\(social_mission_targets\.workspace_id[\s\S]*?social_mission_targets\.group_connection_id is not null/.test(
    finalTargets,
  ),
  "insert requires operator AND non-null group connection",
);
check(
  "final:target-policies-qualified",
  !/\bwith check \(\s*public\.is_workspace_operator\(workspace_id,/.test(finalTargets),
  "final target policies use qualified column references (no ambiguous correlated names)",
);
check(
  "final:target-delete-draft-only",
  /create policy social_mission_targets_delete_draft_operator[\s\S]*?m\.status = 'DRAFT'/.test(finalTargets),
  "target delete restricted to DRAFT missions",
);
check(
  "types:target-composite-fk",
  types.includes('foreignKeyName: "social_mission_targets_group_workspace_chat_fkey"') &&
    types.includes('columns: ["group_connection_id", "workspace_id", "telegram_chat_id"]'),
  "generated types reflect the hardened composite FK",
);

// --- 8. Metric contract: nullable metrics, idempotent bucket ------------------------
for (const metric of ["views", "likes", "comments", "shares", "saves"] as const) {
  check(
    `metrics:nullable:${metric}`,
    new RegExp(`^  ${metric} bigint,$`, "m").test(foundation),
    "nullable, never coerced to zero",
  );
}
check(
  "metrics:idempotency",
  foundation.includes(
    "constraint social_metric_snapshots_mission_provider_bucket_unique unique (mission_id, provider, poll_bucket)",
  ),
  "unique (mission_id, provider, poll_bucket)",
);

// --- 9. Scope lock: nothing outside schema/RLS --------------------------------------
check(
  "scope:auto-detect-default-off",
  foundation.includes("auto_detect_enabled boolean not null default false"),
  "no polling enabled by default",
);
check(
  "scope:no-usage-ledger-change",
  !/usage_ledger/.test(foundation + hardening),
  "usage_ledger untouched by SE-1",
);
check(
  "scope:no-cron-or-http",
  !/pg_cron|cron\.schedule|pg_net|http_post|net\.http/i.test(foundation + hardening),
  "no cron, no outbound HTTP from the database",
);
check(
  "scope:no-security-definer-rpc",
  !/security definer/i.test(foundation + hardening),
  "no new SECURITY DEFINER function introduced",
);
check(
  "scope:no-enum-types",
  !/create type .* as enum/i.test(foundation + hardening),
  "text + CHECK constraints only, matching repo convention",
);

console.log(
  failures === 0
    ? "\nSE-1 schema regression: ALL CHECKS PASSED"
    : `\nSE-1 schema regression: ${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
