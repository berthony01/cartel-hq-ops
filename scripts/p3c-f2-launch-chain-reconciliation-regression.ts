/**
 * P3C-F2 — LAUNCH CHAIN METADATA RECONCILIATION regression (APPLIED/parity state).
 *
 * SOURCE/TEXT-LEVEL ONLY. This script never connects to a database, never
 * executes SQL and never applies anything. It parses the reference artifact and
 * the source-control parity migration, proves they carry identical safety
 * semantics, and proves the absence of everything the checkpoint forbids.
 */
import { readFileSync, readdirSync } from "node:fs";

const SQL = "docs/sql/20260907062000_reconcile_pepecartel_launch_chain_to_robinhood.sql";
const PARITY_VERSION = "20260907135738";
const PARITY_NAME = "reconcile_pepecartel_launch_chain_to_robinhood";
const PARITY = `supabase/migrations/${PARITY_VERSION}_${PARITY_NAME}.sql`;
const sql = readFileSync(SQL, "utf8");
const parity = readFileSync(PARITY, "utf8");
/** Statement text with SQL line comments removed, so prose cannot pass a check. */
const code = sql.replace(/^\s*--.*$/gm, "");
const parityCode = parity.replace(/^\s*--.*$/gm, "");

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* A — applied, with exactly one parity migration at the real live version. */
const f2Migrations = readdirSync("supabase/migrations").filter((f) =>
  /pepecartel_launch_chain/i.test(f),
);
check("A1", f2Migrations.length === 1, `exactly one F2 migration file exists (found ${f2Migrations.length})`);
check("A2", f2Migrations[0] === `${PARITY_VERSION}_${PARITY_NAME}.sql`, "it is at the actual live version/name");
check(
  "A3",
  !readdirSync("supabase/migrations").some((f) => f.startsWith("20260907062000")),
  "no second executable migration exists at the old staged version",
);
check("A4", /APPLIED EXTERNALLY/.test(parity), "the parity record is marked APPLIED EXTERNALLY");
check(
  "A5",
  parity.includes(PARITY_VERSION) && parity.includes(PARITY_NAME),
  "the parity record states the live migration version and name",
);
check(
  "A6",
  /^-- APPLIED\./m.test(sql) && sql.includes(PARITY_VERSION) && sql.includes(PARITY),
  "the reference copy is marked APPLIED and points at the parity path",
);
check("A7", !/PREPARED, NOT APPLIED/.test(sql), "the reference copy no longer claims prepared-not-applied");
check("A8", parityCode.trim() === code.trim(), "reference and parity SQL bodies are semantically identical");


/* B — concurrency: the lock precedes any bypass. */
const lockAt = code.indexOf("LOCK TABLE public.launches IN ACCESS EXCLUSIVE MODE");
const disableAt = code.indexOf("DISABLE TRIGGER");
check("B1", lockAt > -1, "takes an ACCESS EXCLUSIVE lock on public.launches");
check("B2", disableAt > lockAt, "the lock is taken BEFORE the trigger is disabled");

/* C — every required precondition is present. */
for (const [id, pattern, detail] of [
  ["C1", /public_slug = 'pepecartel-launch'/, "targets the stable slug"],
  ["C2", /token_name <> 'PEPECARTEL'/, "token_name guard"],
  ["C3", /ticker <> '\$PCART'/, "display ticker guard"],
  ["C4", /chain <> 'Solana'/, "stale chain guard"],
  ["C5", /status <> 'WATCHLIST_OPEN'/, "status guard"],
  ["C6", /official_contract_address IS NOT NULL/, "official contract address guard"],
  ["C7", /official_contract_deployment_id IS NOT NULL/, "official contract deployment guard"],
  ["C8", /primary_chain = 'Robinhood Chain'/, "linked profile primary_chain guard"],
  ["C9", /launch_chain_deployments[\s\S]{0,200}network_environment = 'PRODUCTION'/, "no production deployment guard"],
  ["C10", /control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'[\s\S]{0,160}execution_enabled = false[\s\S]{0,80}emergency_stop_engaged = true/, "runtime control stopped guard"],
  ["C11", /presign_authorizations[\s\S]{0,400}expires_at > now\(\)/, "open presign guard"],
  ["C12", /canary_permits[\s\S]{0,240}expires_at > now\(\)/, "unexpired canary permit guard"],
  ["C13", /send_window_issuances/, "send-window issuance guard"],
  ["C14", /launch_contract_registration_events[\s\S]{0,120}launch_id = v_launch\.id/, "target-scoped registration-event guard"],
] as const) {
  check(id, pattern.test(code), detail);
}
check(
  "C15",
  (code.match(/RAISE EXCEPTION/g) ?? []).length >= 14,
  "every guard fails closed with an exception",
);
check(
  "C16",
  !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i.test(code),
  "no generated launch/profile UUID is hardcoded",
);

/* D — exactly one named trigger is disabled and re-enabled. */
check(
  "D1",
  /tgfoid = 'public\.enforce_launch_update_rules'::regproc/.test(code) &&
    /v_trigger_name <> 'enforce_launch_update_rules_trigger'/.test(code),
  "the identity-lock trigger is resolved exactly and its name asserted",
);
check(
  "D2",
  !/DISABLE TRIGGER (ALL|USER)/i.test(code) && !/ENABLE TRIGGER (ALL|USER)/i.test(code),
  "never disables/enables ALL or USER triggers",
);
check(
  "D3",
  (code.match(/DISABLE TRIGGER/g) ?? []).length === 1 &&
    (code.match(/ENABLE TRIGGER/g) ?? []).length === 1,
  "exactly one disable and one matching re-enable",
);
check(
  "D4",
  !/enforce_launch_contract_update|launches_record_schedule_change|enforce_launch_status_transition/.test(code),
  "the contract, schedule and status triggers are never touched",
);
check(
  "D5",
  code.indexOf("ENABLE TRIGGER") > code.indexOf("UPDATE public.launches"),
  "the trigger is re-enabled after the repair statement",
);

/* E — the repair itself is a single narrow statement. */
const updates = code.match(/\bUPDATE\s+[a-z_.]+/gi) ?? [];
check("E1", updates.length === 1 && /UPDATE public\.launches/i.test(updates[0]!), "exactly one UPDATE, on public.launches");
check(
  "E2",
  /SET chain = 'Robinhood Chain'\s*\n\s*WHERE public_slug = 'pepecartel-launch'\s*\n\s*AND chain = 'Solana'/.test(code),
  "sets ONLY chain, only for the stale value on the target slug",
);
check(
  "E3",
  /GET DIAGNOSTICS v_rows = ROW_COUNT;/.test(code) && /v_rows <> 1/.test(code),
  "requires exactly one affected row",
);
check(
  "E4",
  !/\bINSERT\s+INTO\b/i.test(code) && !/\bDELETE\s+FROM\b/i.test(code) && !/\bTRUNCATE\b/i.test(code),
  "no INSERT, DELETE or TRUNCATE anywhere",
);

/* F — no schema, policy, function or reverse-migration surface. */
for (const term of [
  "CREATE (OR REPLACE )?FUNCTION",
  "DROP TRIGGER",
  "CREATE TRIGGER",
  "CREATE POLICY",
  "DROP POLICY",
  "\\bGRANT\\b",
  "\\bREVOKE\\b",
  "ALTER TABLE public\\.launches (ADD|DROP|ALTER) COLUMN",
  "ALTER DATABASE",
  "SECURITY DEFINER",
  "'Solana'::text",
  "SET chain = 'Solana'",
]) {
  check(`F:${term}`, !new RegExp(term, "i").test(code), `no \`${term}\` in the artifact`);
}

/* G — no production action can be triggered by applying this. */
for (const term of [
  "arm_launch_chain_production_canary_execution",
  "authorize_launch_chain_production_send_window_issuance",
  "issue_launch_chain_production_presign_authorization",
  "claim_launch_chain_production_presign_authorization",
  "create_launch_chain_production_token_deployment_attempt",
  "register_official_contract",
  "engage_launch_chain_production_emergency_stop",
  "execution_enabled = true",
  "emergency_stop_engaged = false",
  "telegram",
  "pg_notify",
  "net\\.http",
]) {
  check(`G:${term}`, !new RegExp(term, "i").test(code), `no \`${term}\` path in the artifact`);
}

/* H — postconditions. */
check(
  "H1",
  /postcondition failed, % repaired row\(s\)/.test(sql) &&
    /chain = 'Robinhood Chain'/.test(code),
  "asserts exactly one row now records Robinhood Chain",
);
check(
  "H2",
  /a field other than chain changed/.test(sql) &&
    /v_after\.launch_watch_token\s+IS DISTINCT FROM/.test(code) &&
    /v_after\.ticker\s+IS DISTINCT FROM/.test(code),
  "asserts every other identity/contract/schedule field is unchanged",
);
check(
  "H3",
  /IS DISTINCT FROM 'O'::"char"/.test(code),
  "asserts the identity-lock trigger is back in the enabled state (tgenabled='O')",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
