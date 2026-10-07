/** PCART P8A — auction & liquidity plan regression (deterministic; no network, no DB writes). */
import { readFileSync, readdirSync } from "node:fs";
import {
  assertTokenAddress, buildAuctionCreationIntent, buildPermanentLpCustodyIntent, buildPostAuctionLiquidityIntent,
  buildSafeApprovalDepositIntent, computeLiquiditySplit, eth, ethToWei, P8A_MAINNET_DEPENDENCIES, P8A_MANIFEST,
  P8A_MOCK_FORK_TOKEN, P8A_SIM_SUCCESS, pcart, runP8aSimulation, simulateAuctionAccounting, p8aSummaryText,
} from "../src/lib/pcart-auction-liquidity-plan";
import { attestationOk, classifyAttestation, selectRehearsalMode } from "../src/lib/pcart-auction-liquidity-attest";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
const m = P8A_MANIFEST;
const SIM = { address: P8A_MOCK_FORK_TOKEN, simulation: true };
const REAL = { address: "0x" + "ab".repeat(20), simulation: false };

// 1 manifest
check("1a", m.chainId === 4663 && m.mechanism === "UNISWAP_CCA_LBP_STRATEGY" && m.quoteAsset === "NATIVE_ETH", "chain 4663, CCA/LBPStrategy, native ETH");
check("1b", m.auctionAllocation === pcart(150_000_000n) && m.initialLiquidityReserve === pcart(200_000_000n) && m.futureLiquidityReserve === pcart(150_000_000n), "150M / 200M / 150M");
check("1c", m.floorWei === eth(5n) && m.targetWei === eth(30n) && m.maxRaiseWei === null && m.targetIsGate === false, "5 ETH floor, 30 ETH target not a gate, no cap");
check("1d", m.durationHours === 96 && !m.whitelist && !m.presale && !m.extension, "~96h, no whitelist/presale/extension");
// 2-3 math
check("2", throws(() => computeLiquiditySplit(5 as any)) && computeLiquiditySplit(eth(20n)).liquidityWei === eth(18n), "bigint wei only");
const b = (t: string) => computeLiquiditySplit(ethToWei(t));
check("3a", b("0").refund && !b("0").pool && b("0").liquidityWei === 0n && b("0").treasuryWei === 0n, "0 ETH refund");
check("3b", b("4.99").refund && b("4.99").liquidityWei === 0n, "4.99 refund");
check("3c", !b("5").refund && b("5").liquidityWei === eth(5n) && b("5").treasuryWei === 0n, "5 => 100%");
check("3d", b("14.99").liquidityBps === 10_000 && b("14.99").treasuryWei === 0n, "14.99 => 100%");
check("3e", b("15").liquidityWei === ethToWei("13.5") && b("15").treasuryWei === ethToWei("1.5"), "15 => 90/10");
check("3f", b("29.99").liquidityBps === 9_000, "29.99 => 90%");
check("3g", b("30").liquidityWei === eth(24n) && b("30").treasuryWei === eth(6n), "30 => 80/20");
const big = b("1000000.123456789012345678");
check("3h", big.liquidityBps === 8_000 && big.liquidityWei + big.treasuryWei === ethToWei("1000000.123456789012345678"), "large raise conserved");
// 4 below floor
const low = simulateAuctionAccounting({ raisedWei: ethToWei("4.99"), soldTokens: pcart(10n), lpTokensUsed: 0n });
check("4", low.split.refund && low.soldTokens === 0n && low.unsoldTokens === m.auctionAllocation && throws(() => buildPostAuctionLiquidityIntent(SIM, { raisedWei: ethToWei("4.99"), soldTokens: 0n, lpTokensUsed: 0n })), "below floor => refund, no pool intent");
// 5 unsold
const acc = simulateAuctionAccounting(P8A_SIM_SUCCESS);
check("5", m.unsoldPolicy === "RETURN_TO_TREASURY_SAFE" && m.unsoldPolicyRequiresLiveReconfirmation === true && acc.unsoldDestination === "TREASURY_SAFE" && acc.unsoldTokens === pcart(30_000_000n), "unsold => Treasury Safe, re-confirm flagged");
// 6-7 reserves / totals
check("6", acc.futureReserveConsumed === 0n && m.futureLiquidityReserveInFirstLaunch === false && acc.tokensFromSafe === pcart(350_000_000n), "future 150M never consumed");
check("7", acc.invariantsOk && acc.tokensFromSafe + m.futureLiquidityReserve <= m.totalSupply && !simulateAuctionAccounting({ raisedWei: eth(10n), soldTokens: pcart(151_000_000n), lpTokensUsed: 0n }).invariantsOk, "<=1B and over-inventory rejected");
// 8-9
check("8", m.pool.version === "UNISWAP_V4" && m.pool.feePips === 2_500 && m.pool.dynamicFee === false, "v4 0.25% static");
const cust = buildPermanentLpCustodyIntent(SIM, P8A_SIM_SUCCESS);
check("9", m.lpCustody === "PERMANENT_FEES_OFF_FEESPLITTER" && (cust.params as any).positionRecipient === "0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee" && (cust.params as any).recoverable === false, "permanent fees-off FeeSplitter");
// 10-11 attestation
const all = Object.fromEntries(P8A_MAINNET_DEPENDENCIES.map((d) => [d.key, d.codeHash]));
check("10a", attestationOk(classifyAttestation(all)), "all MATCH ok");
check("10b", !attestationOk(classifyAttestation({ ...all, PERMIT2: "0x" + "11".repeat(32) })) && classifyAttestation({ ...all, PERMIT2: "0x" + "11".repeat(32) }).find((r) => r.key === "PERMIT2")!.status === "HASH_MISMATCH", "HASH_MISMATCH blocks");
check("10c", !attestationOk(classifyAttestation({ ...all, CCA_FACTORY: null })) && !attestationOk(classifyAttestation({ ...all, LBP_STRATEGY: undefined })), "MISSING/UNREADABLE block");
check("10d", !runP8aSimulation("FORKED_MAINNET", false).success.ok && runP8aSimulation("FORKED_MAINNET", false).success.intents.length === 0, "dependency failure => simulation fail-closed");
check("11", selectRehearsalMode(classifyAttestation({ CCA_FACTORY: all.CCA_FACTORY })) === "FORKED_MAINNET" && selectRehearsalMode(classifyAttestation(all)) === "TESTNET", "missing testnet => FORKED_MAINNET");
// 12-13 intents
check("12", [buildSafeApprovalDepositIntent, buildAuctionCreationIntent].every((f) =>
  throws(() => f({ address: "", simulation: false })) && throws(() => f({ address: "0x" + "0".repeat(40), simulation: false })) &&
  throws(() => f({ address: P8A_MOCK_FORK_TOKEN, simulation: false })) && throws(() => f({ address: REAL.address, simulation: true }))), "intent builders refuse missing/zero/mock-outside-simulation");
check("12b", !throws(() => assertTokenAddress(REAL)) && buildAuctionCreationIntent(REAL).executable === false, "real address accepted, intent non-executable");
const f1 = buildSafeApprovalDepositIntent(SIM).fingerprint, f2 = buildSafeApprovalDepositIntent(SIM).fingerprint;
check("13", f1 === f2 && f1 !== buildSafeApprovalDepositIntent(REAL).fingerprint && runP8aSimulation("FORKED_MAINNET", true).fingerprint === runP8aSimulation("FORKED_MAINNET", true).fingerprint, "deterministic fingerprints, token-bound");
const sim = runP8aSimulation("FORKED_MAINNET", true);
check("13b", sim.success.ok && sim.success.intents.length === 4 && sim.failure.ok && sim.failure.liquidityIntentRefused, "success + failure paths simulated");
// 14 no send primitives
const FILES = ["src/lib/pcart-auction-liquidity-plan.ts", "src/lib/pcart-auction-liquidity-attest.ts", "src/lib/pcart-auction-liquidity.functions.ts", "src/components/cartel/PcartAuctionLiquidityPlanPanel.tsx"];
const CODE = FILES.map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("14", !/eth_sendTransaction|sendTransaction|writeContract|signTypedData|signMessage|personal_sign|eth_sign|createWalletClient|useWalletClient|request\(\{|proposeTransaction|api-kit|protocol-kit|privateKey/i.test(CODE), "no send/sign/Safe-proposal primitive");
check("14b", !/>\s*(Create Auction|Approve|Deposit|Add Liquidity|Burn LP|Safe Proposal)/i.test(read(FILES[3])), "no execution buttons");
// 15-16 DB
const MF = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.record_pcart_auction_liquidity_plan_review")).sort().at(-1)!;
const SQL = read(`supabase/migrations/${MF}`);
check("15", /is_platform_owner\(auth\.uid\(\)\)/.test(SQL) && /REVOKE ALL[^;]+FROM PUBLIC, anon/.test(SQL) && /is_canonical_pcart_launch/.test(SQL) && /FOR SELECT TO authenticated\s+USING \(public\.is_platform_owner/.test(SQL) && !/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/.test(SQL), "owner-only RPC + read, no direct writes");
const RPC = SQL.slice(SQL.indexOf("FUNCTION public.record_pcart"));
check("16", !/UPDATE public\.(launches|launch_chain_deployments|launch_chain_production_execution_controls)/i.test(RPC) && !/INSERT INTO public\.(launches|launch_chain_deployments|launch_contract_registration_events|pcart_production_send_claims)/i.test(RPC) && /immutable/.test(SQL) && /status' IS DISTINCT FROM 'MATCH'/.test(SQL), "review alters no launch/deployment/contract state; immutable; mainnet MATCH required");
check("16b", !/pepecartel-token-v1/.test(SQL), "migration outside PCART send-path allowlist scope");
check("17", p8aSummaryText({ officialContractAddress: null, latestReviewActive: false }).includes("execution waits for official contract") && p8aSummaryText({ officialContractAddress: null, latestReviewActive: true }).includes("execution not enabled"), "summary copy");
const LC = read("src/routes/_authenticated/launch-control.tsx");
check("18", /<PcartAuctionLiquidityPlanPanel/.test(LC) && /const pcartMainnetText = pcartP7Text \?\? pcartP6Text \?\? pcartP5Text \?\? pcartMainnetBaseText;/.test(LC), "panel wired; P1-P7 summary chain unchanged");

console.log(`\nP8A: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
