/** PCART P9.2 — bound send permit regression (deterministic; no network, no DB writes, no permit issued). */
import { readFileSync, readdirSync } from "node:fs";
import { P8A_MAINNET_DEPENDENCIES, P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "../src/lib/pcart-auction-liquidity-plan";
import { P8B_MANIFEST_FINGERPRINT, P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE } from "../src/lib/pcart-auction-execution-p8b";
import {
  dependencyAttestationFingerprint, issuanceBlockers, permitBindingFailures, safeAttestationFingerprint,
  P9_2_ACTION_TYPE, P9_2_BINDING_VERSION, type BoundPermit, type CurrentFacts,
} from "../src/lib/pcart-p9-2-permit-binding";
import { derivePreflight, deriveDeploymentSegment } from "../src/lib/pcart-launch-coordinator-p9-2";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const MIG_FILE = readdirSync("supabase/migrations").find((f) => read(`supabase/migrations/${f}`).includes("P9.2: bind the EXISTING canonical PCART execution permit"));
const MIG = MIG_FILE ? read(`supabase/migrations/${MIG_FILE}`) : "";
const ISSUE = MIG.slice(MIG.indexOf("FUNCTION public.issue_canonical_pcart_execution_permit_v2"), MIG.indexOf("FUNCTION public.claim_canonical_pcart_mainnet_send_v2"));
const CLAIM = MIG.slice(MIG.indexOf("FUNCTION public.claim_canonical_pcart_mainnet_send_v2"), MIG.indexOf("-- Retire the legacy"));
const EXEC = read("src/lib/pcart-production-execution.functions.ts");
const SEND = read("src/lib/pcart-production-send.functions.ts");
const ATT = read("src/lib/pcart-p9-2-attestation.server.ts");
const BIND = read("src/lib/pcart-p9-2-permit-binding.ts");
const P9FNS = read("src/lib/pcart-launch-coordinator-p9.functions.ts");
const PANEL = read("src/components/cartel/PcartLaunchDayCoordinatorPanel.tsx");

const deps: Record<string, string> = {}; for (const d of P8A_MAINNET_DEPENDENCIES) deps[d.key] = d.codeHash;
const DEP_FP = dependencyAttestationFingerprint(deps)!;
const safeSnap = { status: "READY" as const, owners: [...P8B_REAL_TREASURY_SAFE.owners], nonce: 0, threshold: 2, version: "1.4.1" };
const SAFE_FP = safeAttestationFingerprint(safeSnap)!;
const W = "0xc23bd6148a29318cc19264e096623ffcdac19245", PRED = "0x" + "9".repeat(40), TXFP = "0x" + "a".repeat(64), RVFP = "0x" + "b".repeat(64);
const permit: BoundPermit = {
  bindingVersion: P9_2_BINDING_VERSION, actionType: P9_2_ACTION_TYPE, launchId: "L", deploymentId: "D11", chainId: 4663, walletAccount: W, deployerNonce: "0",
  predictedContractAddress: PRED, unsignedTxFingerprint: TXFP, reviewFingerprint: RVFP,
  p8aManifestVersion: P8A_MANIFEST_VERSION, p8aManifestFingerprint: P8A_MANIFEST_FINGERPRINT, p8aReviewId: "ra",
  p8bManifestVersion: P8B_MANIFEST_VERSION, p8bManifestFingerprint: P8B_MANIFEST_FINGERPRINT, p8bReviewId: "rb",
  dependencyAttestationFingerprint: DEP_FP, safeAttestationFingerprint: SAFE_FP, executionControlRevision: "5",
  expiresAt: new Date(1_000_030_000).toISOString(), consumedAt: null, cancelledAt: null,
};
const facts: CurrentFacts = {
  nowMs: 1_000_000_000, launchId: "L", deploymentId: "D11", attemptStatus: "DRAFT", attemptTxHash: null, attemptSubmittedAt: null, attemptContractAddress: null,
  officialContractAddress: null, activeSendClaim: false, chainId: 4663, deployer: W, deployerNonce: "0", predictedContractAddress: PRED, unsignedTxFingerprint: TXFP, reviewFingerprint: RVFP,
  p8aCurrentReview: { id: "ra", manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT },
  p8bCurrentReview: { id: "rb", manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT },
  liveDependencyAttestationFingerprint: DEP_FP, liveSafeAttestationFingerprint: SAFE_FP, executionEnabled: false, emergencyStopEngaged: true, executionControlRevision: "5",
};
const fails = (p: Partial<BoundPermit>, c: Partial<CurrentFacts>) => permitBindingFailures({ ...permit, ...p }, { ...facts, ...c });
const has = (p: Partial<BoundPermit>, c: Partial<CurrentFacts>, k: string) => (fails(p, c) as string[]).includes(k);

check("0", !!MIG_FILE && permitBindingFailures(permit, facts).length === 0, "baseline bound permit authorizes under protected controls (fixture only)");
// 1 legacy
check("1", has({ bindingVersion: null }, {}, "LEGACY_UNBOUND_PERMIT") && /binding_version IS DISTINCT FROM 'P9_2_DEPLOY_V1'/.test(CLAIM) && /Superseded by P9\.2 bound send claim/.test(MIG) && /Superseded by P9\.2 bound permit issuance/.test(MIG) && /REVOKE ALL ON FUNCTION public\.claim_canonical_pcart_mainnet_send\(uuid\) FROM PUBLIC, anon, authenticated/.test(MIG), "legacy unbound permit cannot authorize; legacy RPCs retired + revoked");
check("1b", /ADD COLUMN binding_version text,/.test(MIG) && !/binding_version text[^,]*DEFAULT/i.test(MIG) && !/UPDATE public\.pcart_production_execution_permits SET (?!consumed_at)/.test(MIG), "nullable columns, no default, historical rows untouched");
// 2-10 binds
check("2", has({ p8aManifestFingerprint: "0x" + "0".repeat(64) }, {}, "P8A_NOT_CURRENT") && /p8a_review_id/.test(ISSUE) && ISSUE.includes(P8A_MANIFEST_FINGERPRINT), "binds P8A manifest fingerprint + review id");
check("3", has({ p8bManifestFingerprint: "0x" + "0".repeat(64) }, {}, "P8B_NOT_CURRENT") && /p8b_review_id/.test(ISSUE) && ISSUE.includes(P8B_MANIFEST_FINGERPRINT), "binds P8B manifest fingerprint + review id");
check("4", ISSUE.includes(DEP_FP) && CLAIM.includes("e.dependency_attestation_fingerprint"), "binds the pinned dependency attestation fingerprint (TS == SQL)");
check("5", /execution_control_revision/.test(ISSUE) && /k\.revision IS DISTINCT FROM e\.execution_control_revision/.test(CLAIM), "binds control revision");
check("6", has({ chainId: 1 }, {}, "CHAIN_MISMATCH") && /e\.chain_id IS DISTINCT FROM 4663/.test(CLAIM), "binds chain 4663");
check("7", has({ launchId: "X" }, {}, "LAUNCH_MISMATCH") && has({ deploymentId: "D10" }, {}, "ATTEMPT_MISMATCH") && /d\.launch_id <> e\.launch_id/.test(CLAIM), "binds launch + attempt");
check("8", has({ walletAccount: "0x" + "1".repeat(40) }, {}, "DEPLOYER_MISMATCH") && has({ deployerNonce: "1" }, {}, "NONCE_MISMATCH"), "binds deployer + nonce");
check("9", has({ predictedContractAddress: "0x" + "8".repeat(40) }, {}, "PREDICTED_ADDRESS_MISMATCH"), "binds predicted address");
check("10", has({ unsignedTxFingerprint: "0x" + "c".repeat(64) }, {}, "UNSIGNED_TX_MISMATCH") && has({ reviewFingerprint: "0x1" }, {}, "REVIEW_MISMATCH") && /pcart_unsigned_tx_fingerprint\(/.test(CLAIM), "binds unsigned tx + review fingerprint");
// 11-19 invalidation
check("11", has({}, { p8aCurrentReview: { id: "ra2", manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT } }, "P8A_NOT_CURRENT") && has({}, { p8aCurrentReview: null }, "P8A_NOT_CURRENT") && /P8A approval changed/.test(CLAIM), "P8A change / revocation invalidates");
check("12", has({}, { p8bCurrentReview: { id: "rb2", manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT } }, "P8B_NOT_CURRENT") && /P8B approval changed/.test(CLAIM) && /pcart_policy_approval_revocations/.test(MIG), "P8B change / revocation invalidates");
const badDeps = { ...deps, [P8A_MAINNET_DEPENDENCIES[0]!.key]: "0x" + "e".repeat(64) };
check("13", dependencyAttestationFingerprint(badDeps) === null && has({}, { liveDependencyAttestationFingerprint: null }, "DEPENDENCY_ATTESTATION_MISMATCH") && has({}, { liveSafeAttestationFingerprint: safeAttestationFingerprint({ ...safeSnap, nonce: 1 }) }, "SAFE_ATTESTATION_MISMATCH"), "dependency / Safe attestation change invalidates");
check("14", has({}, { executionControlRevision: "6" }, "CONTROL_REVISION_CHANGED"), "control revision change invalidates");
check("15", has({}, { deployerNonce: "1" }, "NONCE_MISMATCH"), "nonce change invalidates");
check("16", has({}, { deployer: "0x" + "2".repeat(40) }, "DEPLOYER_MISMATCH"), "wallet/deployer change invalidates");
check("17", has({}, { attemptStatus: "ABANDONED" }, "ATTEMPT_NOT_DRAFT"), "attempt state change invalidates");
check("18", has({}, { attemptTxHash: "0x1" }, "TX_OR_CLAIM_EXISTS") && has({}, { activeSendClaim: true }, "TX_OR_CLAIM_EXISTS") && has({}, { officialContractAddress: PRED }, "OFFICIAL_CONTRACT_EXISTS"), "tx hash / send claim / official contract invalidates");
check("19", has({ expiresAt: new Date(0).toISOString() }, {}, "PERMIT_EXPIRED") && has({ consumedAt: "x" }, {}, "PERMIT_CONSUMED") && has({ cancelledAt: "x" }, {}, "PERMIT_CANCELLED") && /interval '30 seconds'/.test(ISSUE), "expired/consumed/cancelled invalid; 30s lifetime kept");
// 20-24 issuance / passive
check("20", !/INSERT INTO public\.pcart_production_execution_permits/.test(MIG.replace(ISSUE, "")) && !/issue_canonical_pcart_execution_permit/.test(P9FNS + PANEL), "no automatic permit creation outside the explicit issuance RPC");
const iss = (o: Partial<Parameters<typeof issuanceBlockers>[0]>) => issuanceBlockers({ ...facts, activePermit: false, ...o } as any) as string[];
check("21", iss({ executionEnabled: true }).includes("EXECUTION_NOT_PROTECTED") && has({}, { executionEnabled: true }, "EXECUTION_NOT_PROTECTED") && /execution_enabled IS DISTINCT FROM false/.test(ISSUE) && /execution_enabled IS DISTINCT FROM false/.test(CLAIM), "execution switched ON blocks issuance + claim");
check("22", iss({ emergencyStopEngaged: false }).includes("EXECUTION_NOT_PROTECTED") && has({}, { emergencyStopEngaged: false }, "EXECUTION_NOT_PROTECTED") && /emergency_stop_engaged IS DISTINCT FROM true/.test(ISSUE), "emergency stop released blocks issuance + claim");
check("23", !/\.rpc\("(issue|claim)_canonical/.test(P9FNS) && !/preparePcartFinalSend|claimPcartMainnetSend/.test(P9FNS + PANEL), "passive P9.2 load never issues a permit or claims");
check("24", /already active for this draft/.test(ISSUE) && /e\.consumed_at IS NULL AND e\.expires_at > now\(\)/.test(ISSUE) && /send claim already exists/.test(CLAIM) && /This permit was already used/.test(CLAIM), "no duplicate permit / send; no silent regeneration");
// 25 stale snapshot hotfix + gate
check("25", /q\.data && q\.data\.ok && q\.data\.preflight && q\.data\.estimate \? q\.data : null/.test(PANEL) && deriveDeploymentSegment({ attempt: null, claimStatus: null, readinessApproved: true, preparationActive: false, permitActive: false, launch: { status: "LAUNCH_APPROACHING", officialContractAddress: null }, preflight: { allPass: true, controlBlockers: [] } as any, planValid: false }).panel === null, "stale/cached snapshot fails closed (missing gate field → locked)");
// 26 no wallet stack
check("26", !/WalletConnect|EthereumProvider|createWalletClient|window\.ethereum|sendTransaction|signTypedData|signMessage|writeContract/.test(BIND + ATT), "no new wallet/provider/sign/send primitive");
// server-side re-attestation wiring
check("27", /attestP9_2Live/.test(EXEC) && /issue_canonical_pcart_execution_permit_v2/.test(EXEC) && /attestP9_2Live/.test(SEND) && /claim_canonical_pcart_mainnet_send_v2/.test(SEND) && /cancel_canonical_pcart_execution_permit/.test(SEND) && /await import\("@\/lib\/pcart-p9-2-attestation\.server"\)/.test(EXEC + SEND), "server re-attests live before issuance and before claim; mismatch cancels");
check("27b", /GRANT EXECUTE ON FUNCTION public\.issue_canonical_pcart_execution_permit_v2\([^)]*\) TO service_role;/.test(MIG) && !/issue_canonical_pcart_execution_permit_v2\([^)]*\) TO authenticated/.test(MIG) && /is_platform_owner\(_actor\)/.test(ISSUE) && /is_platform_owner\(_actor\)/.test(CLAIM), "bound RPCs are service-role only (browser cannot skip live re-attestation); owner verified");
check("27c", !/execution_enabled\s*=\s*true|emergency_stop_engaged\s*=\s*false|UPDATE public\.launch_chain_production_execution_controls|UPDATE public\.launches/.test(MIG), "migration never mutates controls or lifecycle");
// 28 canary
check("28", /CANONICAL_PCART_PROTECTED/.test(read("src/lib/chain-mainnet-canary.functions.ts")), "canary remains CANONICAL_PCART_PROTECTED");
const pfLocked = derivePreflight({ chain: { live: true, chainId: 4663 }, safe: { status: "READY", reasons: [], threshold: 2, nonce: 0, owners: [] }, configuredSigners: [], dependencies: "VERIFIED", p8a: "CURRENT", p8b: "CURRENT", attempt: null, activeProductionAttempts: 0, uncertainClaim: false, deployerLive: { nonce: null, balanceWei: null }, control: { executionEnabled: false, emergencyStopEngaged: true }, sendWindowOpen: false });
check("29", !pfLocked.sendGateOpen && pfLocked.controlBlockers.length === 1 && /window/.test(pfLocked.controlBlockers[0]!), "today: protected controls OK, closed send window is the only gate");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
