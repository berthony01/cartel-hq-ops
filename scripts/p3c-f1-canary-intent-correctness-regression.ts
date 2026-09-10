/**
 * P3C-F1 — CANARY INTENT CORRECTNESS regression.
 *
 * PURE. No network, no database, no wallet, no provider, no environment value,
 * no transaction. Exercises pure helpers and reads repository source text.
 */
import { readFileSync } from "node:fs";
import {
  CANARY_REQUIRED_LAUNCH_CHAIN,
  checkBaseUnitSupply,
  deriveCanaryOnchainSymbol,
  isRobinhoodChainLaunchMetadata,
} from "../src/lib/chain-mainnet-canary-intent";
import { buildMainnetSimulationIntent } from "../src/lib/chain-mainnet-simulation";

const WRAPPER = "src/lib/chain-mainnet-canary.functions.ts";
const ROUTE = "src/routes/_authenticated/mainnet-canary.tsx";
const FORM = "src/components/cartel/CanaryIntentForm.tsx";
const HELPER = "src/lib/chain-mainnet-canary-intent.ts";

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const wrapperSrc = read(WRAPPER);
const wrapperCode = stripComments(wrapperSrc);
const routeSrc = read(ROUTE);
const routeCode = stripComments(routeSrc);
const helperCode = stripComments(read(HELPER));
const formSrc = read(FORM);

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* A — 1,000,000 whole tokens becomes the exact base-unit string. */
const intent = buildMainnetSimulationIntent({
  deployer: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  name: "Pepe Cartel",
  symbol: "PCART",
  supplyWhole: "1000000",
});
check(
  "A1",
  intent.supplyWhole === "1000000",
  "pure intent still carries exact WHOLE tokens (1000000)",
);
check(
  "A2",
  intent.totalSupplyBaseUnits === "1000000000000000000000000",
  "pure intent carries the exact base-unit string 1000000000000000000000000",
);
check(
  "A3",
  checkBaseUnitSupply(intent.totalSupplyBaseUnits).exact === "1000000000000000000000000",
  "validated value is byte-identical to the input decimal string",
);
check(
  "A4",
  /tokenTotalSupplyBaseUnits: intent\.totalSupplyBaseUnits/.test(routeCode) &&
    !/tokenTotalSupply(?!BaseUnits)/.test(routeCode),
  "route passes base units at the production-attempt boundary, never whole tokens",
);
check(
  "A5",
  /_token_total_supply: supply\.exact as unknown as number/.test(wrapperCode),
  "wrapper sends the exact string to the RPC (cast is typing-only)",
);

/* B — lossy or out-of-contract supplies fail closed, with no I/O. */
for (const [id, value, notice] of [
  ["B1", "", "NOT_A_DECIMAL_INTEGER"],
  ["B2", "1e24", "NOT_A_DECIMAL_INTEGER"],
  ["B3", "1000000.5", "NOT_A_DECIMAL_INTEGER"],
  ["B4", "-1000000000000000000", "NOT_A_DECIMAL_INTEGER"],
  ["B5", "01000000000000000000", "NOT_A_DECIMAL_INTEGER"],
  ["B6", "1,000000000000000000", "NOT_A_DECIMAL_INTEGER"],
  ["B7", "1000000", "BELOW_MINIMUM"],
  ["B8", "999999999999999999", "BELOW_MINIMUM"],
  ["B9", "1000000000000000001", "NOT_A_WHOLE_TOKEN_MULTIPLE"],
  ["B10", "1" + "0".repeat(31), "ABOVE_MAXIMUM"],
] as const) {
  const result = checkBaseUnitSupply(value);
  check(`${id}`, result.ok === false && result.notice === notice, `"${value}" → ${notice}`);
}
check(
  "B11",
  checkBaseUnitSupply("9007199254740993000000000000000000000" as string).ok === false,
  "an unsafe JS-number-scale value never passes silently",
);
check(
  "B12",
  checkBaseUnitSupply("1" + "0".repeat(30)).ok === true,
  "exactly 10^30 base units is accepted (inclusive maximum)",
);
check(
  "B13",
  !/Number\(|parseInt|parseFloat|Number\.isSafeInteger|toFixed/.test(helperCode) &&
    !/Number\(|parseInt|parseFloat|Number\.isSafeInteger/.test(
      wrapperCode.slice(
        wrapperCode.indexOf("createCanaryDeploymentAttempt"),
        wrapperCode.indexOf("export const armCanaryExecution"),
      ),
    ),
  "no lossy numeric conversion exists on the supply path",
);
check(
  "B14",
  !/fetch\(|supabase|http/i.test(helperCode),
  "the supply/symbol/chain helpers perform no network or database access",
);

/* C — "$PCART" may prefill the onchain symbol without changing the ticker. */
check("C1", deriveCanaryOnchainSymbol("$PCART") === "PCART", '"$PCART" prefills "PCART"');
check("C2", deriveCanaryOnchainSymbol("PCART") === "PCART", "an already-valid symbol is preserved");
check("C3", deriveCanaryOnchainSymbol("$$PCART") === "", "only ONE leading $ is ever removed");
check("C4", deriveCanaryOnchainSymbol("$pcart") === "", "lowercase is not silently normalized");
check("C5", deriveCanaryOnchainSymbol("$P") === "", "a too-short remainder is not accepted");
check("C6", deriveCanaryOnchainSymbol("$PEPECARTELCOIN") === "", "a too-long remainder is refused");
check("C7", deriveCanaryOnchainSymbol(null) === "", "a missing ticker fails closed to empty");
check(
  "C8",
  /setSymbol\(deriveCanaryOnchainSymbol\(row\.ticker\)\)/.test(routeCode) &&
    !/setTicker|ticker:|update\(|\.from\("launches"\)/.test(routeCode),
  "the route only prefills the separate input and never writes launches.ticker",
);
check(
  "C9",
  /const SYMBOL = \/\^\[A-Z0-9\]\{2,11\}\$\//.test(wrapperCode) &&
    /!SYMBOL\.test\(data\.tokenSymbol\)/.test(wrapperCode),
  "the server wrapper enforces the authoritative onchain symbol rule",
);

/* D — a launch whose chain is not Robinhood Chain cannot create an attempt. */
check("D1", isRobinhoodChainLaunchMetadata("Robinhood Chain") === true, "Robinhood Chain eligible");
check("D2", isRobinhoodChainLaunchMetadata("Solana") === false, "Solana is NOT eligible");
check("D3", isRobinhoodChainLaunchMetadata(null) === false, "missing chain fails closed");
check("D4", isRobinhoodChainLaunchMetadata("robinhood") === false, "a partial value fails closed");
check(
  "D5",
  CANARY_REQUIRED_LAUNCH_CHAIN === "Robinhood Chain",
  "Robinhood Chain is the only eligible metadata value",
);
check(
  "D6",
  /!chainEligible \|\|\s*!!deploymentId \|\|\s*attemptBlocksCreation/.test(routeCode) &&
    /if \(!intent \|\| !chainEligible \|\| attemptBlocksCreation\) return;/.test(routeCode),
  "the attempt button is disabled AND the handler re-checks chain eligibility",
);
check(
  "D7",
  /isRobinhoodChainLaunchMetadata\(launch\.chain\)/.test(wrapperCode) &&
    /return attemptFail\("LAUNCH_CHAIN_MISMATCH"\)/.test(wrapperCode),
  "the server wrapper independently fails closed on launch chain mismatch",
);
check(
  "D8",
  /Blocked: this launch records its chain as/.test(formSrc),
  "the mismatch is surfaced explicitly to the operator",
);
check(
  "D9",
  !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(routeCode + formSrc) &&
    !/from\("launches"\)[\s\S]{0,80}(update|insert|upsert|delete)/.test(wrapperCode),
  "this checkpoint writes nothing to the launch row",
);

/* E — nothing new arms, sends, adds liquidity or registers. */
for (const term of [
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "signTransaction",
  "add_?liquidity",
  "register_official_contract",
  "emergency_stop_engaged: false",
  "process\\.env",
  "client\\.server",
  "SERVICE_ROLE",
  "telegram",
]) {
  check(
    `E:${term}`,
    !new RegExp(term, "i").test([helperCode, formSrc, wrapperCode].join("\n")),
    `no \`${term}\` path added by this correction`,
  );
}

/* F — P3C-F3 existing-attempt awareness (read-only, no duplicate creation). */
check(
  "F1",
  /export const readCanaryExistingAttempt = createServerFn/.test(wrapperCode) &&
    /\.middleware\(\[requireSupabaseAuth\]\)/.test(wrapperCode),
  "the existing-attempt lookup is an authenticated server function",
);
check(
  "F2",
  /readCanaryExistingAttempt[\s\S]*?isPlatformOwner\(/.test(wrapperCode),
  "the lookup re-checks platform ownership server-side",
);
{
  const start = wrapperCode.indexOf("export const readCanaryExistingAttempt");
  const body = start >= 0 ? wrapperCode.slice(start) : "";
  check(
    "F3",
    body.length > 0 &&
      !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(\s*"(?!is_platform_owner)/.test(body),
    "the lookup writes nothing and calls no mutation RPC",
  );
  check(
    "F4",
    /from\("launch_chain_deployments"\)/.test(body) &&
      /\.eq\("chain_id", ROBINHOOD_MAINNET_CHAIN_ID\)/.test(body) &&
      /\.eq\("network_environment", "PRODUCTION"\)/.test(body) &&
      /\.eq\("deployment_kind", "FIXED_SUPPLY_ERC20"\)/.test(body) &&
      /ACTIVE_ATTEMPT_STATUSES = \["DRAFT", "SUBMITTED", "PENDING"\] as const/.test(wrapperCode) &&
      /CONFIRMED_ATTEMPT_STATUS = "CONFIRMED" as const/.test(wrapperCode) &&
      /TERMINAL_ATTEMPT_STATUSES = \["FAILED", "ABANDONED"\] as const/.test(wrapperCode),
    "the lookup is scoped to chain 4663 PRODUCTION fixed-supply rows with explicit status classes",
  );
}

check(
  "F5",
  /attemptBlocksCreation/.test(routeCode) &&
    /disabled=\{[\s\S]{0,200}attemptBlocksCreation/.test(routeCode),
  "the console refuses to create a duplicate attempt while one is nonterminal",
);
check(
  "F6",
  /attemptBoundDeployer=\{existingAttempt\?\.deployerAddress/.test(routeCode) &&
    /attemptBoundRecipient=\{existingAttempt\?\.tokenRecipient/.test(routeCode),
  "the immutable attempt deployer and recipient are passed to the intent form",
);
check(
  "F7",
  /expectedDeployer=\{[\s\S]{0,160}existingAttempt\?\.deployerAddress[\s\S]{0,160}deployer\.trim\(\)/.test(
    routeCode,
  ) && !/expectedDeployer=\{intent\?\.deployer/.test(routeCode),
  "the wallet panel expects the attempt deployer, else the provisional form deployer",
);
check(
  "F8",
  /const recipientLocked = attemptRecipient !== null \|\| boundWallet !== null;/.test(formSrc) &&
    /readOnly=\{recipientLocked\}/.test(formSrc),
  "an attempt-bound or wallet-bound recipient renders read-only exactly like the deployer",
);
check(
  "F9",
  /const activeDeploymentId = deploymentId \?\? existingAttempt\?\.deploymentId \?\? null;/.test(
    routeCode,
  ) &&
    // NEGATIVE TRIPWIRE: no manual resume, abandon or overwrite action returns.
    !/Resume existing attempt|Start new attempt anyway|abandonCanary|abandon_launch_chain/.test(
      routeSrc,
    ),
  "continuation is automatic local derivation; no resume/abandon/overwrite action exists",
);
{
  const line = routeCode.indexOf("const activeDeploymentId =");
  const statement =
    line >= 0 ? routeCode.slice(line, routeCode.indexOf(";", line) + 1) : "";
  // Every useEffect body in the route, to prove the derivation drives no stage.
  const effects = routeCode.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  const stage = /\b(presign|arm|claim|sendWindow|persist|verify|reconcile|send)\(/;
  check(
    "F10",
    statement.length > 0 &&
      // The derivation itself is a pure nullish-coalescing read: no call at all.
      !/\(/.test(statement.replace("const activeDeploymentId =", "")) &&
      effects.length > 0 &&
      effects.every((body) => !stage.test(body)),
    "deriving activeDeploymentId triggers no presign/ARM/CLAIM/send/persist/verify",
  );
}

/* G — LIQUIDITY-CANARY RECIPIENT SAFETY: recipient must equal deployer. */
check(
  "G1",
  /CANARY SAFETY MODE: the deployer wallet is also the sole recipient\./.test(formSrc) &&
    /if \(!latest\.attemptBoundRecipient\?\.trim\(\) && latest\.recipient\.trim\(\)\.toLowerCase\(\) !== matched\) \{\s*\n\s*latest\.onRecipient\(matched\);/.test(
      formSrc,
    ),
  "a matched connected wallet binds the recipient to the same address as the deployer",
);
check(
  "G2",
  /const deployerLocked = attemptDeployer !== null \|\| boundWallet !== null;/.test(formSrc) &&
    /const recipientLocked = attemptRecipient !== null \|\| boundWallet !== null;/.test(formSrc),
  "both fields are read-only while the wallet binding is active",
);
check(
  "G3",
  /Canary safety mode: the connected deployer wallet receives 100% of the supply\./.test(formSrc),
  "the safety-mode copy is shown to the operator",
);
{
  const start = formSrc.indexOf("const unbind = useCallback");
  const body = start >= 0 ? formSrc.slice(start, formSrc.indexOf("}, []);", start)) : "";
  check(
    "G4",
    /if \(current\.deployer\.trim\(\)\.toLowerCase\(\) === previous\) current\.onDeployer\(""\);/.test(
      body,
    ) &&
      /if \(!current\.attemptBoundRecipient\?\.trim\(\) && current\.recipient\.trim\(\)\.toLowerCase\(\) === previous\)/.test(
        body,
      ) &&
      /current\.onRecipient\(""\);/.test(body),
    "unbind clears ONLY the values this component auto-bound, never attempt-bound state",
  );
}
check(
  "G5",
  /\| "RECIPIENT_MUST_MATCH_DEPLOYER"/.test(wrapperCode),
  "RECIPIENT_MUST_MATCH_DEPLOYER is part of the sanitized notice union",
);
{
  const start = wrapperCode.indexOf("export const createCanaryDeploymentAttempt");
  const body = wrapperCode.slice(start, wrapperCode.indexOf("export const armCanaryExecution"));
  const guard = body.indexOf('data.tokenRecipient !== data.deployerAddress');
  const rpc = body.indexOf("create_launch_chain_production_token_deployment_attempt");
  check(
    "G6",
    guard > 0 &&
      /if \(data\.tokenRecipient !== data\.deployerAddress\) \{\s*\n\s*return attemptFail\("RECIPIENT_MUST_MATCH_DEPLOYER"\);/.test(
        body,
      ),
    "the server fails closed when the recipient does not match the deployer",
  );
  check("G7", guard > 0 && rpc > 0 && guard < rpc, "the check runs BEFORE the production attempt RPC");
  check(
    "G8",
    /deployerAddress: text\(input\.deployerAddress\)\.toLowerCase\(\)/.test(body) &&
      /tokenRecipient: text\(input\.tokenRecipient\)\.toLowerCase\(\)/.test(body),
    "the comparison uses the existing lowercase normalization",
  );
}

/* H — CROSS-LAUNCH LEAK GUARD: no identity or context survives a launch switch. */
{
  const start = routeCode.indexOf("const resetLaunchScopedState = () => {");
  const reset = start >= 0 ? routeCode.slice(start, routeCode.indexOf("\n  };", start)) : "";
  const required = [
    "setDeployer(\"\")",
    "setRecipient(\"\")",
    "setSupply(\"\")",
    "setIntent(null)",
    "setIntentError(null)",
    "setDeploymentId(null)",
    "setAuthorizationId(null)",
    "setAuthorizationExpiresAt(null)",
    "setArmPhrase(\"\")",
    "setArmSuccess(false)",
    "setClaimSuccess(false)",
    "setQuote(null)",
    "setClaimed(null)",
    "setArmed(null)",
    "setWindowResult(null)",
    "setPreflight(null)",
    "setSendResult(null)",
    "setTxHash(null)",
    "setTail(null)",
  ];
  const missing = required.filter((entry) => !reset.includes(entry));
  check(
    "H1a",
    reset.length > 0 && missing.length === 0,
    `launch switch clears every launch-scoped field${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  );
  check(
    "H1b",
    /const selectLaunch = \(id: string\) => \{\s*\n\s*resetLaunchScopedState\(\);\s*\n\s*setLaunchId\(id\);/.test(
      routeCode,
    ),
    "the selector resets launch-scoped state BEFORE applying the new launch id",
  );
  check(
    "H1c",
    /resetLaunchScopedState\(\);\s*\n\s*setLaunchId\(row\.id\);/.test(routeCode),
    "a restored stored selection resets launch-scoped state too",
  );
}
check(
  "H2",
  /const activeDeploymentId = deploymentId \?\? existingAttempt\?\.deploymentId \?\? null;/.test(
    routeCode,
  ) &&
    !/activeDeploymentId = [^;]*confirmed/i.test(routeCode) &&
    /setDeploymentId\(null\)/.test(routeCode),
  "a deployment id from launch X cannot become the active deployment id for launch Y",
);
check(
  "H3",
  /const confirmedDeployment = existing\.data\?\.confirmed \?\? null;/.test(routeCode) &&
    /Completed historical deployment/.test(routeSrc) &&
    /attemptBlocksCreation =\s*\n?\s*existingUnverified \|\| existingAttempt !== null \|\| confirmedDeployment !== null;/.test(
      routeCode,
    ) &&
    !/attemptBoundDeployer=\{confirmedDeployment|attemptBoundRecipient=\{confirmedDeployment|expectedDeployer=\{confirmedDeployment/.test(
      routeCode,
    ),
  "a CONFIRMED deployment is history only: it blocks creation and never binds or resumes",
);
check(
  "H4",
  /attempt: active \? toAttempt\(active\) : null/.test(wrapperCode) &&
    /const active =\s*\n?\s*all\.find\(\(row\) =>\s*\n?\s*\(ACTIVE_ATTEMPT_STATUSES as readonly string\[\]\)\.includes\(row\.status\)/.test(
      wrapperCode,
    ),
  "DRAFT/SUBMITTED/PENDING remain the only resumable, immutable active attempt",
);
check(
  "H5",
  /TERMINAL_ATTEMPT_STATUSES rows are intentionally ignored/.test(wrapperSrc) &&
    !/attempt: .*(FAILED|ABANDONED)/.test(wrapperCode),
  "FAILED/ABANDONED bind no intent and block nothing",
);
check(
  "H6",
  /\}, \[syncBinding, props\.launchId, props\.attemptBoundDeployer, props\.attemptBoundRecipient\]\);/.test(
    formSrc,
  ),
  "the form re-binds the verified connected wallet when the launch or attempt binding changes",
);
check(
  "H7",
  !/0x[0-9a-fA-F]{40}/.test(
    [routeSrc, formSrc, wrapperSrc].join("\n").replace(/0x0{40}/g, ""),
  ),
  "no hardcoded EOA address exists in the route, form or wrapper",
);


/* I — MOBILE LOCKED ADDRESS DISPLAY: full readout, no clipping, derived suffix. */
check(
  "I1",
  /break-all[\s\S]{0,240}\{deployerValue\}/.test(formSrc) &&
    /font-mono[\s\S]{0,240}\{deployerValue\}/.test(formSrc) &&
    /break-all[\s\S]{0,240}\{recipientValue\}/.test(formSrc) &&
    /font-mono[\s\S]{0,240}\{recipientValue\}/.test(formSrc),
  "locked deployer and recipient render as break-all monospace full-address readouts",
);
check(
  "I2",
  /Ends in \{deployerValue\.slice\(-4\)\}/.test(formSrc) &&
    /Ends in \{recipientValue\.slice\(-4\)\}/.test(formSrc) &&
    !/Ends in (?:[0-9a-fA-F]{4}|d617|6485)/.test(formSrc),
  "the 'Ends in' suffix is dynamically derived from the last 4 characters",
);
check(
  "I3",
  /<Input[\s\S]{0,200}id="canary-deployer"/.test(formSrc) &&
    /<Input[\s\S]{0,200}id="canary-recipient"/.test(formSrc) &&
    /readOnly=\{deployerLocked\}/.test(formSrc) &&
    /readOnly=\{recipientLocked\}/.test(formSrc),
  "editable Input behavior remains when the field is not locked",
);
check(
  "I4",
  !/0x[0-9a-fA-F]{40}/.test(formSrc.replace(/0x0{40}/g, "")),
  "no hardcoded EOA address exists in the intent form",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
