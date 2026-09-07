/**
 * P3C-E — VERIFIER STATE-WRITE ACTIVATION regression.
 *
 * SOURCE/LOGIC-LEVEL ONLY. No network, no database, no wallet, no provider
 * call, no environment value. Reads repository source text and the two pure
 * registry constants.
 */
import { readFileSync } from "node:fs";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
} from "../src/lib/chain-mainnet-registry";

const APPLY = "src/lib/chain-mainnet-verify-apply.ts";
const VERIFY = "src/lib/chain-mainnet-verify.functions.ts";
const SHAPE = "src/lib/chain-mainnet-verify-shape.ts";

const read = (p: string) => readFileSync(p, "utf8");
const applySrc = read(APPLY);
const verifySrc = read(VERIFY);
const shapeSrc = read(SHAPE);

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) {
    console.log(`PASS ${id} — ${detail}`);
  } else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* A — verifier write gate is literal true. */
check(
  "A",
  /export const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = true as const;/.test(applySrc),
  "MAINNET_VERIFICATION_STATE_WRITES_ENABLED is literal `true as const`",
);

/* B / C — transaction execution switches remain literal false. */
check(
  "B",
  (MAINNET_DEPLOYMENT_TX_ENABLED as boolean) === false &&
    /export const MAINNET_DEPLOYMENT_TX_ENABLED = false as const;/.test(
      read("src/lib/chain-mainnet-registry.ts"),
    ),
  "MAINNET_DEPLOYMENT_TX_ENABLED is literal `false as const`",
);
check(
  "C",
  (MAINNET_LIQUIDITY_TX_ENABLED as boolean) === false &&
    /export const MAINNET_LIQUIDITY_TX_ENABLED = false as const;/.test(
      read("src/lib/chain-mainnet-registry.ts"),
    ),
  "MAINNET_LIQUIDITY_TX_ENABLED is literal `false as const`",
);

/* D — result field reflects the gate and is no longer hardcoded false. */
check(
  "D1",
  /stateWritesEnabled: boolean;/.test(shapeSrc) && !/stateWritesEnabled: false/.test(shapeSrc),
  "MainnetVerifyResult.stateWritesEnabled is boolean, not literal false",
);
check(
  "D2",
  /stateWritesEnabled: STATE_WRITES_ENABLED,/.test(shapeSrc),
  "baseResult() reports the actual gate state",
);

/* E — service-role import stays inside the guarded helpers. */
const applyLines = applySrc.split("\n");
const adminImports = applyLines
  .map((line, i) => ({ line, i }))
  .filter((x) => x.line.includes("@/integrations/supabase/client.server"));
check(
  "E1",
  adminImports.length === 2 && adminImports.every((x) => x.line.includes("await import(")),
  "admin client is only dynamically imported (2 sites), never at module top level",
);
const guardBeforeImport = adminImports.every((x) =>
  applyLines
    .slice(Math.max(0, x.i - 6), x.i)
    .some((l) => l.includes("assertStateWritesEnabled();")),
);
check("E2", guardBeforeImport, "each admin import is preceded by assertStateWritesEnabled()");
check(
  "E3",
  /export function assertStateWritesEnabled\(\): void \{\s*\n\s*if \(!STATE_WRITES_ENABLED\) \{/.test(
    applySrc,
  ),
  "guard fails closed if the authoritative gate is ever set back to false",
);
check(
  "E4",
  !/client\.server/.test(verifySrc),
  "verifier module itself never imports the service-role client",
);

/* F — apply order: PENDING -> managed finality -> CONFIRMED after FINALIZED. */
const pendingIdx = verifySrc.indexOf('applyProductionDeploymentVerification({ ...minedEvidence, status: "PENDING" })');
const finalizedApplyIdx = verifySrc.indexOf('finalityState: "FINALIZED"');
const confirmedIdx = verifySrc.indexOf('status: "CONFIRMED"');
check(
  "F1",
  pendingIdx > 0 && finalizedApplyIdx > pendingIdx && confirmedIdx > finalizedApplyIdx,
  "order is mined/token PENDING -> managed FINALIZED -> CONFIRMED",
);
check(
  "F2",
  /finalizedApplied/.test(verifySrc) || /pendingRowEstablished/.test(verifySrc),
  "CONFIRMED remains conditioned on the preceding successful applies",
);
check(
  "F3",
  /_finality_provider_kind: "MANAGED"/.test(applySrc),
  "MANAGED remains the only finality authority",
);

/* G — no execution/broadcast/registration path added to the touched modules. */
/** Comments describe the safety boundary; only executable code is scanned. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const touched = [applySrc, verifySrc, shapeSrc].map(stripComments).join("\n");
const forbidden = [
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "walletClient",
  "createWalletClient",
  "privateKey",
  "presign",
  "canary",
  "send_window",
  "sendWindow",
  "liquidity",
  "register_official_contract",
  "telegram",
  "rebroadcast",
];
for (const term of forbidden) {
  check(
    `G:${term}`,
    !new RegExp(term, "i").test(touched),
    `no \`${term}\` path in the touched verifier modules`,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
