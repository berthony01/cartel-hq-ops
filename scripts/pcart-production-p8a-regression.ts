/** PCART P8A — auction & liquidity plan regression (deterministic; no network, no DB writes). */
import { readFileSync, readdirSync } from "node:fs";
import { decodeAbiParameters } from "viem";
import {
  assertTokenAddress, auctionEarliestStart, auctionEndFor, buildAuctionCreationIntent, derivePhase, encodeLpAllocationSchedule, LP_RATE_DENOMINATOR, lpCurrencyForRaise, validateAuctionSchedule, buildPermanentLpCustodyIntent, buildPostAuctionLiquidityIntent,
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
check("1d", !m.whitelist && !m.presale && !m.extension, "no whitelist/presale/extension");
check("1e", m.version === "pcart-auction-liquidity-p8a-v2" && m.rehearsalMode === "FORKED_MAINNET", "manifest v2 exact, FORKED_MAINNET");
check("1f", m.initialLiquidityReserveIsMaximum === true && m.unusedInitialReserveDestination === "TREASURY_SAFE", "200M is a maximum; unused stays with Treasury");
// 2-3 math
check("2", throws(() => computeLiquiditySplit(5 as any)) && computeLiquiditySplit(eth(20n)).liquidityWei === eth(14n), "bigint wei only");
const b = (t: string) => computeLiquiditySplit(ethToWei(t));
check("3a", b("0").refund && !b("0").pool && b("0").liquidityWei === 0n && b("0").treasuryWei === 0n, "0 ETH refund");
check("3b", b("4.99").refund && b("4.99").liquidityWei === 0n, "4.99 refund");
const ex: [string, string, string][] = [["5","4","1"],["10","8","2"],["15","11","4"],["20","14","6"],["30","20","10"],["50","30","20"],["75","42.5","32.5"],["100","55","45"]];
for (const [r, lp, tr] of ex) check(`3c-${r}`, b(r).liquidityWei === ethToWei(lp) && b(r).treasuryWei === ethToWei(tr), `${r} ETH => ${lp} LP / ${tr} Treasury`);
const tranche = (lo: string, hi: string) => lpCurrencyForRaise(ethToWei(hi)) - lpCurrencyForRaise(ethToWei(lo));
check("3d", tranche("0", "10") === eth(8n), "first 10 ETH => 80% LP");
check("3e", tranche("10", "30") === eth(12n), "10-30 ETH tranche => 60% LP");
check("3f", tranche("30", "130") === eth(50n), ">30 ETH tranche => 50% LP");
const big = b("1000000.123456789012345678");
check("3g", big.liquidityWei + big.treasuryWei === ethToWei("1000000.123456789012345678"), "large raise conserved");
const sch = m.lpAllocationSchedule;
check("3h", sch.length === 3 && sch[0].lowerThresholdWei === 0n && sch[0].rateMps === 8_000_000 && sch[1].lowerThresholdWei === eth(10n) && sch[1].rateMps === 6_000_000 && sch[2].lowerThresholdWei === eth(30n) && sch[2].rateMps === 5_000_000 && LP_RATE_DENOMINATOR === 10_000_000, "native v3.3.0 brackets (mps)");
const [dec] = decodeAbiParameters([{ type: "tuple[]", components: [{ name: "lowerThreshold", type: "uint128" }, { name: "rate", type: "uint24" }] }], encodeLpAllocationSchedule()) as any;
check("3i", dec.length === 3 && dec[1].lowerThreshold === eth(10n) && dec[2].rate === 5_000_000, "schedule ABI-encodes as LiquidityAllocationBracket[]");
check("3j", lpCurrencyForRaise(7n) === 5n, "floor mulDiv rounding like LBPStrategy");
check("3k", !/liquidityBrackets|durationHours|parseFloat|Math\.(round|floor)/.test(read("src/lib/pcart-auction-liquidity-plan.ts")), "no v1 brackets / float math");
// timeline
const T = m.timeline, D = 86_400_000, P0 = Date.UTC(2026, 10, 1);
check("T1", T.promotionMinDays === 21 && T.promotionExtendable && T.noFundsDuringPromotion, "21-day min promotion, extendable, no funds");
check("T2", T.auctionDurationDays === 7 && T.auctionStartConfigurable && T.ownerConfirmationRequiredBeforeAuctionStart && !T.autoStartAfterPromotion && !T.auctionEndExtension, "7-day auction, configurable start, owner confirm, no auto-start, no extension");
check("T3", auctionEndFor(P0) === P0 + 7 * D && auctionEarliestStart(P0) === P0 + 21 * D, "end = start + 7d; earliest = promo + 21d");
check("T4", validateAuctionSchedule({ promotionStartMs: P0, auctionStartMs: P0 + 21 * D - 1, ownerConfirmed: true }).ok === false && validateAuctionSchedule({ promotionStartMs: P0, auctionStartMs: P0 + 21 * D, ownerConfirmed: false }).ok === false && validateAuctionSchedule({ promotionStartMs: P0, auctionStartMs: P0 + 60 * D, ownerConfirmed: true }).ok === true, "fail closed <21d or unconfirmed; extended promotion ok");
check("T5", derivePhase({ nowMs: P0 + 400 * D, confirmedAuctionStartMs: null }) === "PROMOTION" && derivePhase({ nowMs: P0, confirmedAuctionStartMs: P0 + D }) === "AUCTION_SCHEDULED" && derivePhase({ nowMs: P0 + 2 * D, confirmedAuctionStartMs: P0 + D }) === "AUCTION_LIVE" && derivePhase({ nowMs: P0 + 8 * D, confirmedAuctionStartMs: P0 + D }) === "AUCTION_ENDED", "phases; no automatic start after 21 days");
const tp = m.treasuryPolicy, fc = m.founderCompensationPolicy;
check("T6", Object.values(tp.budgetBps).reduce((a, x) => a + x, 0) === 10_000 && tp.onChainSeparateWallets === false && tp.approval === "TREASURY_SAFE_2_OF_3", "Treasury categories 30/25/15/15/15, accounting only");
check("T7", fc.kind === "POST_RAISE_TREASURY_EXPENSE" && fc.capBpsOfTreasury === 1_500 && fc.disclosed && fc.approval === "TREASURY_SAFE_2_OF_3" && !fc.automaticBidderSkim && !fc.hardWiredInAuctionProceeds, "founder comp capped/disclosed/2-of-3, no skim");
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
const MFS = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.record_pcart_auction_liquidity_plan_review")).sort();
const SQL = read(`supabase/migrations/${MFS[0]}`);
const SQL2 = read(`supabase/migrations/${MFS.at(-1)!}`);
check("15", /is_platform_owner\(auth\.uid\(\)\)/.test(SQL) && /REVOKE ALL[^;]+FROM PUBLIC, anon/.test(SQL) && /is_canonical_pcart_launch/.test(SQL) && /FOR SELECT TO authenticated\s+USING \(public\.is_platform_owner/.test(SQL) && !/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/.test(SQL), "owner-only RPC + read, no direct writes");
const RPC = SQL2.slice(SQL2.indexOf("FUNCTION public.record_pcart"));
check("16", !/UPDATE public\.(launches|launch_chain_deployments|launch_chain_production_execution_controls)/i.test(RPC) && !/INSERT INTO public\.(launches|launch_chain_deployments|launch_contract_registration_events|pcart_production_send_claims)/i.test(RPC) && /immutable/.test(SQL) && /status' IS DISTINCT FROM 'MATCH'/.test(SQL), "review alters no launch/deployment/contract state; immutable; mainnet MATCH required");
check("16b", !/pepecartel-token-v1/.test(SQL) && !/pepecartel-token-v1/.test(SQL2), "migration outside PCART send-path allowlist scope");
check("15b", MFS.length >= 2 && /is_platform_owner\(auth\.uid\(\)\)/.test(RPC) && /REVOKE ALL[^;]+FROM PUBLIC, anon/.test(SQL2) && /_manifest_version IS DISTINCT FROM 'pcart-auction-liquidity-p8a-v2'/.test(RPC) && /status' IS DISTINCT FROM 'MATCH'/.test(RPC) && !/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/.test(SQL2), "v2 RPC owner-only, only v2 accepted, MATCH required");
const PANEL = read(FILES[3]);
check("24", /latest\.manifest_version === P8A_MANIFEST_VERSION/.test(PANEL) && /latest\.manifest_fingerprint === s\?\.manifestFingerprint/.test(PANEL) && /manifest_version/.test(read(FILES[2])), "v1 review cannot satisfy v2");
check("23", /First 10 ETH/.test(PANEL) && /10–30 ETH slice/.test(PANEL) && /Above 30 ETH/.test(PANEL) && /ex\(30n\)/.test(PANEL) && /ex\(50n\)/.test(PANEL) && /Promotion runway/.test(PANEL) && /does not auto-start/.test(PANEL) && /never an automatic cut/.test(PANEL) && /up to \$\{formatPcart/.test(PANEL), "panel shows v2 economics/timeline/treasury");
check("17", p8aSummaryText({ officialContractAddress: null, latestReviewActive: false }).includes("execution waits for official contract") && p8aSummaryText({ officialContractAddress: null, latestReviewActive: true }).includes("execution not enabled"), "summary copy");
const LC = read("src/routes/_authenticated/launch-control.tsx");
check("18", /<PcartAuctionLiquidityPlanPanel/.test(LC) && /const pcartMainnetText = pcartP7Text \?\? pcartP6Text \?\? pcartP5Text \?\? pcartMainnetBaseText;/.test(LC), "panel wired; P1-P7 summary chain unchanged");

console.log(`\nP8A: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
