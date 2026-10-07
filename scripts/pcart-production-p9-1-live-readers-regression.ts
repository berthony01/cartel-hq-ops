/** PCART P9.1 — live readers + launch-plan editor regression (deterministic; no network, no DB writes). */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  auctionReadModel, estimateAuctionBlocks, interpretChain, interpretDependencies, interpretSafe, observedMsPerBlock, validatePlanInput,
  P9_1_STOP_COPY, P9_MIN_RAISE_WEI, type P9ChainObservation, type P9SafeObservation,
} from "../src/lib/pcart-launch-coordinator-p9-live";
import { deriveCoordinatorState, type P9Snapshot } from "../src/lib/pcart-launch-coordinator-p9";
import { P8A_MAINNET_DEPENDENCIES } from "../src/lib/pcart-auction-liquidity-plan";
import { P8B_REAL_TREASURY_SAFE } from "../src/lib/pcart-auction-execution-p8b";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 17, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const F = {
  live: "src/lib/pcart-launch-coordinator-p9-live.ts",
  readers: "src/lib/pcart-launch-coordinator-p9-readers.server.ts",
  fns: "src/lib/pcart-launch-coordinator-p9.functions.ts",
  panel: "src/components/cartel/PcartLaunchDayCoordinatorPanel.tsx",
  core: "src/lib/pcart-launch-coordinator-p9.ts",
};
const ALL = Object.values(F).map(read).join("\n");
const SQL = read("supabase/migrations/20261007164806_b08013bf-213b-4c7a-809e-dbbc56f0ebf3.sql");

// 1-2
check("1", !/eth_sendTransaction|sendTransaction|sendRawTransaction|signTypedData|signMessage|signTransaction|writeContract|createWalletClient|walletClient|proposeTransaction|execTransaction|buildPreAuctionSafeTx|buildSweepSafeTx|buildPublicMigrateCall|privateKeyToAccount/.test(ALL), "no send/sign/propose/write-contract primitive in P9.1 files");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const clientDir = ["dist/client", ".output/public", "dist"].find((d) => existsSync(d));
const clientJs = clientDir ? walk(clientDir).filter((p) => p.endsWith(".js") && !p.includes("server")).map(read).join("\n") : "";
check("2", !/ROBINHOOD_MAINNET_RPC_URL\s*[:=]\s*["']https?:/.test(ALL) && /process\.env\[ROBINHOOD_MAINNET_MANAGED_RPC_ENV\]/.test(read(F.readers)) && F.readers.endsWith(".server.ts") && /await import\("@\/lib\/pcart-launch-coordinator-p9-readers\.server"\)/.test(read(F.fns)) && !/readers\.server/.test(read(F.panel)) && !/SUPABASE_SERVICE_ROLE_KEY|ROBINHOOD_MAINNET_RPC_URL/.test(clientJs.slice(0, 50_000_000)), `RPC URL/secret only read server-side (server-only module, dynamic import; client bundle scanned: ${clientDir ?? "none built"})`);

// 3-6 chain
const okObs = (o: Partial<Extract<P9ChainObservation, { ok: true }>> = {}): P9ChainObservation => ({ ok: true, chainId: 4663, latestBlock: 82_700_000n, latestTimestampSec: NOW / 1000 - 1, sampleBlock: 82_698_000n, sampleTimestampSec: NOW / 1000 - 1 - 205.54, gasPriceWei: 10_000_000n, capturedAt: iso(NOW), ...o });
check("3", interpretChain(okObs({ chainId: 1 })).status === "WRONG_CHAIN" && estimateAuctionBlocks(iso(NOW + 30 * DAY), interpretChain(okObs({ chainId: 1 }))).available === false, "chain mismatch fails closed");
const un = interpretChain({ ok: false, error: "TimeoutError", capturedAt: iso(NOW) });
check("4", un.status === "UNAVAILABLE" && !("latestBlock" in un), "unavailable RPC → typed UNAVAILABLE, no fabricated values");
const live = interpretChain(okObs());
check("5", live.status === "LIVE" && "latestBlock" in live && live.latestBlock === "82700000" && live.latestBlockAt === iso(NOW - 1000) && live.capturedAt === iso(NOW), "latest block captured with timestamp + captured_at");
check("6", observedMsPerBlock(2000n, 205.54, 0n, 0) === 102.77 && observedMsPerBlock(10n, 5, 10n, 5) === null && observedMsPerBlock(10n, 4, 0n, 5) === null && ("msPerBlock" in live && live.msPerBlock === 102.77), "cadence calculation deterministic; degenerate samples → null");

// 7-10 Safe
const S = P8B_REAL_TREASURY_SAFE;
const safeObs = (o: Partial<P9SafeObservation> = {}): P9SafeObservation => ({ codePresent: true, codeHash: S.proxyCodeHash, version: "1.4.1", threshold: 2, owners: [...S.owners], nonce: 0, chainId: 4663, capturedAt: iso(NOW), ...o });
const signers = [...S.owners].map((x) => x.toLowerCase());
check("7", interpretSafe(safeObs(), S.address.toLowerCase(), signers).status === "READY" && interpretSafe(safeObs({ owners: [S.owners[0], S.owners[1], "0x" + "11".repeat(20)] }), S.address, signers).reasons.includes("OWNERS_NOT_PINNED_SET") && interpretSafe(safeObs(), S.address, [signers[0], signers[1], "0x" + "22".repeat(20)]).reasons.includes("OWNERS_NOT_CONFIGURED_SIGNERS") && interpretSafe(safeObs({ owners: [...S.owners, "0x" + "33".repeat(20)] }), S.address, signers).status === "BLOCKED", "Safe owner set exact match (pinned + configured) required");
check("8", interpretSafe(safeObs({ threshold: 1 }), S.address, signers).reasons.includes("THRESHOLD_NOT_2") && interpretSafe(safeObs({ threshold: 3 }), S.address, signers).status === "BLOCKED", "threshold exactly 2 required");
const R = read(F.readers);
check("9", /functionName: "nonce"/.test(R) && /readContract/.test(R) && !/writeContract|simulateContract|estimateGas|sendTransaction/.test(R) && interpretSafe(safeObs({ nonce: null }), S.address, signers).reasons.includes("NONCE_UNREADABLE"), "Safe nonce read via view call only");
const blockedSafe = { chainLive: true, safeReady: false, dependenciesVerified: true };
const base: P9Snapshot = {
  nowMs: NOW, control: { executionEnabled: false, emergencyStopEngaged: true },
  deployment: { status: "DRAFT", txHash: null, contractAddress: null, finalityState: "NOT_APPLICABLE" }, sendClaims: [],
  launch: { status: "LAUNCH_APPROACHING", officialContractAddress: null }, p8a: "CURRENT", p8b: "CURRENT", plan: null,
  observed: { preAuctionSafeTxExecuted: null, currentBlock: null, migrated: null, graduated: null, unsoldSwept: null },
};
check("10", deriveCoordinatorState({ ...base, live: blockedSafe }).blockers.includes("SAFE_NOT_READY") && interpretSafe(safeObs(), "0x" + "44".repeat(20), signers).reasons.includes("STORED_SAFE_ADDRESS_MISMATCH") && interpretSafe(null, S.address, signers).status === "UNAVAILABLE", "Safe mismatch/unavailable blocks future live readiness");

// 11-12 deps
const allMatch = Object.fromEntries(P8A_MAINNET_DEPENDENCIES.map((d) => [d.key, d.codeHash]));
check("11", interpretDependencies(allMatch).status === "VERIFIED" && P8A_MAINNET_DEPENDENCIES.length === 9 && interpretDependencies({ ...allMatch, CCA_FACTORY: "0x" + "de".repeat(32) }).items.find((i) => i.key === "CCA_FACTORY")!.status === "HASH_MISMATCH" && interpretDependencies({ ...allMatch, CCA_FACTORY: "0x" + "de".repeat(32) }).status === "BLOCKED" && /P8A_MAINNET_DEPENDENCIES/.test(read(F.live)) && !/0x4a586d925c9d59ece13ce2239ebd7dea9ee725f9d33c6667e0fd16ae8d977d80/.test(ALL), "hash mismatch reported; all 9 pinned deps reused (no cloned hashes)");
check("12", interpretDependencies({ ...allMatch, PERMIT2: null }).items.find((i) => i.key === "PERMIT2")!.status === "MISSING" && interpretDependencies({ ...allMatch, PERMIT2: undefined }).items.find((i) => i.key === "PERMIT2")!.status === "UNAVAILABLE" && interpretDependencies({ ...allMatch, PERMIT2: undefined }).status === "UNAVAILABLE", "missing / unavailable reported distinctly");

// 13-15 token + auction
check("13", deriveCoordinatorState(base).state === "AWAITING_DEPLOYMENT" && /officialToken \? await codeHash/.test(R), "official token absent handled normally (no code read)");
const na = auctionReadModel(null, null, "82700000");
check("14", na.status === "NOT_CREATED" && /auctionReadModel\(null, null, currentBlock\)/.test(read(F.fns)), "auction absent → NOT_CREATED, not an error");
const ao = auctionReadModel("0x" + "aa".repeat(20), { startBlock: 100n, endBlock: 200n, currencyRaisedWei: 6n * 10n ** 18n, graduated: null, migrated: null, unsoldSwept: null }, "150");
const ended = auctionReadModel("0x" + "aa".repeat(20), { startBlock: 100n, endBlock: 200n, currencyRaisedWei: 4n * 10n ** 18n, graduated: false, migrated: false, unsoldSwept: false }, "250");
check("15", !("amountRaisedWei" in na) && !("outcome" in na) && ao.status === "OPEN" && "outcome" in ao && ao.outcome === "UNDETERMINED" && "outcome" in ended && ended.outcome === "REFUND" && P9_MIN_RAISE_WEI === 5n * 10n ** 18n, "no fake raised/success without on-chain auction; outcome only from on-chain graduation after end; min 5 ETH");

// 16-19 plan
check("16", validatePlanInput(null, null).ok && validatePlanInput(iso(NOW), null).ok && validatePlanInput(null, iso(NOW)).ok && /promotion_start_at timestamptz,/.test(SQL), "plan dates nullable");
const P = read(F.panel);
check("17", /Clear plan/.test(P) && /promotionStartAt: null, intendedAuctionStartAt: null/.test(P) && /v == null \|\| v === "" \? null/.test(read(F.fns)), "clear plan supported end-to-end");
check("18", validatePlanInput(iso(NOW), iso(NOW + 21 * DAY - 60_000)).error === "RUNWAY_TOO_SHORT" && validatePlanInput(iso(NOW), iso(NOW + 21 * DAY)).ok && /validatePlanInput\(fromLocalInput/.test(P) && /validatePlanInput\(data\.promotionStartAt/.test(read(F.fns)) && /interval '21 days'/.test(SQL), "≥21-day validation in UI, server function and database trigger");
check("19", /CHECK \(auto_start = false\)/.test(SQL) && !/auto_start/.test(read(F.fns)) && /Nothing starts automatically/.test(P), "no auto-start");

// 20-22 estimates
const est = estimateAuctionBlocks(iso(NOW + 30 * DAY), live);
check("20", est.available && est.label === "ESTIMATED" && /ESTIMATED auction start block/.test(P), "estimated start block labelled ESTIMATED");
check("21", est.available && BigInt(est.estimatedEndBlock) - BigInt(est.estimatedStartBlock) === 5_885_000n, "estimated end = start + 5,885,000");
const stale = interpretChain(okObs({ latestTimestampSec: NOW / 1000 - 600 }));
check("22", stale.status === "STALE" && estimateAuctionBlocks(iso(NOW + 30 * DAY), stale).available === false && estimateAuctionBlocks(iso(NOW + 30 * DAY), un).available === false && !/authoritative_start_block|end_block/.test(read(F.fns).slice(read(F.fns).indexOf("savePcartP9LaunchPlan"))), "stale/unavailable chain → no estimate; save never persists authoritative blocks");

// 23-25 purity + planning independence
const CORE = read(F.core) + read(F.live);
check("23", !/from "viem"|createPublicClient|fetch\(|supabase|process\.env|Date\.now\(\)/.test(CORE), "P9 state machine + interpreters remain pure (no RPC, DB, env or clock)");
const saveFn = read(F.fns).slice(read(F.fns).indexOf("savePcartP9LaunchPlan"));
check("24", !/execution_enabled|executionEnabled/.test(saveFn) && deriveCoordinatorState(base).planningAllowed === true && !/disabled=\{[^}]*executionEnabled/.test(P), "execution OFF does not prevent planning edits");
check("25", !/emergency_stop|emergencyStop/.test(saveFn) && !/disabled=\{[^}]*emergencyStop/.test(P), "emergency stop ON does not prevent planning edits");

// 26-29 save surface
const RPC = SQL.slice(SQL.indexOf("FUNCTION public.set_canonical_pcart_launch_day_plan"), SQL.indexOf("FUNCTION public.revoke_canonical_pcart_policy_approval"));
check("26", !/launches/.test(RPC.replace(/REFERENCES public\.launches/g, "")) && !/\.from\("launches"\)\.(update|insert|upsert)/.test(saveFn), "plan save does not mutate launch lifecycle");
check("27", !/pcart_auction_(liquidity_plan|execution_rehearsal)_reviews/.test(RPC) && !/pcart_auction_/.test(saveFn), "plan save does not touch P8A/P8B reviews/economics");
const writes = RPC.match(/INSERT INTO public\.\w+/g) ?? [];
check("28", writes.length === 2 && writes[0] === "INSERT INTO public.pcart_launch_day_plans" && writes[1] === "INSERT INTO public.pcart_launch_coordinator_events" && !/\.(insert|update|upsert|delete)\(/.test(read(F.fns)), "plan save writes only plan + activity records (via RPC)");
check("29", !/launch_events|launch_notification_deliveries|telegram|sendMessage/i.test(RPC + saveFn + read(F.readers)), "no notification path");

// 31
check("31", /CANONICAL_PCART_PROTECTED/.test(read("src/lib/chain-mainnet-canary.functions.ts")) && P9_1_STOP_COPY === "No live action is enabled in P9.1." && P.includes("P9_1_STOP_COPY"), "canary canonical protection intact; P9.1 stop copy shown");

console.log(`\nP9.1: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
