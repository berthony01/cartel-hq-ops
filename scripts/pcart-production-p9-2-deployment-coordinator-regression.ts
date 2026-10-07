/** PCART P9.2 — guided deployment coordinator regression (deterministic; no network, no DB writes). */
import { readFileSync, readdirSync } from "node:fs";
import { deriveDeploymentSegment, derivePreflight, P9_2_STATES, type P92Input, type P92PreflightInput } from "../src/lib/pcart-launch-coordinator-p9-2";
import { pcartProductionInitCodeHash, predictPcartProductionAddress, PCART_PRODUCTION_TREASURY_SAFE } from "../src/lib/pcart-production-intent";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const P92 = read("src/lib/pcart-launch-coordinator-p9-2.ts");
const PANEL = read("src/components/cartel/PcartLaunchDayCoordinatorPanel.tsx");
const FNS = read("src/lib/pcart-launch-coordinator-p9.functions.ts");
const READERS = read("src/lib/pcart-launch-coordinator-p9-readers.server.ts");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const P9CODE = [P92, PANEL, FNS, READERS].join("\n");

const S1 = "0x1111111111111111111111111111111111111111", S2 = "0x2222222222222222222222222222222222222222", S3 = "0x3333333333333333333333333333333333333333";
const draft = { status: "DRAFT", txHash: null, submittedAt: null, contractAddress: null, finalityState: "NOT_APPLICABLE", artifactId: "pepecartel-token-v1", chainId: 4663, networkEnvironment: "PRODUCTION", deployerAddress: S1, deployerNonceBefore: "7", initCodeHash: pcartProductionInitCodeHash(PCART_PRODUCTION_TREASURY_SAFE), reviewFingerprint: "0xabc" };
const pf = (o: Partial<P92PreflightInput> = {}): P92PreflightInput => ({
  chain: { live: true, chainId: 4663 }, safe: { status: "READY", reasons: [], threshold: 2, nonce: 0, owners: [S3, S1, S2] }, configuredSigners: [S1, S2, S3],
  dependencies: "VERIFIED", p8a: "CURRENT", p8b: "CURRENT", attempt: draft, activeProductionAttempts: 1, uncertainClaim: false,
  deployerLive: { nonce: "7", balanceWei: "1000000000000000" }, control: { executionEnabled: false, emergencyStopEngaged: true }, sendWindowOpen: true, ...o,
});
const blocked = (o: Partial<P92PreflightInput>, key: string) => derivePreflight(pf(o)).checks.find((c) => c.key === key)?.status === "BLOCKED" && !derivePreflight(pf(o)).allPass;
const seg = (o: Partial<P92Input> = {}, pfo: Partial<P92PreflightInput> = {}) => deriveDeploymentSegment({
  attempt: draft, claimStatus: null, readinessApproved: true, preparationActive: false, permitActive: false,
  launch: { status: "LAUNCH_APPROACHING", officialContractAddress: null }, preflight: derivePreflight(pf(pfo)), planValid: false, ...o,
});

// 1-4 reuse, no duplicates
check("1", ["PcartProductionReviewPanel", "PcartWalletPreparationPanel", "PcartFinalSendReviewPanel", "PcartMainnetSendPanel", "PcartVerificationPanel", "PcartOfficialRegistrationPanel"].every((c) => new RegExp(`${c.replace("Pcart", "P[2-7]_[A-Z_]+: [\\s\\S]{0,120}<Pcart")}`).test(LC) || LC.includes(`<${c}`)) && /import \{[^}]*isAllowedPcartDeployer[^}]*\} from "@\/lib\/pcart-production-intent"/.test(P92), "existing P2–P7 components + shared P2 helpers reused");
check("2", !/create_canonical_pcart_production_draft|claim_canonical_pcart_mainnet_send|issue_canonical_pcart_execution_permit|record_canonical_pcart_mainnet_tx_hash/.test(P9CODE), "no deployment/permit/send RPC in P9 files");
check("3", !/register_canonical_pcart_official_contract|apply_canonical_pcart_production_(verification|finality)/.test(P9CODE), "no registration/verification RPC in P9 files");
check("4", !/WalletConnect|EthereumProvider|createWalletClient|window\.ethereum|wagmi|requestAccounts|eth_requestAccounts/.test(P9CODE), "no second wallet/provider stack");
// 5-6 passive load
check("5", !/eth_sendTransaction|sendTransaction|signTypedData|signMessage|personal_sign|writeContract|walletClient/.test(P9CODE), "passive load cannot prompt a wallet");
check("6", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(P9CODE) && !/\.rpc\("(?!is_platform_owner|set_canonical_pcart_launch_day_plan")/.test(FNS), "snapshot is SELECT-only");
// 7-9 controls
check("7", seg({}, { control: { executionEnabled: true, emergencyStopEngaged: true } }).panel === null && seg({}, { control: { executionEnabled: true, emergencyStopEngaged: true } }).nextAction === "Deployment locked — global controls are not in the canonical protected state", "execution switched ON blocks (canonical protected)");
check("8", seg({}, { control: { executionEnabled: false, emergencyStopEngaged: false } }).panel === null && seg({}, { control: null }).panel === null && seg({}, { sendWindowOpen: false }).panel === null && seg({}, { sendWindowOpen: false }).nextAction === "Deployment locked — launch send window is not open", "emergency stop released / missing control / closed window blocks");
const locked = derivePreflight(pf({ sendWindowOpen: null }));
check("9", locked.checks.length >= 18 && locked.allPass && !locked.sendGateOpen && locked.controlBlockers.length === 1, "read-only preflight evaluates fully while the send window is closed");
// 10-21 preflight blockers
check("10", blocked({ chain: { live: true, chainId: 1 } }, "CHAIN") && blocked({ chain: { live: false, chainId: 4663 } }, "CHAIN"), "wrong / non-live chain blocks");
check("11", derivePreflight(pf()).checks.find((c) => c.key === "WALLET")?.status === "AT_SEND_STEP" && /WRONG_ACCOUNT/.test(read("src/components/cartel/PcartMainnetSendPanel.tsx")), "wallet binding enforced by existing P5 send step (WRONG_ACCOUNT)");
check("12", blocked({ attempt: { ...draft, deployerAddress: "0x4444444444444444444444444444444444444444" } }, "DEPLOYER_SIGNER"), "deployer must be canonical signer");
check("13", blocked({ safe: { ...pf().safe, owners: [S1, S2, "0x5555555555555555555555555555555555555555"] } }, "SAFE_OWNERS") && blocked({ safe: { ...pf().safe, threshold: 1 } }, "SAFE_THRESHOLD"), "Safe owner / threshold mismatch blocks");
check("14", blocked({ safe: { ...pf().safe, nonce: null } }, "SAFE_NONCE"), "unreadable Safe nonce blocks");
check("15", blocked({ deployerLive: { nonce: "7", balanceWei: "0" } }, "BALANCE") && blocked({ deployerLive: { nonce: "7", balanceWei: null } }, "BALANCE") && /INSUFFICIENT_BALANCE/.test(read("src/components/cartel/PcartMainnetSendPanel.tsx")), "zero/unreadable balance blocks; exact max-cost rule stays in P4/P5");
check("16", blocked({ attempt: { ...draft, initCodeHash: "0x" + "00".repeat(32) } }, "ARTIFACT") && blocked({ attempt: { ...draft, artifactId: "other" } }, "ARTIFACT") && blocked({ attempt: { ...draft, reviewFingerprint: null } }, "REVIEW"), "artifact / fingerprint mismatch blocks");
check("17", blocked({ dependencies: "BLOCKED" }, "DEPS") && blocked({ dependencies: "UNAVAILABLE" }, "DEPS"), "dependency hash mismatch blocks");
check("18", blocked({ p8a: "MANIFEST_MISMATCH" }, "P8A") && blocked({ p8a: "REVOKED" }, "P8A") && seg({}, { p8a: "MISSING" }).panel === null, "stale P8A blocks live preparation");
check("19", blocked({ p8b: "SUPERSEDED" }, "P8B") && seg({}, { p8b: "MANIFEST_MISMATCH" }).panel === null, "stale P8B blocks live preparation");
check("20", blocked({ deployerLive: { nonce: "8", balanceWei: "1" } }, "NONCE") && blocked({ deployerLive: { nonce: null, balanceWei: "1" } }, "NONCE"), "nonce change blocks");
check("21", blocked({ deployerLive: { nonce: "8", balanceWei: "1" } }, "PREDICTED") && predictPcartProductionAddress(S1, 7n) !== predictPcartProductionAddress(S1, 8n), "predicted address mismatch blocks");
// 22-25 submitted / uncertain
const sub = { ...draft, status: "SUBMITTED", txHash: "0x" + "ab".repeat(32), submittedAt: "2026-10-25T00:00:00Z" };
check("22", !["P2_REVIEW", "P3_WALLET", "P4_FINAL_REVIEW", "P5_SEND"].includes(String(seg({ attempt: sub }).panel)) && seg({ attempt: sub, preflight: null }).state === "DEPLOY_SUBMITTED", "tx hash removes deploy action (even without live snapshot)");
check("23", seg({ attempt: { ...draft, txHash: "0x" + "cd".repeat(32) } }).state === "DEPLOY_UNCERTAIN" && blocked({ activeProductionAttempts: 2 }, "NO_DUPLICATE") && blocked({ attempt: { ...draft, txHash: "0x1" } }, "NO_TX"), "submitted deployment cannot be duplicated");
check("24", seg({ claimStatus: "AMBIGUOUS" }).state === "DEPLOY_UNCERTAIN" && seg({ claimStatus: "CLAIMED", preflight: null }).state === "DEPLOY_UNCERTAIN" && /never resend/i.test(seg({ claimStatus: "AMBIGUOUS" }).nextAction) && blocked({ uncertainClaim: true }, "NO_UNCERTAIN"), "uncertain tx routes to existing recovery, never retried");
check("25", seg({ claimStatus: "CLAIMED" }).state !== "DEPLOY_FAILED" && /mark_canonical_pcart_send_ambiguous/.test(read("src/components/cartel/PcartMainnetSendPanel.tsx")), "wallet close alone never marks failed (existing AMBIGUOUS path)");
// 26-30 P6/P7
const V = read("src/components/cartel/PcartVerificationPanel.tsx");
check("26", /Runtime bytecode/.test(V) && /Token name \/ symbol \/ decimals \/ supply/.test(V) && seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: "PENDING" } }).state === "READY_FOR_FINALIZATION" && seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: null } }).state === "DEPLOY_CONFIRMED", "P6 finality + bytecode/token checks required before registration");
check("27", /Predicted contract address/.test(V) && /CREATE_ADDRESS_MISMATCH/.test(read("src/lib/pcart-production-register.functions.ts")), "P6/P7 predicted == actual enforced by existing code");
check("28", seg({ attempt: sub }).panel !== "P7_REGISTER" && seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: "PENDING" } }).panel !== "P7_REGISTER" && seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: "FINALIZED", contractAddress: S2 } }).panel === "P7_REGISTER", "P7 only after P6 finalized");
check("29", /registerCanonicalPcartOfficialContract/.test(read("src/components/cartel/PcartOfficialRegistrationPanel.tsx")) && !/registerFn|register_canonical/.test(PANEL), "P7 remains the existing explicit canonical action");
const reg = seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: "FINALIZED", contractAddress: S2 }, launch: { status: "OFFICIAL_CONTRACT_REGISTERED", officialContractAddress: S2 } });
check("30", reg.state === "OFFICIAL_CONTRACT_REGISTERED" && reg.panel === null && seg({ attempt: { ...sub, status: "CONFIRMED", finalityState: "FINALIZED", contractAddress: S3 }, launch: { status: "x", officialContractAddress: S2 } }).blockers.includes("OFFICIAL_BINDING_CONFLICT"), "registration cannot be duplicated or replaced");
// 31-33
const all = [seg(), seg({ preparationActive: true }), seg({ preparationActive: true, permitActive: true }), seg({ attempt: null }), seg({ attempt: sub }), reg, seg({ preflight: null }), seg({ readinessApproved: false })];
check("31", all.every((d) => P9_2_STATES.includes(d.state) && typeof d.nextAction === "string" && d.nextAction.length > 0) && seg().panel === "P3_WALLET" && seg({ preparationActive: true }).panel === "P4_FINAL_REVIEW" && seg({ preparationActive: true, permitActive: true }).panel === "P5_SEND" && seg({ attempt: null }).panel === "P2_REVIEW" && /panels\?\.\[seg\.panel\]/.test(PANEL), "exactly one state / action / mounted panel");
check("32", reg.nextAction === "Official PCART deployed and registered. Next: set/confirm the promotion and auction plan." && seg({ attempt: reg ? { ...sub, status: "CONFIRMED", finalityState: "FINALIZED", contractAddress: S2 } : null, launch: { status: "x", officialContractAddress: S2 }, planValid: true }).nextAction.includes("pre-auction Safe transaction"), "completion hands off to promotion / pre-auction");
check("33", !/createAuction|initializeDistribution|startAuction|buildPreAuctionSafeTx/.test(P9CODE), "P9.2 does not create/start the auction");
check("34", !/migrate\(|sweepUnsoldTokens|buildSweepSafeTx|buildPublicMigrateCall/.test(P9CODE), "no migrate/sweep logic");
check("35", !/execution_enabled\s*=(?!=)|"execution_enabled":|set_launch_chain_production_execution|engage_launch_chain_production_emergency_stop|release_launch_chain_production_emergency_stop/.test(P9CODE), "no execution-control mutation");
check("36", !/emergency_stop_engaged\s*[:=]\s*false/.test(P9CODE), "no emergency-stop mutation");
check("37", !/launch_events|launch_notification_deliveries|sendMessage|telegram/i.test(P9CODE), "no notification surface");
const newMigs = readdirSync("supabase/migrations").filter((f) => f > "20261007170000");
check("38", newMigs.length === 1 && /P9\.2: bind the EXISTING canonical PCART execution permit/.test(read(`supabase/migrations/${newMigs[0]}`)), "only the P9.2 permit-binding migration added");
check("39", /CANONICAL_PCART_PROTECTED/.test(read("src/lib/chain-mainnet-canary.functions.ts")), "canary remains CANONICAL_PCART_PROTECTED");
check("40", (LC.match(/<PcartMainnetSendPanel/g) ?? []).length === 1 && (LC.match(/<PcartOfficialRegistrationPanel/g) ?? []).length === 1 && (LC.match(/<PcartVerificationPanel/g) ?? []).length === 1, "each P5/P6/P7 panel mounted in one place only");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
