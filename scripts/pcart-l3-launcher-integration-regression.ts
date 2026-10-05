/**
 * PCART-L3 — launcher integration regression. Pure static + local byte checks.
 * No network, RPC, wallet or database call.
 */
import { readFileSync, readdirSync } from "node:fs";
import { decodeAbiParameters, keccak256 } from "viem";
import {
  ARTIFACT_ENVIRONMENT_ALLOWLIST,
  CANONICAL_PCART_IDENTITY,
  PCART_FIXED_INTENT,
  buildPcartInitCode,
  isArtifactAllowedIn,
  isCanonicalPcartLaunch,
  normalizePcartRehearsalRecipient,
  runtimeHashForArtifact,
} from "../src/lib/launch-artifact-registry";
import {
  PEPECARTEL_TOKEN_CREATION_BYTECODE,
  PEPECARTEL_TOKEN_RUNTIME_BYTECODE,
} from "../src/lib/pepecartel-token.artifact";
import { CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH } from "../src/lib/cartel-fixed-erc20.artifact";

const read = (p: string) => readFileSync(p, "utf8");
let failures = 0;
let passes = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) {
    passes += 1;
    console.log(`PASS ${id} — ${detail}`);
  } else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const SQL = read("docs/sql/PCART_L3_launcher_rehearsal_and_mainnet_isolation.sql");
const VERIFY = read("src/lib/chain-verify.functions.ts");
const CLIENT = read("src/lib/pcart-rehearsal.ts");
const PANEL = read("src/components/chain/PcartRehearsalPanel.tsx");
const CHECKPOINT = read("src/components/cartel/PcartProductionBlockedCheckpoint.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const CL = read("src/routes/_authenticated/chain-launcher.tsx");
const CANARY_FN = read("src/lib/chain-mainnet-canary.functions.ts");
const CANARY_UI = read("src/routes/_authenticated/mainnet-canary.tsx");
const REGISTRY = read("src/lib/launch-artifact-registry.ts");
const MANIFEST = JSON.parse(read("artifacts/pepecartel-token-v1.manifest.json"));

// A. exact bytes + intent
const R = "0x1111111111111111111111111111111111111111";
const init = buildPcartInitCode(R);
check("A1", init.startsWith(PEPECARTEL_TOKEN_CREATION_BYTECODE), "init code = frozen creation prefix");
const tail = `0x${init.slice(PEPECARTEL_TOKEN_CREATION_BYTECODE.length)}` as `0x${string}`;
check("A2", tail.length === 2 + 64, "exactly one ABI word appended (constructor(address))");
check(
  "A3",
  (decodeAbiParameters([{ type: "address" }], tail)[0] as string).toLowerCase() === R,
  "appended word decodes to the rehearsal recipient",
);
check("A4", keccak256(PEPECARTEL_TOKEN_CREATION_BYTECODE) === PCART_FIXED_INTENT.creationHash &&
  PCART_FIXED_INTENT.creationHash === "0x2edebe9de5877c0775dc87644ca9051a54034f4eee8bd9662c7657d0fd3c2196",
  "creation hash pinned");
check("A5", keccak256(PEPECARTEL_TOKEN_RUNTIME_BYTECODE) === PCART_FIXED_INTENT.runtimeHash &&
  PCART_FIXED_INTENT.runtimeHash === "0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4",
  "runtime hash pinned");
check("A6", PCART_FIXED_INTENT.name === "PEPECARTEL" && PCART_FIXED_INTENT.symbol === "PCART" &&
  PCART_FIXED_INTENT.decimals === 18 && PCART_FIXED_INTENT.totalSupply === 10n ** 27n,
  "fixed PEPECARTEL / PCART / 18 / 1,000,000,000 intent");
check("A7", throws(() => normalizePcartRehearsalRecipient("0x" + "0".repeat(40))) &&
  throws(() => normalizePcartRehearsalRecipient("0x123")) && throws(() => buildPcartInitCode("")),
  "zero / malformed / empty recipient rejected");
check("A8", runtimeHashForArtifact("pepecartel-token-v1") === PCART_FIXED_INTENT.runtimeHash &&
  runtimeHashForArtifact("cartel-fixed-erc20-v1") === CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH &&
  runtimeHashForArtifact("x") === null, "runtime hash registry");

// B. environment allowlist — not production-allowlisted
check("B1", isArtifactAllowedIn("pepecartel-token-v1", "TESTNET") &&
  isArtifactAllowedIn("pepecartel-token-v1", "PRODUCTION"), "PCART allowlisted TESTNET + PRODUCTION (production gated by readiness approval in DB)");
check("B2", isArtifactAllowedIn("cartel-fixed-erc20-v1", "PRODUCTION") &&
  isArtifactAllowedIn("cartel-fixed-erc20-v1", "TESTNET"), "generic artifact allowlist unchanged");
check("B3", Object.keys(ARTIFACT_ENVIRONMENT_ALLOWLIST).length === 2, "registry has exactly two artifacts");
check("B4", MANIFEST.status.productionAllowlisted === false && MANIFEST.status.deployed === false &&
  MANIFEST.status.testnetRehearsalPassed === false && MANIFEST.status.treasuryRecipientResolved === false,
  "manifest status flags unchanged");
check("B5", /APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(read("src/lib/launch-evidence-checks.ts")) &&
  !/pepecartel/i.test(read("src/lib/launch-evidence-checks.ts")), "official evidence allowlist unchanged");
check("B6", /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(read("src/lib/chain-mainnet-registry.ts")) &&
  /LIQUIDITY_TX_ENABLED = false as const/.test(read("src/lib/chain-registry.ts")), "liquidity switches remain false");

// C. canonical-launch isolation
const CANON = { id: "x", public_slug: "pepecartel-launch", launch_kind: "PROJECT", token_name: "PEPECARTEL", ticker: "$PCART" };
check("C1", isCanonicalPcartLaunch(CANON) &&
  !isCanonicalPcartLaunch({ public_slug: "pepecartel-launch" }) &&
  !isCanonicalPcartLaunch({ ...CANON, ticker: "PCART" }) &&
  !isCanonicalPcartLaunch({ ...CANON, token_name: "pepecartel" }) &&
  !isCanonicalPcartLaunch({ ...CANON, launch_kind: "INTERNAL_TEST" }) &&
  !isCanonicalPcartLaunch({ ...CANON, public_slug: "other" }) &&
  !isCanonicalPcartLaunch(null), "exact semantic identity: all four fields required, never slug/id alone");
check("C1b", CANONICAL_PCART_IDENTITY.ticker === "$PCART" && !/CANONICAL_PCART_LAUNCH_ID/.test(REGISTRY),
  "no pinned launch id export");
check("C2", /isCanonicalPcartLaunch\(selected\)\s*\?\s*\(\s*pcartSafeReady\s*\?\s*\(\s*<div[^>]*>[\s\S]*?<PcartProductionBlockedCheckpoint launchId=\{selected\.id\} \/>[\s\S]*?<\/div>\s*\)\s*:\s*null\s*\)\s*:\s*selected && selectedIsProjectLaunch \? \(\s*<ProductionDeploymentRequestPanel/.test(LC),
  "Launch Control renders the blocked checkpoint instead of the generic request form for the canonical launch");
check("C3", !/<input|<Input|onSubmit|wallet|provider|eth_|sendTransaction|appkit/i.test(CHECKPOINT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/does not use a wallet/g, "")) && /AlertDialog/.test(CHECKPOINT),
  "checkpoint has no inputs/wallet; its only action is a confirmed DB approval");
for (const b of ["rehearsal", "2-of-3", "Safe verification", "readiness approval", "artifact allowlist"]) {
  check(`C4:${b}`, CHECKPOINT.includes(b), `checkpoint lists blocker: ${b}`);
}
check("C5", /launchId && isCanonical \? \(\s*<PcartRehearsalPanel[\s\S]*?\) : \(\s*<>\s*<Section/.test(CL),
  "chain launcher: canonical -> rehearsal panel only; generic sections in the else branch");
const elseBranch = CL.slice(CL.indexOf("launchId && isCanonical ?"));
check("C5b", ["Deploy Test Contract", "Deploy Test Token", "Build Liquidity Plan"].every((t) => elseBranch.includes(t)) &&
  elseBranch.indexOf("Deploy Test Contract") > elseBranch.indexOf(") : ("),
  "generic inert / test-token / liquidity controls preserved for noncanonical launches");
check("C5c", /!launchId \|\| !account \|\| !onTestnet \|\| isCanonical\) return;/.test(CL) &&
  /handleDeployToken\(\) \{\s*\/\/[^\n]*\n\s*if \(isCanonical\) return;/.test(CL) &&
  /const canDeploy =\s*!isCanonical &&/.test(CL) && /const canDeployToken =\s*!isCanonical &&/.test(CL),
  "generic deploy handlers refuse the canonical launch");
check("C6", CL.includes('a.artifact_id !== "pepecartel-token-v1"') && /isCanonical\s*\?\s*\[\]/.test(CL),
  "PCART rows and the canonical launch never feed liquidity planning");
check("C7", /attempts=\{attempts\}/.test(CL) && /onVerify=\{\(id\) => verifyMutation\.mutate\(id\)\}/.test(CL) &&
  /props\.attempts\.filter\(isPcartRehearsalRow\)/.test(PANEL) && /Check verification/.test(PANEL) &&
  !/setInterval|refetchInterval/.test(PANEL),
  "PCART evidence panel: PCART attempts only, manual verification, no polling");

// G. PCART double-broadcast lock + broadcast-write recovery handoff
check("G1", /const inFlight = useRef\(false\)/.test(PANEL) &&
  /if \(inFlight\.current\) return;\s*inFlight\.current = true;\s*try \{\s*await runLocked\(\);\s*\} finally \{\s*inFlight\.current = false;/.test(PANEL) &&
  PANEL.indexOf("if (inFlight.current) return;") < PANEL.indexOf("createPcartRehearsalAttempt({"),
  "synchronous in-flight lock wraps the entire run before any attempt/broadcast");
check("G2", /try \{\s*await submitDeploymentTx\(attempt\.id, txHash\);\s*\} catch \(submitError\) \{[\s\S]*?props\.onBroadcastUnrecorded\(attempt, txHash\);\s*throw submitError;/.test(PANEL) &&
  /else if \(attemptId && !txHash\)/.test(PANEL),
  "submit failure after broadcast hands off to recovery and is never abandoned");
check("G3", /props\.onBroadcastRecorded\(\);/.test(PANEL) && /\{props\.recoveryPanel\}/.test(PANEL),
  "successful submit clears recovery; shared recovery UI rendered in the PCART panel");
check("G4", /onBroadcastUnrecorded=\{handleBroadcastUnrecorded\}/.test(CL) &&
  /recoveryPanel=\{recoveryPanel\}/.test(CL) && /\{recoveryPanel\}/.test(CL.slice(CL.indexOf(") : ("))) &&
  /function handleBroadcastUnrecorded[\s\S]*?parseRecoveryRecord\([\s\S]*?saveRecoveryRecord\(record\)/.test(CL) &&
  (CL.match(/Transaction broadcast but not recorded/g) ?? []).length === 1 &&
  (CL + PANEL).match(/Record transaction hash/g)?.length === 1,
  "single shared recovery implementation reused for PCART and generic routes");

// F. freeform mainnet canary isolation
check("F1", /\.filter\(\s*\(row\) => !isCanonicalPcartLaunch\(row\)/.test(CANARY_UI),
  "canary launch options exclude the canonical launch");
check("F2", /some\(\(row\) => row\.id === requested\) \? requested : ""/.test(CANARY_UI) &&
  /window\.localStorage\.removeItem\(LAUNCH_SELECTION_STORAGE_KEY\)/.test(CANARY_UI),
  "stale/unknown (incl. canonical) stored selection is cleared/refused");
const attemptFn = CANARY_FN.split("export const createCanaryDeploymentAttempt")[1] ?? "";
check("F3", /select\("id, chain, public_slug, launch_kind, token_name, ticker"\)/.test(attemptFn) &&
  attemptFn.indexOf('attemptFail("CANONICAL_PCART_PROTECTED")') > 0 &&
  attemptFn.indexOf('attemptFail("CANONICAL_PCART_PROTECTED")') <
    attemptFn.indexOf("create_launch_chain_production_token_deployment_attempt"),
  "server precheck refuses the canonical launch before the production-attempt RPC");
check("F4", /"LAUNCH_CHAIN_MISMATCH"/.test(attemptFn) && /RECIPIENT_MUST_MATCH_DEPLOYER/.test(attemptFn),
  "generic canary checks unchanged for noncanonical launches");

// D. applied PCART-L3 SQL — fail-closed + no generic-mainnet fallback
const MIG_FILE = "20260927141715_pcart_l3_rehearsal_and_mainnet_isolation.sql";
const MIG = readdirSync("supabase/migrations").includes(MIG_FILE) ? read(`supabase/migrations/${MIG_FILE}`) : "";
const MIG_PCART = readdirSync("supabase/migrations").filter((f) => /pepecartel-token-v1/.test(read(`supabase/migrations/${f}`)));
// The only other authorized PCART migration is the draft-recovery v2 RPC, which
// adds a NEW function and never redefines the protected original.
const RECOVERY_MIG = "20261005021534_a03a1d58-ef0d-45a5-a3d3-ea0a9bc0390e.sql";
const READINESS_MIG = "20261005030008_98ee5be2-ad18-4084-b97a-1c2172544c20.sql";
// Authorized guard-hardening migration: replaces ONLY the guard function to make
// pepecartel-token-v1 canonical-only on production; no schema or other SQL.
const HARDEN_MIG = "20261005031358_a37422a1-1ef9-47c0-875d-036f20a4b225.sql";
// Authorized PCART P2 migration: adds NEW owner-only production DRAFT/abandon
// RPCs only; never redefines the protected original SQL.
const P2_MIG = "20261005094833_33607368-857a-4487-b5cb-4b62419a4980.sql";
// Authorized PCART P2 fix migration: replaces ONLY the draft RPC so the
// GENERATED ALWAYS column token_total_supply_text is never inserted.
const P2_FIX_MIG = "20261005100833_46ee6d47-1dcf-47d3-aa02-5e08af696cf0.sql";
const HARDEN_SQL = read(`supabase/migrations/${HARDEN_MIG}`);
const P2_FIX_SQL = read(`supabase/migrations/${P2_FIX_MIG}`);
const ENV_IDX_MIG = "20261005101321_54225f07-be67-4257-aea1-f36aa287405a.sql";
const ENV_IDX_SQL = read(`supabase/migrations/${ENV_IDX_MIG}`);
const P3_MIG = "20261005102647_27d1aa5f-67b1-4889-b7ba-352214edcc76.sql";
const P3_SQL = read(`supabase/migrations/${P3_MIG}`);
// Authorized getter lifecycle fix: replaces ONLY the readiness getter so it uses
// evidence(false); approval/evidence functions untouched.
const GETTER_FIX_MIG = "20261005105208_3b6b2722-c91d-4d33-8de3-4369747b419b.sql";
const GETTER_FIX_SQL = read(`supabase/migrations/${GETTER_FIX_MIG}`);
// Authorized PCART P4 migration: adds ONLY the READY TO SEND permit table + owner-only issue/cancel.
const P4_MIG = "20261005110958_aa7d8ddf-c3b7-4705-a33a-c3990dfc2a36.sql";
const P4_SQL = read(`supabase/migrations/${P4_MIG}`);
check("D0m", /CREATE TABLE public\.pcart_production_execution_permits/.test(P4_SQL) &&
  !/CREATE OR REPLACE FUNCTION public\.(create_launch_chain_pcart_rehearsal_attempt|enforce_canonical_pcart_no_production_deployment|create_canonical_pcart_production_draft|issue_canonical_pcart_production_presign_authorization)/.test(P4_SQL) &&
  !/INSERT INTO public\.launch_chain|UPDATE public\.(launch_chain_deployments|launches|launch_chain_production_execution_controls)/.test(P4_SQL),
  "P4 migration adds only the execution permit; no rehearsal/guard/draft/P3/send-stage/control changes");
check("D0l", /CREATE OR REPLACE FUNCTION public\.get_canonical_pcart_production_readiness/.test(GETTER_FIX_SQL) &&
  /pcart_production_readiness_evidence\(_launch_id, false\)/.test(GETTER_FIX_SQL) &&
  !/pcart_production_readiness_evidence\(_launch_id, true\)/.test(GETTER_FIX_SQL) &&
  !/FUNCTION public\.approve_canonical_pcart_production_readiness|FUNCTION private\.pcart_production_readiness_evidence|CREATE TABLE|ALTER TABLE|CREATE POLICY|INSERT |UPDATE |DELETE /.test(GETTER_FIX_SQL),
  "getter fix migration only replaces the readiness getter with evidence(false)");
check("D0h", /CREATE OR REPLACE FUNCTION public\.enforce_canonical_pcart_no_production_deployment/.test(HARDEN_SQL) &&
  /ELSIF NEW\.artifact_id = 'pepecartel-token-v1' THEN/.test(HARDEN_SQL) &&
  /reserved for the canonical PEPECARTEL launch/.test(HARDEN_SQL) &&
  !/CREATE TABLE|ALTER TABLE|ADD CONSTRAINT|CREATE POLICY|GRANT |INSERT |UPDATE |DELETE /.test(HARDEN_SQL),
  "hardening migration only replaces the guard function (canonical-only PCART artifact on production)");
check("D0j", /network_environment = 'TESTNET'\s+AND chain_id = 46630/.test(ENV_IDX_SQL) && /launch_chain_deployments_one_active_pcart_production/.test(ENV_IDX_SQL) &&
  !/INSERT |UPDATE |DELETE |CREATE OR REPLACE FUNCTION|ALTER TABLE|CREATE POLICY/.test(ENV_IDX_SQL),
  "environment-index migration only rescopes PCART uniqueness per environment");
check("D0k", /CREATE TABLE public\.pcart_production_preparation_authorizations/.test(P3_SQL) &&
  !/CREATE OR REPLACE FUNCTION public\.(create_launch_chain_pcart_rehearsal_attempt|enforce_canonical_pcart_no_production_deployment|create_canonical_pcart_production_draft)/.test(P3_SQL) &&
  !/INSERT INTO public\.launch_chain_production_(send_window_issuances|canary_permits|presign_authorizations)/.test(P3_SQL),
  "P3 migration adds only the preparation authorization; no rehearsal/guard/draft/send-stage changes");
check("D0i", /CREATE OR REPLACE FUNCTION public\.create_canonical_pcart_production_draft/.test(P2_FIX_SQL) &&
  !/abandon_canonical_pcart_production_draft/.test(P2_FIX_SQL) &&
  !/CREATE TABLE|ALTER TABLE|CREATE POLICY/.test(P2_FIX_SQL) &&
  !/token_total_supply_text,/.test(P2_FIX_SQL),
  "P2 fix migration only replaces the draft RPC; the generated column is never inserted");
const MIG_PCART_PROTECTED = MIG_PCART.filter((f) => f !== READINESS_MIG && f !== HARDEN_MIG && f !== P2_MIG && f !== P2_FIX_MIG && f !== ENV_IDX_MIG && f !== P3_MIG && f !== GETTER_FIX_MIG && f !== P4_MIG).filter((f) => f !== RECOVERY_MIG ||
  /FUNCTION public\.create_launch_chain_pcart_rehearsal_attempt\(|is_canonical_pcart_launch\(\)? *RETURNS|enforce_canonical_pcart_no_production_deployment\(\) *RETURNS/.test(read(`supabase/migrations/${f}`)));
check("D0", MIG.length > 0 && MIG_PCART_PROTECTED.length === 1 && MIG_PCART_PROTECTED[0] === MIG_FILE &&
  MIG.includes("FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(") &&
  MIG.includes("FUNCTION private.is_canonical_pcart_launch(") &&
  MIG.includes("FUNCTION public.enforce_canonical_pcart_no_production_deployment()") &&
  MIG.includes("launch_chain_deployments_one_active_pcart_rehearsal"),
  "exact applied migration 20260927141715 exists and is the only migration with the protected PCART SQL");
const stripStatus = (t: string) => t.split("\nBEGIN;")[1] ?? "";
check("D0b", stripStatus(MIG).length > 0 && stripStatus(MIG) === stripStatus(SQL),
  "docs SQL executable body is identical to the applied migration");
check("D0c", /STATUS: APPLIED as migration 20260927141715 \/ pcart_l3_rehearsal_and_mainnet_isolation/.test(SQL) &&
  !/STAGED, NOT APPLIED|rehearsal RPC is missing/.test(SQL.split("\nBEGIN;")[0] ?? ""),
  "docs say APPLIED with version 20260927141715; no staged/missing wording");
const TYPES = read("src/integrations/supabase/types.ts");
const reqTbl = TYPES.split("launch_production_deployment_requests: {")[1]?.split("Relationships:")[0] ?? "";
check("D0d", /Row: \{\s*artifact_id: string\n/.test(reqTbl) && /Insert: \{\s*artifact_id\?: string\n/.test(reqTbl) &&
  /Update: \{\s*artifact_id\?: string\n/.test(reqTbl),
  "generated types include production-request artifact_id (Row/Insert/Update)");
const pcartType = TYPES.split("create_launch_chain_pcart_rehearsal_attempt: {")[1]?.split("SetofOptions")[0] ?? "";
const pcartSetof = TYPES.split("create_launch_chain_pcart_rehearsal_attempt: {")[1]?.split("isSetofReturn: false")[0] ?? "";
check("D0e", /_client_request_id: string\s*_deployer_address: string\s*_launch_id: string\s*_rehearsal_recipient: string/.test(pcartType) &&
  /from: "\*"\s*to: "launch_chain_deployments"\s*isOneToOne: true\s*$/.test(pcartSetof),
  "generated types include the PCART rehearsal RPC returning a launch_chain_deployments row");
const PCLIENT = read("src/lib/pcart-rehearsal.ts");
check("D0f", /await supabase\.rpc\(PCART_REHEARSAL_RPC, \{/.test(PCLIENT) && !/RpcCaller/.test(PCLIENT) &&
  !/supabase\.rpc\.bind/.test(PCLIENT) && /isMissingRpcError\(error\)\) throw new PcartRehearsalUnavailableError/.test(PCLIENT) &&
  /isExactPcartRehearsalRow\(row, recipient\)/.test(PCLIENT),
  "client calls typed supabase.rpc directly; missing-RPC fail-closed and exact row validation kept");
check("D1", /artifact_id = 'pepecartel-token-v1'\s*AND chain_id = 46630\s*AND network_environment = 'TESTNET'/.test(SQL),
  "evidence constraint permits PCART only on 46630 TESTNET");
check("D2", /CHECK \(artifact_id = 'cartel-fixed-erc20-v1'\)/.test(SQL) &&
  /DEFAULT 'cartel-fixed-erc20-v1'/.test(SQL) && /artifact binding is immutable/.test(SQL),
  "production requests bound immutably to the generic artifact; PCART not allowed");
const submitBody = SQL.split("FUNCTION public.submit_launch_production_deployment_request(")[1] ?? "";
const beginBody = SQL.split("FUNCTION public.begin_launch_production_request_execution(")[1] ?? "";
check("D3", /private\.is_canonical_pcart_launch\(_launch_id\)/.test(submitBody.split("$$;")[0] ?? ""),
  "generic request RPC explicitly rejects the canonical launch");
check("D4", /private\.is_canonical_pcart_launch\(r\.launch_id\)/.test(beginBody.split("$$;")[0] ?? "") &&
  /r\.artifact_id is distinct from 'cartel-fixed-erc20-v1'/.test(beginBody),
  "begin-execution RPC rejects the canonical launch and non-generic bindings");
const rpc = SQL.split("FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(")[1]?.split("$$;")[0] ?? "";
check("D5", !/9f9af215/.test(SQL + REGISTRY + CL + CANARY_FN + CANARY_UI) &&
  rpc.includes("private.is_canonical_pcart_launch(l.id)") && rpc.includes("'pepecartel-launch'") &&
  rpc.includes("'PROJECT'") && rpc.includes("l.ticker IS DISTINCT FROM '$PCART'") &&
  rpc.includes("l.token_name IS DISTINCT FROM 'PEPECARTEL'") && rpc.includes("46630, 'TESTNET'") &&
  rpc.includes("'pepecartel-token-v1', 'PEPECARTEL', 'PCART', 18") &&
  rpc.includes("1000000000000000000000000000") && rpc.includes("Invalid rehearsal recipient"),
  "no hardcoded UUID; rehearsal RPC pins exact semantic identity, testnet, intent, nonzero recipient");
const helper = SQL.split("FUNCTION private.is_canonical_pcart_launch(")[1]?.split("$$;")[0] ?? "";
check("D5b", /l\.public_slug = 'pepecartel-launch'\s*AND l\.launch_kind = 'PROJECT'\s*AND l\.token_name = 'PEPECARTEL'\s*AND l\.ticker = '\$PCART'/.test(helper) &&
  !/\bOR\b/.test(helper), "DB helper requires ALL identity fields (never id OR slug)");
check("D6", !/official_contract|launches\s+SET|UPDATE public\.launches|launch_events|notification|liquidity/i.test(rpc),
  "rehearsal RPC writes no official address, lifecycle, notification or liquidity state");
const defs = SQL.match(/SECURITY DEFINER\s*\n\s*SET search_path = ''/g) ?? [];
check("D7", defs.length === 7 && !/SET search_path = public/i.test(SQL) && !/SET search_path TO 'public'/.test(SQL),
  "all seven SECURITY DEFINER functions use an empty search_path");
check("D8", /REVOKE ALL ON FUNCTION public\.create_launch_chain_pcart_rehearsal_attempt\(uuid, text, text, text\)\s*FROM PUBLIC, anon;/.test(SQL) &&
  /GRANT EXECUTE ON FUNCTION public\.create_launch_chain_pcart_rehearsal_attempt\(uuid, text, text, text\)\s*TO authenticated;/.test(SQL),
  "rehearsal RPC: public/anon revoked, authenticated only");
check("D9", /apply_launch_chain_token_deployment_verification\(\s*uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric\s*\) FROM PUBLIC, anon, authenticated;/.test(SQL),
  "apply RPC stays service-role only");
check("D10", !/runtime_control|emergency_stop|execution_control|MAINNET_LIQUIDITY/i.test(SQL),
  "PCART-L3 SQL does not touch runtime control, emergency stop or liquidity switches");
check("D11", /^BEGIN;/m.test(SQL) && /^COMMIT;/m.test(SQL), "PCART-L3 SQL is a single transaction");

const guard = SQL.split("FUNCTION public.enforce_canonical_pcart_no_production_deployment()")[1] ?? "";
check("D12", /NEW\.network_environment = 'PRODUCTION' OR NEW\.chain_id = 4663/.test(guard) &&
  /private\.is_canonical_pcart_launch\(NEW\.launch_id\)/.test(guard) && !/artifact_id\s*=/.test(guard.split("$$;")[0] ?? ""),
  "table-boundary guard refuses canonical PRODUCTION/4663 rows regardless of artifact");
check("D13", /BEFORE INSERT OR UPDATE OF launch_id, chain_id, network_environment, artifact_id\s*ON public\.launch_chain_deployments/.test(SQL) &&
  /enforce_canonical_pcart_no_production_deployment\(\)\s*FROM PUBLIC, anon, authenticated;/.test(SQL),
  "guard fires on insert + identity update; execute revoked from PUBLIC/anon/authenticated");
check("D14", !/TESTNET/.test(guard.split("$$;")[0] ?? "") && /46630/.test(SQL),
  "guard does not touch TESTNET rehearsal rows or noncanonical launches");

// E. verifier + client
check("E1", /isPcart\s*\?\s*PCART_FIXED_INTENT\.runtimeHash\s*:\s*CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH/.test(VERIFY),
  "verifier pins PCART runtime hash, generic hash unchanged");
check("E2", /isPcart\s*\n?\s*\?\s*buildPcartInitCode\(row\.token_recipient/.test(VERIFY),
  "verifier re-derives exact PCART init code server-side");
check("E3", /supplyText !== PCART_FIXED_INTENT\.totalSupply\.toString\(\)/.test(VERIFY) &&
  /onChain\.recipientBalance !== expectedTotalSupply/.test(VERIFY),
  "verifier checks exact supply and full recipient balance");
check("E4", !/official_contract_address/.test(VERIFY.replace(/\/\/.*|\*.*$/gm, "")), "verifier never writes official address");
check("E5", /PcartRehearsalUnavailableError/.test(CLIENT) && /PGRST202/.test(CLIENT),
  "client fails closed when the RPC is unavailable");
check("E6", PANEL.indexOf("createPcartRehearsalAttempt(") < PANEL.indexOf("broadcastTokenDeployment("),
  "attempt is created (and must succeed) before any broadcast");
check("E7", /NOT the production treasury/.test(PANEL) && /not the official PEPECARTEL token/.test(PANEL),
  "panel labels testnet-only and not the treasury");
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/production treasury/gi, "");
check("E9", ["artifact_id === PCART_FIXED_INTENT.artifactId", 'deployment_kind === "FIXED_SUPPLY_ERC20"',
  "Number(row.chain_id) === 46630", 'network_environment === "TESTNET"', "token_name === PCART_FIXED_INTENT.name",
  "token_symbol === PCART_FIXED_INTENT.symbol", "token_decimals) === PCART_FIXED_INTENT.decimals",
  "supply === PCART_FIXED_INTENT.totalSupply", "token_recipient === recipient", 'status === "DRAFT"'].every((t) => CLIENT.includes(t)),
  "client validates every frozen field of the returned row");
check("E8", !/\b4663\b|PRODUCTION|mainnet/i.test(noComments(CLIENT) + noComments(PANEL)),
  "rehearsal client/panel have no mainnet path");

// H — audit-first / no-repeat PCART rehearsal
const blockSet = PANEL.match(/PCART_BLOCKING_STATUSES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
const blocking = new Set([...blockSet.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]));
check("H1", ["DRAFT", "SUBMITTED", "PENDING", "CONFIRMED"].every((s) => blocking.has(s)) &&
  !blocking.has("FAILED") && !blocking.has("ABANDONED") && blocking.size === 4,
  "UI blocks DRAFT/SUBMITTED/PENDING/CONFIRMED; FAILED/ABANDONED retryable");
check("H2", /pcartAttempts\.find\(\(a\) =>\s*PCART_BLOCKING_STATUSES\.has\(a\.status\)/.test(PANEL) &&
  /!blockedReason &&/.test(PANEL.slice(PANEL.indexOf("const canRun"))),
  "block derived only from PCART attempts and gates canRun");
check("H3", /confirmed exact-artifact rehearsal already exists and must not be repeated/.test(PANEL) &&
  /Resolve it before starting another rehearsal/.test(PANEL) && /Only failed or abandoned attempts may be retried/.test(PANEL),
  "UI explains active-resolve-first and confirmed no-repeat");
const fnStart = SQL.indexOf("FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(");
const fn = SQL.slice(fnStart, SQL.indexOf("$$;", fnStart));
const replayIdx = fn.indexOf("client_request_id = v_request");
const preIdx = fn.search(/IF EXISTS \(\s*SELECT 1 FROM public\.launch_chain_deployments b/);
const allocIdx = fn.indexOf("max(d.attempt_number)");
check("H4", replayIdx > 0 && preIdx > replayIdx && allocIdx > preIdx &&
  /b\.artifact_id = 'pepecartel-token-v1'\s*AND b\.status IN \('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED'\)/.test(fn),
  "RPC precheck runs after idempotent replay and before attempt allocation");
check("H5", /CREATE UNIQUE INDEX IF NOT EXISTS launch_chain_deployments_one_active_pcart_rehearsal\s*ON public\.launch_chain_deployments \(launch_id\)\s*WHERE artifact_id = 'pepecartel-token-v1'\s*AND status IN \('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED'\);/.test(SQL) &&
  SQL.indexOf("launch_chain_deployments_one_active_pcart_rehearsal") < fnStart,
  "partial unique index: one active-or-confirmed PCART rehearsal per launch");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
