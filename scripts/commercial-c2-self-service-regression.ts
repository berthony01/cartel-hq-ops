// COMMERCIAL C2 — self-service Free flow static regression.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const read = (p: string) => readFileSync(p, "utf8");

const sql = read("docs/sql/COMMERCIAL_C2_self_service_workspace.sql");
const exec = sql.replace(/--.*$/gm, "");
const MIG = "supabase/migrations/20260927171231_commercial_c2_self_service_workspace.sql";
const mig = read(MIG);
const migExec = mig.replace(/--.*$/gm, "");
check("A0 exact applied migration 20260927171231 exists with the RPC", mig.includes("create_self_service_workspace") && mig.includes("BEGIN;") && mig.includes("COMMIT;"));
check("A0b migration executable body identical to review SQL", migExec.replace(/\s+/g, " ").trim() === exec.replace(/\s+/g, " ").trim());
check("A0c docs say APPLIED as migration 20260927171231", /APPLIED as Supabase migration 20260927171231 \/ commercial_c2_self_service_workspace/.test(sql) && !/STAGED FOR REVIEW|NOT APPLIED/.test(sql.split("BEGIN;")[0] ?? ""));
const types = read("src/integrations/supabase/types.ts");
check("A0d generated types include the RPC returning string", /create_self_service_workspace: \{\s*Args: \{ _name: string; _slug: string[^}]*\}\s*Returns: string/.test(types));
check("A1 RPC defined", /create or replace function public\.create_self_service_workspace\(_name text, _slug text\)/i.test(exec));
check("A2 SECURITY DEFINER + empty search_path", /security definer/i.test(exec) && /set search_path = ''/i.test(exec));
check("A3 auth.uid required", /v_uid is null[\s\S]*AUTH_REQUIRED/i.test(exec));
check("A4 name trimmed + max length", /btrim\(coalesce\(_name/i.test(exec) && /char_length\(v_name\) > 80/i.test(exec));
check("A5 slug contract", exec.includes("'^[a-z0-9]+(-[a-z0-9]+)*$'") && /char_length\(v_slug\) > 48/.test(exec));
const lockAt = exec.search(/pg_advisory_xact_lock/), limitAt = exec.indexOf("FREE_PROJECT_LIMIT_REACHED"), insAt = exec.search(/insert into public\.workspaces/i);
check("A6 advisory xact lock keyed to uid before check and insert", lockAt > 0 && lockAt < limitAt && limitAt < insAt && /v_uid::text/.test(exec.slice(lockAt, lockAt + 200)));
check("A7 unrestricted bypass", /if not public\.has_platform_unrestricted_access\(v_uid\)[\s\S]*owner_id = v_uid[\s\S]*FREE_PROJECT_LIMIT_REACHED/i.test(exec));
check("A8 insert uses auth uid owner", /values \(v_name, v_slug, v_uid\)/i.test(exec));
check("A9 no membership/assignment writes (trigger-owned)", !/workspace_members|workspace_commercial_assignments|commercial_plans/i.test(exec));
check("A10 revoke PUBLIC + anon", /revoke all on function public\.create_self_service_workspace\(text, text\) from public/i.test(exec) && /from anon/i.test(exec));
check("A11 authenticated execute", /grant execute on function public\.create_self_service_workspace\(text, text\) to authenticated/i.test(exec));
check("A12 insert policy untouched", !/policy|workspaces_insert_private_beta|can_create_private_beta_workspace|disable row level/i.test(exec));
check("A13 no grant to anon", !/to anon/i.test(exec));

const sw = read("src/components/cartel/WorkspaceSwitcher.tsx");
const lib = read("src/lib/self-service-workspace.ts");
check("B1 dialog uses RPC helper", sw.includes("createSelfServiceWorkspace("));
check("B2 no direct workspace insert in switcher", !/from\("workspaces"\)/.test(sw) && !/\.insert\(/.test(sw));
check("B3 helper calls RPC", lib.includes('"create_self_service_workspace"') && !/from\("workspaces"\)/.test(lib));
check("B3b direct typed RPC, no generic cast", lib.includes('supabase.rpc("create_self_service_workspace"') && !/as unknown as/.test(lib));
check("B4 friendly limit message", /FREE_PROJECT_LIMIT_REACHED:\s*\n?\s*"Your Free account already has a project/.test(lib));
check("B5 invalidation + selection kept", sw.includes("invalidateQueries({ queryKey: workspacesQueryKey })") && sw.includes("selectWorkspace(id)"));
const srcInserts = execSync(`rg -l 'from\\("workspaces"\\)\\s*\\.insert' src || true`).toString().trim();
check("B6 no direct workspaces insert anywhere in src", srcInserts === "");

const auth = read("src/routes/auth.tsx");
check("C1 signup mode search", auth.includes('search[\'mode\'] === "signup"'));
check("C2 signUp used", auth.includes("supabase.auth.signUp("));
check("C3 session -> navigate, else confirm state", /if \(data\.session\)[\s\S]*navigate[\s\S]*setConfirmSentTo/.test(auth));
check("C4 check-email copy says not signed in", auth.includes("Check your email") && auth.includes("You are not signed in yet"));
check("C5 sign-in preserved", auth.includes("signInWithPassword("));
check("C6 no social providers", !/signInWithOAuth|lovable\.auth/.test(auth));
check("C7 no credit card copy", auth.includes("No credit card required"));

const home = read("src/routes/index.tsx");
check("D1 Start Free -> signup", home.includes("Start Free") && /to="\/auth"\s*\n\s*search=\{\{ mode: "signup" \}\}/.test(home));
check("D2 See Plans -> #pricing", home.includes('href="#pricing"') && home.includes('id="pricing"'));
check("D3 bot link kept", home.includes("https://t.me/PepeCartelHQBot") && home.includes("<BotLink />"));
check("D4 Free copy", home.includes("1 project and 1 Telegram community") && home.includes("No credit card required"));
check("D5 no 'no instant account creation' claim", !/no instant account creation|Invite-only private beta|Join private beta/.test(home));
check("D6 homepage stays Supabase-free", !/integrations\/supabase/.test(home));

const dash = read("src/routes/_authenticated/dashboard.tsx");
check("E1 dashboard Create free project reuses dialog", dash.includes("Create free project") && dash.includes("<CreateWorkspaceDialog open={createOpen}"));

const changed = execSync("git diff --name-only HEAD~20 -- . 2>/dev/null || true").toString();
void changed;
const turn = execSync("git status --porcelain; git diff --name-only HEAD").toString();
check("F1 no Stripe/launcher/PCART/chain/treasury/C1 files touched in working changes",
  !/stripe|chain|pcart|launcher|treasury|liquidity|COMMERCIAL_C1|supabase\/migrations/i.test(turn));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
