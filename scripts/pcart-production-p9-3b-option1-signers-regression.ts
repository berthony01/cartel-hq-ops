/** P9.3B Option 1 signer policy regression (pure; no RPC, no wallet, no DB, no live signature). */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
import {
  assembleSafeSignatures, CANONICAL_OWNERS, eligibleSigners, executionGate, signingGate, validateOwnerSignature, type P93bLive,
} from "../src/lib/pcart-launch-coordinator-p9-3b";

let pass = 0, fail = 0;
const t = async (n: string, f: () => unknown | Promise<unknown>) => { try { if (!(await f())) throw new Error("false"); pass++; console.log("PASS", n); } catch (e) { fail++; console.log("FAIL", n, e); } };
const [o1, o2, o3] = CANONICAL_OWNERS as [string, string, string];
const DELEG = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const deleg = "0xef0100" + "11".repeat(20);
const live = { [o1]: "0x", [o2]: "0x", [o3]: "0x" } as Record<string, string | null>;
live[DELEG] = deleg;
const plain = CANONICAL_OWNERS.filter((o) => o !== DELEG);
const H = "0x" + "ab".repeat(32);
const sig = (b: string) => "0x" + b.repeat(64) + "1b";
const L = (eligible: readonly string[] | null): P93bLive => ({ nowMs: 0, headBlock: 1000n, msPerBlock: 100, control: { executionEnabled: false, emergencyStopEngaged: true, revision: 5 }, safeNonce: 0, staleReasons: [], uncertainTransaction: false, eligible });
const A = { status: "PREPARED", safeNonce: 0, authoritativeStartBlock: "10000000" };

await t("delegated owner is a canonical Safe owner (Safe unchanged)", () => CANONICAL_OWNERS.includes(DELEG) && CANONICAL_OWNERS.length === 3);
await t("eligible set = exactly the two plain-EOA owners, live-derived", () => { const e = eligibleSigners(live); return e.ok && e.signers.length === 2 && e.signers.every((s) => plain.includes(s)) && !e.signers.includes(DELEG); });
await t("unknown code read fails closed", () => !eligibleSigners({ ...live, [plain[0]!]: null }).ok);
await t("plain owner gaining 7702 code blocks", () => { const e = eligibleSigners({ ...live, [plain[0]!]: deleg }); return !e.ok && e.reason === "ELIGIBLE_SIGNER_SET_CHANGED"; });
await t("plain owner gaining contract code blocks", () => !eligibleSigners({ ...live, [plain[1]!]: "0x6080" }).ok);
await t("delegate removed (3 plain) fails closed until re-audit", () => !eligibleSigners({ ...live, [DELEG]: "0x" }).ok);
const el = (eligibleSigners(live) as any).signers as string[];
await t("delegated owner rejected before recovery", async () => (await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: sig("cd"), claimedSigner: DELEG, ownerCode: deleg, eligible: el })).ok === false);
await t("delegated owner rejection reason", async () => { const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: sig("cd"), claimedSigner: DELEG, ownerCode: deleg, eligible: el }); return !r.ok && r.reason === "DELEGATED_OWNER_NOT_ELIGIBLE"; });
await t("delegated owner rejected even if code read as 0x but not in eligible set", async () => { const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: sig("cd"), claimedSigner: DELEG, ownerCode: "0x", eligible: el }); return !r.ok && r.reason === "SIGNER_NOT_ELIGIBLE"; });
await t("generic contract owner rejected", async () => { const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: sig("cd"), claimedSigner: plain[0]!, ownerCode: "0x6080", eligible: el }); return !r.ok && r.reason === "CONTRACT_OWNER_NOT_SUPPORTED"; });
await t("non-owner rejected", async () => { const acc = privateKeyToAccount(generatePrivateKey()); const s = await acc.sign({ hash: H as `0x${string}` }); const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: s, claimedSigner: acc.address, ownerCode: "0x", eligible: el }); return !r.ok && r.reason === "NOT_OWNER"; });
await t("wrong hash rejected", async () => { const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: "0x" + "cd".repeat(32), signature: sig("cd"), claimedSigner: plain[0]!, ownerCode: "0x", eligible: el }); return !r.ok && r.reason === "WRONG_HASH"; });
await t("signature by a different key than claimed eligible owner rejected", async () => { const acc = privateKeyToAccount(generatePrivateKey()); const s = await acc.sign({ hash: H as `0x${string}` }); const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: s, claimedSigner: plain[0]!, ownerCode: "0x", eligible: el }); return !r.ok && r.reason === "SIGNER_MISMATCH"; });
await t("wrapped/ERC-1271 style signature rejected", async () => { const r = await validateOwnerSignature({ safeTxHash: H, expectedSafeTxHash: H, signature: "0x" + "00".repeat(100), claimedSigner: plain[0]!, ownerCode: "0x", eligible: el }); return !r.ok && r.reason === "SMART_ACCOUNT_SIGNATURE"; });
await t("one signature cannot meet threshold", () => !assembleSafeSignatures([{ signerAddress: el[0]!, signature: sig("aa") }], el).ok);
await t("duplicate signer rejected", () => { const r = assembleSafeSignatures([{ signerAddress: el[0]!, signature: sig("aa") }, { signerAddress: el[0]!, signature: sig("bb") }], el); return !r.ok && r.reason === "DUPLICATE_SIGNER"; });
await t("delegated owner cannot complete the threshold", () => { const r = assembleSafeSignatures([{ signerAddress: el[0]!, signature: sig("aa") }, { signerAddress: DELEG, signature: sig("bb") }], el); return !r.ok && r.reason === "SIGNER_NOT_ELIGIBLE"; });
await t("two eligible owners assemble in ascending order", () => { const r = assembleSafeSignatures([{ signerAddress: el[1]!, signature: sig("bb") }, { signerAddress: el[0]!, signature: sig("aa") }], el); return r.ok && r.signers[0] === el[0] && r.signatures.startsWith("0x" + "aa".repeat(64)); });
await t("signing blocked when eligible set changed", () => signingGate(A, L(null), []).includes("ELIGIBLE_SIGNER_SET_CHANGED"));
await t("signing allowed with eligible set and protected controls", () => signingGate(A, L(el), []).length === 0);
await t("stale nonce blocks", () => signingGate(A, { ...L(el), safeNonce: 1 }, []).includes("SAFE_NONCE_CHANGED"));
await t("controls unlocked blocks", () => signingGate(A, { ...L(el), control: { executionEnabled: true, emergencyStopEngaged: true, revision: 5 } }, []).includes("CONTROLS_NOT_PROTECTED"));
const usable = el.map((s, i) => ({ signerAddress: s, signature: sig(i ? "bb" : "aa"), safeTxHash: H, status: "VALID", controlRevision: 5, ownerKind: "EOA" }));
const permit = { expiresAtMs: 1e15, consumed: false, cancelled: false, controlRevision: 5 };
await t("execution allowed only with both eligible sigs + Safe validation + permit", () => executionGate({ ...A, status: "READY", executionTxHash: null }, L(el), usable, true, permit).length === 0);
await t("execution blocked if eligible owner code changes", () => executionGate({ ...A, status: "READY", executionTxHash: null }, L(null), usable, true, permit).includes("ELIGIBLE_SIGNER_SET_CHANGED"));
await t("execution blocked without Safe simulation", () => executionGate({ ...A, status: "READY", executionTxHash: null }, L(el), usable, null, permit).includes("SAFE_VALIDATION_FAILED"));
await t("execution blocked after a tx hash exists (no retry)", () => executionGate({ ...A, status: "READY", executionTxHash: H }, L(el), usable, true, permit).includes("TX_ALREADY_EXISTS"));
await t("execution blocked with only one signature", () => executionGate({ ...A, status: "READY", executionTxHash: null }, L(el), usable.slice(0, 1), true, permit).includes("SIGNATURES_INCOMPLETE"));
const fn = readFileSync("src/lib/pcart-launch-coordinator-p9-3b.functions.ts", "utf8");
await t("executor must be in live eligible set", () => fn.includes("!a.eligible.includes(data.executor)"));
await t("no Safe Transaction Service dependency", () => !/safe-transaction|tx-service|api\.safe\.global/i.test(fn + readFileSync("src/lib/pcart-p9-3b-safe-wallet.ts", "utf8")));
await t("wallet helper uses existing connector only", () => { const w = readFileSync("src/lib/pcart-p9-3b-safe-wallet.ts", "utf8"); return w.includes("@/lib/wallet-connector") && !w.includes("window.ethereum"); });
console.log(`\n${pass}/${pass + fail} passed`); if (fail) process.exit(1);
