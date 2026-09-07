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
      wrapperCode.slice(wrapperCode.indexOf("createCanaryDeploymentAttempt")),
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
  /!chainEligible \|\| !!deploymentId/.test(routeCode) &&
    /if \(!intent \|\| !chainEligible\) return;/.test(routeCode),
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

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
