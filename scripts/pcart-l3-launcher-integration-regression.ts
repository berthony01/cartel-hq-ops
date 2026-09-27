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
  !isArtifactAllowedIn("pepecartel-token-v1", "PRODUCTION"), "PCART is TESTNET-only");
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
check("C2", /isCanonicalPcartLaunch\(selected\)\s*\?\s*\(\s*<PcartProductionBlockedCheckpoint \/>/.test(LC),
  "Launch Control renders the blocked checkpoint instead of the generic request form for the canonical launch");
check("C3", !/<input|<Input|<Button|onClick|onSubmit/.test(CHECKPOINT), "checkpoint is read-only (no inputs/actions)");
for (const b of ["rehearsal", "2-of-3", "Safe verification", "production-allowlist migration"]) {
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

// D. staged SQL — fail-closed + no generic-mainnet fallback
check("D0", readdirSync("supabase/migrations").every((f) => !/pepecartel-token-v1/.test(read(`supabase/migrations/${f}`))),
  "SQL is staged only; no applied migration references pepecartel-token-v1");
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
  "staged SQL does not touch runtime control, emergency stop or liquidity switches");
check("D11", /^BEGIN;/m.test(SQL) && /^COMMIT;/m.test(SQL), "staged SQL is a single transaction");

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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
