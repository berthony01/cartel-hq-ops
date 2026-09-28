/* Partner Program Phase 1B release regression: docs, staged-only state, scope. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

let passed = 0, failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) passed++; else { failed++; console.log(`FAIL ${id}${detail ? " — " + detail : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const BASE = "0286783ad58e3bae372d76214ce51d45c992e2f4";

const CL = read("docs/PARTNER_1B_RELEASE_CHECKLIST.md");
const RB = read("docs/PARTNER_1B_ACTIVATION_ROLLBACK_RUNBOOK.md");
check("R-1 checklist header", CL.includes("STAGED, NOT APPROVED FOR PRODUCTION. NOTHING IN THIS DOCUMENT HAS BEEN EXECUTED."));
check("R-2 runbook staged-only", RB.includes("STAGED ONLY. NOT EXECUTED."));
for (const g of ["Legal operator name", "Mailing address", "Formation jurisdiction", "Support / legal email", "U.S.-only launch", "Attorney review", "Texas sales-tax", "subprocessor"])
  check(`R-3 gate BLOCKED: ${g}`, new RegExp(`${g.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^\\n]*\\| BLOCKED`).test(CL));
check("R-4 non-waivable note", CL.includes("does **not** remove non-waivable"));
for (const cp of ["CP-SQL", "CP-EDGE", "CP-STRIPE", "CP-TERMS", "CP-PUBLISH"]) check(`R-5 checkpoint ${cp}`, CL.includes(cp));
check("R-6 publication + activation not done", /Publication \(separate explicit approval\) \| NOT DONE/.test(CL));
check("R-7 pre-existing failures listed", ["B-13.5", "2.2 telegram", "1.1 migration count", "10.1"].every((x) => CL.includes(x)));
check("R-8 rollback preserves financial rows", RB.includes("Never delete or rewrite ledger") && RB.includes("missed commission events") && RB.includes("Prefer forward-fix"));
check("R-9 runbook has no secrets", !/sk_(live|test)_|whsec_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}/.test(CL + RB));
check("R-10 STOP conditions", ["Duplicate accrual", "beyond an invoice", "PGRST202", "entitlement regression"].every((x) => RB.includes(x)));

// Staged-only: no Phase 1B SQL in migrations; migrations unchanged since baseline.
const migs = readdirSync("supabase/migrations");
check("R-11 no partner 1B migration files", !migs.some((m) => /1b|policy_accept|referral_click|commission_accounting/i.test(m)));
const changed = execSync(`git diff --name-only ${BASE}`, { encoding: "utf8" }).split("\n").filter(Boolean);
const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const all = [...changed, ...untracked];
check("R-12 no migrations/supabase functions changed", !all.some((f) => f.startsWith("supabase/")), all.filter((f) => f.startsWith("supabase/")).join(","));
check("R-13 no PCART/chain/liquidity/launcher/wallet/telegram files", !all.some((f) => /chain-|pcart|liquidity|wallet|launcher|telegram|treasury/i.test(f) && !f.startsWith("scripts/") && !f.startsWith("docs/")));
check("R-14 no billing-portal or shared billing change", !all.some((f) => /billing-portal|_shared\/(stripe-billing|commercial-access)/.test(f)));
check("R-15 staged SQL files exist", ["1_policy_acceptance", "2_referral_click_tokens", "3_commission_accounting"].every((s) => existsSync(`docs/sql/PARTNER_1B_${s}.sql`)));
const RM = read("roadmap.md");
check("R-16 roadmap: 1B-5 done, activation/publish blocked", /\[x\] Partner 1B-5/.test(RM) && /activation[^\n]*BLOCKED/i.test(RM) && /publication[^\n]*BLOCKED/i.test(RM));

console.log(`partner-program-1b-release-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
