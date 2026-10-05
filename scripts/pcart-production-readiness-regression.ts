/**
 * PCART final production readiness + production allowlist regression.
 * Static/deterministic: inspects the applied migration SQL, registry, UI and
 * server paths. No network, no wallet, no DB writes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { isArtifactAllowedIn } from "../src/lib/launch-artifact-registry";
import { canOfferApproval, type PcartReadinessState } from "../src/lib/pcart-production-readiness";

let pass = 0, fail = 0;
function check(id: string, ok: boolean, msg: string) {
  if (ok) pass++; else { fail++; console.error(`FAIL ${id}: ${msg}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const MIG_FILE = "20261005030008_98ee5be2-ad18-4084-b97a-1c2172544c20.sql";
const SQL = read(`supabase/migrations/${MIG_FILE}`);
// Hardening migration: guard function is replaced by the newest migration that defines it.
const HARDEN_FILES = readdirSync("supabase/migrations").filter(
  (f) => f > MIG_FILE && read(`supabase/migrations/${f}`).includes("enforce_canonical_pcart_no_production_deployment"),
);
const GUARD_SQL = HARDEN_FILES.length
  ? read(`supabase/migrations/${HARDEN_FILES[HARDEN_FILES.length - 1]}`)
  : SQL;
const fn = (name: string) => SQL.split(`FUNCTION ${name}(`)[1]?.split("$$;")[0] ?? "";
// Getter lifecycle fix: the newest migration defining the getter wins (P3 fix switches it to evidence(false)).
const GETTER_FILES = readdirSync("supabase/migrations").filter(
  (f) => f > MIG_FILE && read(`supabase/migrations/${f}`).includes("FUNCTION public.get_canonical_pcart_production_readiness"),
);
const GETTER_SQL = GETTER_FILES.length ? read(`supabase/migrations/${GETTER_FILES[GETTER_FILES.length - 1]}`) : SQL;
const EV = fn("private.pcart_production_readiness_evidence");
const APPROVE = fn("public.approve_canonical_pcart_production_readiness");
const GET = GETTER_SQL.split("FUNCTION public.get_canonical_pcart_production_readiness(")[1]?.split("$$;")[0] ?? "";
const GUARD = ((s) => s.split("FUNCTION public.enforce_canonical_pcart_no_production_deployment(")[1]?.split("$$;")[0] ?? "")(GUARD_SQL);

// 1 non-owner
check("1", /uid IS NULL OR NOT public\.is_platform_owner\(uid\)/.test(APPROVE) && /42501/.test(APPROVE), "approval refuses non-owner");
// 2 noncanonical
check("2", /NOT private\.is_canonical_pcart_launch\(_launch_id\)/.test(EV) && /'Robinhood Chain'/.test(EV), "refuses noncanonical launch");
// 3 rehearsal existence/verification
check("3", /status = 'CONFIRMED'/.test(EV) && /n <> 1/.test(EV) && /REHEARSAL_NOT_EXACTLY_ONE/.test(EV) &&
  /d\.verified_at IS NULL OR d\.contract_address IS NULL OR d\.tx_hash IS NULL/.test(EV), "refuses missing/nonconfirmed/unverified rehearsal");
// 4 intent
check("4", ["d.chain_id IS DISTINCT FROM 46630", "'FIXED_SUPPLY_ERC20'", "'PEPECARTEL'", "'PCART'", "IS DISTINCT FROM 18",
  "1000000000000000000000000000::numeric", "0x0000000000000000000000000000000000000000"].every((t) => EV.includes(t)),
  "refuses wrong rehearsal intent");
// 5 safe
check("5", /s\.threshold IS DISTINCT FROM 2/.test(EV) && /s\.safe_verified_at IS NULL/.test(EV) && /s\.safe_address IS NULL/.test(EV) &&
  /s\.signer_1 = s\.signer_2/.test(EV), "refuses missing/unverified/wrong-threshold Safe");
// 6 execution control
check("6", /execution_enabled IS DISTINCT FROM false OR c\.emergency_stop_engaged IS DISTINCT FROM true/.test(EV) &&
  /'ROBINHOOD_MAINNET_DEPLOYMENT'/.test(EV), "refuses if execution enabled or stop disengaged");
// 7 official contract / production rows
check("7", /official_contract_address IS NOT NULL/.test(EV) && /official_contract_deployment_id IS NOT NULL/.test(EV) &&
  /launch_contract_registration_events/.test(EV) && /_require_no_production AND EXISTS/.test(EV) &&
  /evidence\(_launch_id, true\)/.test(APPROVE), "refuses if official contract or production row exists");
// 8 single immutable row + idempotent replay
check("8", /launch_id uuid NOT NULL UNIQUE/.test(SQL) && /BEFORE UPDATE OR DELETE ON public\.pcart_production_readiness_approvals/.test(SQL) &&
  /r\.readiness_fingerprint = ev->>'fingerprint'/.test(APPROVE) && /no longer matches/.test(APPROVE) &&
  /REVOKE ALL ON public\.pcart_production_readiness_approvals FROM PUBLIC, anon, authenticated/.test(SQL) &&
  !/CREATE POLICY/.test(SQL), "one immutable row; replay safe; no direct table access");
check("8b", !/UPDATE public\.(launches|launch_chain_production_execution_controls|launch_treasury_signer_configs)|INSERT INTO public\.launch_chain_deployments/.test(SQL),
  "migration writes no launch/control/Safe/deployment state");
// 9 code allowlist
check("9", isArtifactAllowedIn("pepecartel-token-v1", "PRODUCTION") && isArtifactAllowedIn("pepecartel-token-v1", "TESTNET"), "code allowlist");
// 10 artifact constraint
const chk = SQL.split("ADD CONSTRAINT launch_chain_deployments_artifact_chk CHECK (")[1]?.split(");")[0] ?? "";
check("10", /chain_id = 4663 AND network_environment = 'PRODUCTION'/.test(chk) && /chain_id = 46630 AND network_environment = 'TESTNET'/.test(chk) &&
  /token_total_supply = 1000000000000000000000000000::numeric/.test(chk) && /token_name = 'PEPECARTEL'/.test(chk) &&
  !/production_token_intent_required_chk/.test(SQL), "exact PCART production shape; fingerprint/init-hash constraint untouched");
// 11 guard
check("11", /NEW\.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'/.test(GUARD) && /require a production readiness approval/.test(GUARD) &&
  /evidence\(NEW\.launch_id, false\)/.test(GUARD) && /readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint'/.test(GUARD),
  "guard rejects non-PCART and PCART without matching approval/locked control");
// 11b hardened boundary: PCART artifact rejected on noncanonical production launch;
// canonical launch rejects any other artifact; canonical+exact artifact still requires approval/evidence
check("11b", /IF NEW\.network_environment = 'PRODUCTION' OR NEW\.chain_id = 4663 THEN/.test(GUARD) &&
  /IF private\.is_canonical_pcart_launch\(NEW\.launch_id\) THEN/.test(GUARD) &&
  /ELSIF NEW\.artifact_id = 'pepecartel-token-v1' THEN/.test(GUARD) &&
  /reserved for the canonical PEPECARTEL launch/.test(GUARD) &&
  /only permits pepecartel-token-v1 in production/.test(GUARD) &&
  /require a production readiness approval/.test(GUARD) &&
  /evidence\(NEW\.launch_id, false\)/.test(GUARD),
  "guard fails closed: PCART artifact canonical-only on production; canonical launch PCART-artifact-only; approval still required");
// 12 generic canary still protected
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");
check("12", /attemptFail\("CANONICAL_PCART_PROTECTED"\)/.test(CANARY) && !/pepecartel-token-v1/.test(CANARY), "generic canary still CANONICAL_PCART_PROTECTED");
// 13 no new production/send path
check("13", !/create_launch_chain_pcart_production|presign|send_window|canary_permit|eth_sendTransaction|arm_/i.test(SQL) &&
  !readdirSync("src/lib").some((f) => /pcart-production-(attempt|send|deploy)/.test(f)), "no production attempt/send/presign/arming path");
// 14 UI
const UI = read("src/components/cartel/PcartProductionBlockedCheckpoint.tsx");
const LIB = read("src/lib/pcart-production-readiness.ts");
check("14", /AlertDialog/.test(UI) && /Confirm approval/.test(UI) && /canOfferApproval\(s\)/.test(UI) &&
  !/wallet|provider|appkit|wagmi|eth_|sendTransaction|switchChain/i.test(UI.replace(/\/\*[\s\S]*?\*\//g, "").replace(/does not use a wallet/g, "")) &&
  !/wallet|provider|appkit|wagmi|eth_/i.test(LIB.replace(/\/\*[\s\S]*?\*\//g, "")), "explicit confirmation, no wallet references");
const base: PcartReadinessState = { canonical: true, is_platform_owner: true, rehearsal_complete: true, safe_configured: true,
  safe_verified: true, evidence_ok: true, execution_locked: true, approval: null };
check("14b", canOfferApproval(base) && !canOfferApproval({ ...base, is_platform_owner: false }) &&
  !canOfferApproval({ ...base, execution_locked: false }) && !canOfferApproval({ ...base, evidence_ok: false }) &&
  !canOfferApproval({ ...base, approval: { id: "x", artifact_id: "pepecartel-token-v1", rehearsal_tx_hash: "", safe_address: "", approved_at: "", evidence_still_matches: true } }) &&
  !canOfferApproval(undefined), "approval action offered only when owner + all evidence proven");
check("15", /is_platform_owner\(uid\)/.test(GET) && /workspace_members/.test(GET), "read RPC limited to owner or workspace members");
// 19 getter lifecycle semantics: getter uses evidence(false) so the expected production DRAFT
// does not stale an existing approval; initial approval still requires evidence(true).
check("19a", /pcart_production_readiness_evidence\(_launch_id, false\)/.test(GET) && !/pcart_production_readiness_evidence\(_launch_id, true\)/.test(GET),
  "getter calls evidence(false) — expected production DRAFT does not stale the approval");
check("19b", /pcart_production_readiness_evidence\(_launch_id, true\)/.test(APPROVE) && !/pcart_production_readiness_evidence\(_launch_id, false\)/.test(APPROVE),
  "initial approval still calls evidence(true) — zero production rows required to approve");
check("19c", /readiness_fingerprint = ev->>'fingerprint'/.test(GET) && /evidence_still_matches/.test(GET),
  "getter still compares approval fingerprint to fresh evidence — rehearsal/Safe/fingerprint changes still stale it");
check("19d", /execution_enabled = false AND c\.emergency_stop_engaged = true/.test(GET),
  "getter still reports execution lock state");

console.log(`pcart-production-readiness: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
