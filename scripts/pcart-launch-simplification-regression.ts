/**
 * L-S1 + L-S2 — PCART launch simplification regression.
 * Run: bun scripts/pcart-launch-simplification-regression.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  PCART_STEP_ORDER,
  derivePcartReadiness,
  hasConfirmedPcartRehearsal,
} from "../src/lib/pcart-launch-readiness";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, msg: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`);
}

const PCART = "pepecartel-token-v1";
const GENERIC = "cartel-fixed-erc20-v1";
const row = (artifact_id: string | null, status: string, network_environment = "TESTNET") => ({
  artifact_id,
  status,
  network_environment,
});

const base = derivePcartReadiness({ treasurySignersRecorded: false, deploymentRows: [] });
check("S1", base.steps.map((s) => s.label).join(",") === "Token,Auction,Treasury,Review,Launch",
  "five exact step labels in order");
check("S2", PCART_STEP_ORDER.join(",") === "token,auction,treasury,review,launch", "step order constant");
check("S3", base.steps[1]!.state === "pending_build" && base.steps[1]!.status === "Auction setup pending",
  "auction pending by default");
const allElse = derivePcartReadiness({
  treasurySignersRecorded: true,
  treasurySafeVerified: true,
  deploymentRows: [row(PCART, "CONFIRMED")],
});
check("S4", allElse.steps[1]!.state !== "ready" && !allElse.buildReady,
  "auction never ready without explicit integration input");
check("S5", hasConfirmedPcartRehearsal([row(PCART, "CONFIRMED")]) && allElse.steps[3]!.state === "ready",
  "confirmed pepecartel-token-v1 testnet rehearsal makes Review ready");
check("S6", !hasConfirmedPcartRehearsal([row(GENERIC, "CONFIRMED")]) &&
  derivePcartReadiness({ treasurySignersRecorded: true, deploymentRows: [row(GENERIC, "CONFIRMED")] })
    .steps[3]!.state !== "ready", "generic cartel-fixed-erc20-v1 rows never satisfy PCART rehearsal");
check("S7", !hasConfirmedPcartRehearsal([row(PCART, "PENDING"), row(PCART, "FAILED"), row(PCART, "CONFIRMED", "PRODUCTION"), row(null, "CONFIRMED")]),
  "pending/failed/non-testnet/null rows do not count");
check("S8", base.overall === "Not Ready" && !base.buildReady, "overall Not Ready when incomplete");
check("S9", derivePcartReadiness({ treasurySignersRecorded: true, deploymentRows: [row(PCART, "CONFIRMED")] })
  .steps[2]!.state === "needs_setup", "signers alone do not make Treasury ready");
const full = derivePcartReadiness({
  auctionIntegrated: true,
  treasurySignersRecorded: true,
  treasurySafeVerified: true,
  deploymentRows: [row(PCART, "CONFIRMED")],
  mainnetLocked: true,
});
check("S10", full.buildReady && full.overall === "Ready" && full.mainnetLocked && full.steps[4]!.state === "locked",
  "mainnet lock stays on while overall Ready");
check("S11", base.next?.stepId === "treasury" && full.next === null,
  "next action prefers the first actionable setup step over a pending build");
const onlyPending = derivePcartReadiness({
  treasurySignersRecorded: true,
  treasurySafeVerified: true,
  deploymentRows: [row(PCART, "CONFIRMED")],
});
check("S11b", onlyPending.next?.stepId === "auction",
  "once all setup is done, next may name the pending build dependency");
check("S12", base.steps[0]!.state === "ready" && base.steps[4]!.state === "locked", "token ready, launch locked");

const LIB = readFileSync("src/lib/pcart-launch-readiness.ts", "utf8");
check("S13", !/supabase|\.rpc\(|fetch\(/.test(LIB), "readiness model has no backend access");
check("S14", !LIB.includes(PCART), "model does not hard-code the frozen artifact id (L1C-10 consumer set)");
const GUIDE = readFileSync("src/components/cartel/PcartLaunchSetupGuide.tsx", "utf8");
check("S15", !/<input|<Input|<Button|onClick|onSubmit/.test(GUIDE), "guide is read-only");
const CP = readFileSync("src/components/cartel/PcartProductionBlockedCheckpoint.tsx", "utf8");
check("S16", /Technical details/.test(CP) && !/<Button|onClick|<Input/.test(CP), "checkpoint plain-first, technical collapsed, read-only");

const LAUNCH_CONTROL = readFileSync("src/routes/_authenticated/launch-control.tsx", "utf8");
const safePanelIndex = LAUNCH_CONTROL.indexOf("<TreasurySafeCreatePanel");
const blockedCheckpointIndex = LAUNCH_CONTROL.indexOf("<PcartProductionBlockedCheckpoint");
check(
  "S16a",
  /selectedIsCanonicalPcart && pcartSignerQuery\.data \? \(/.test(LAUNCH_CONTROL) &&
    /signerConfig=\{pcartSignerQuery\.data\}/.test(LAUNCH_CONTROL) &&
    safePanelIndex >= 0 && blockedCheckpointIndex > safePanelIndex,
  "canonical PCART with saved signers renders the Safe card before the protected checkpoint",
);
const tail = LAUNCH_CONTROL.slice(safePanelIndex);
check("S16b", /Historical test\/generic records\.[\s\S]*<VerifiedDeploymentEvidencePanel/.test(tail) &&
  /"Advanced \/ Audit history" : "Technical deployment evidence"/.test(LAUNCH_CONTROL),
  "PCART history only inside collapsed Advanced / Audit; generic label unchanged");
check("S16c", /pcartSafeReady \? \([\s\S]{0,200}Next step: Test PCART before launch[\s\S]{0,120}<PcartProductionBlockedCheckpoint \/>/.test(LAUNCH_CONTROL),
  "PCART checkpoint renders only after Safe verified, framed as next step");
check("S16d", /\{!selectedIsCanonicalPcart \? \(\s*<>\s*<dl/.test(LAUNCH_CONTROL) &&
  LAUNCH_CONTROL.indexOf("<OfficialContractCorrectionPanel") < LAUNCH_CONTROL.indexOf("</>\n                ) : null}"),
  "registration summary/official/notify/broadcast/correction hidden for PCART");
check("S16e", /compact=\{selectedIsCanonicalPcart\}/.test(LAUNCH_CONTROL) && /PCART setup progress/.test(LAUNCH_CONTROL),
  "PCART progress card + compact signer summary");
const SAFE_UI = readFileSync("src/components/cartel/TreasurySafeCreatePanel.tsx", "utf8");
check("S16f", SAFE_UI.includes("Owners (your 3 signer wallets)") && SAFE_UI.includes("Predicted Safe contract address") &&
  SAFE_UI.includes("it is not a\n              fourth signer") && SAFE_UI.includes("Connected signer wallet") &&
  SAFE_UI.includes("It is not added as another owner."), "address labels distinguish owners, Safe contract, connected wallet");

const FORBIDDEN = [
  "contracts/", "artifacts/", "src/lib/launch-artifact-registry.ts", "src/lib/chain-mainnet-registry.ts",
  "src/lib/chain-mainnet-presign.functions.ts", "src/lib/pcart-rehearsal.ts", "src/lib/treasury-signers.ts",
  "src/lib/treasury-safe-verify.ts", "src/lib/treasury-safe-create.ts", "src/lib/treasury-safe-create.functions.ts", "src/lib/treasury-safe-wallet.ts", "src/lib/treasury-safe-verify.functions.ts", "src/lib/pcart-launch-readiness.ts", "supabase/", "docs/sql/", "backend-source/",
];
let changed = "";
try {
  changed = execSync("git diff --name-only HEAD; git ls-files --others --exclude-standard", { encoding: "utf8" });
} catch { /* git unavailable */ }
const bad = changed.split("\n").filter((f) => f && FORBIDDEN.some((p) => f.startsWith(p)));
check("S17", bad.length === 0, `no forbidden security files changed${bad.length ? ": " + bad.join(", ") : ""}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
