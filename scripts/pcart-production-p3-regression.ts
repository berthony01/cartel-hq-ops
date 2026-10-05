/**
 * PCART P3 — wallet-ready preparation regression (deterministic; no network,
 * no real wallet, no DB writes). Exercises pure gates, a mock EIP-1193 bound
 * provider, and inspects the applied migration + P3 source files.
 */
import { readFileSync, readdirSync } from "node:fs";

import { evaluatePcartWalletBinding, PCART_MAINNET_CHAIN_HEX } from "../src/lib/pcart-production-wallet";
import { isPcartPreparationActive, PCART_PREPARATION_MAX_TTL_MS } from "../src/lib/pcart-production-preparation";
import { pcartMainnetSummary } from "../src/lib/pcart-launch-readiness";
import { predictPcartProductionAddress } from "../src/lib/pcart-production-intent";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, label: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`); };
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");

const MIG_FILE = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.issue_canonical_pcart_production_presign_authorization")).sort().at(-1)!;
const MIG = read(`supabase/migrations/${MIG_FILE}`);
const ISSUE = MIG.slice(MIG.indexOf("FUNCTION public.issue_canonical_pcart_production_presign_authorization"), MIG.indexOf("FUNCTION public.cancel_canonical_pcart_production_presign_authorization"));
const CANCEL = MIG.slice(MIG.indexOf("FUNCTION public.cancel_canonical_pcart_production_presign_authorization"));
const WALLET = read("src/lib/pcart-production-wallet.ts");
const FNS = read("src/lib/pcart-production-preparation.functions.ts");
const CLIENT = read("src/lib/pcart-production-preparation.ts");
const PANEL = read("src/components/cartel/PcartWalletPreparationPanel.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const SUMMARY = read("src/components/cartel/PcartReviewLaunchSummary.tsx");
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");
const P3_FILES = { WALLET, FNS, CLIENT, PANEL, MIG };

const DEP = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const draft = { deployer: DEP, nonce: 1n };
const ev = (o: Partial<{ account: string; chainId: number | null; latestNonce: bigint | null; pendingNonce: bigint | null }>) => ({
  account: DEP, chainId: 4663, latestNonce: 1n, pendingNonce: 1n, balanceWei: 10n ** 16n, ...o,
});

// 1 owner-only
check("1a", /auth\.uid\(\) IS NULL OR NOT public\.is_platform_owner\(auth\.uid\(\)\)/.test(ISSUE), "issue RPC is owner-only");
check("1b", /auth\.uid\(\) IS NULL OR NOT public\.is_platform_owner\(auth\.uid\(\)\)/.test(CANCEL), "cancel RPC is owner-only");
check("1c", /REVOKE ALL ON FUNCTION public\.issue_canonical_pcart_production_presign_authorization[^;]*FROM PUBLIC, anon/.test(MIG) &&
  /USING \(public\.is_platform_owner\(auth\.uid\(\)\)\)/.test(MIG) && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/.test(MIG),
  "anon revoked; table readable only by owner; no direct writes for signed-in users");
check("1d", /is_platform_owner/.test(FNS), "server check verifies platform owner");
// 2 canonical PCART DRAFT on PRODUCTION/4663
check("2a", /private\.is_canonical_pcart_launch\(d\.launch_id\)/.test(ISSUE) && /d\.chain_id IS DISTINCT FROM 4663 OR d\.network_environment IS DISTINCT FROM 'PRODUCTION'/.test(ISSUE) &&
  /d\.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'/.test(ISSUE), "only canonical PCART PRODUCTION/4663 artifact accepted");
check("2b", /d\.status IS DISTINCT FROM 'DRAFT' OR d\.tx_hash IS NOT NULL OR d\.submitted_at IS NOT NULL OR d\.contract_address IS NOT NULL/.test(ISSUE), "only unsent DRAFT");
check("2c", /token_name IS DISTINCT FROM 'PEPECARTEL'/.test(ISSUE) && /token_decimals IS DISTINCT FROM 18/.test(ISSUE) && /token_total_supply IS DISTINCT FROM c_supply/.test(ISSUE), "frozen token intent enforced");
// 3 exact saved evidence
check("3a", /lower\(d\.token_recipient\) IS DISTINCT FROM c_safe/.test(ISSUE) && /lower\(a\.safe_address\) IS DISTINCT FROM c_safe/.test(ISSUE), "Safe = draft recipient = approval Safe");
check("3b", /v_wallet IS DISTINCT FROM lower\(d\.deployer_address\)/.test(ISSUE), "wallet must equal saved deployer");
check("3c", /_observed_latest_nonce IS DISTINCT FROM d\.deployer_nonce_before\s*OR _observed_pending_nonce IS DISTINCT FROM d\.deployer_nonce_before/.test(ISSUE), "latest and pending nonce must equal saved nonce");
check("3d", /lower\(d\.init_code_hash\) IS DISTINCT FROM c_init_hash/.test(ISSUE) && /lower\(d\.review_fingerprint\) IS DISTINCT FROM v_expected_fp/.test(ISSUE), "init hash + recomputed review fingerprint required");
check("3e", /a\.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint'/.test(ISSUE), "readiness fingerprint must still match fresh evidence");
check("3f", /String\(d\.review_fingerprint[^)]*\)\.toLowerCase\(\) !== expectedFp/.test(FNS) && /String\(d\.init_code_hash[^)]*\)\.toLowerCase\(\) !== initCodeHash/.test(FNS), "server revalidation recomputes hash + fingerprint");
// 4 signers
check("4a", /lower\(d\.deployer_address\) = c_safe/.test(ISSUE) && /NOT IN \(lower\(s\.signer_1\), lower\(s\.signer_2\), lower\(s\.signer_3\)\)/.test(ISSUE) && /s\.threshold IS DISTINCT FROM 2/.test(ISSUE), "deployer one of 3 signers, never Safe");
// 5 / 17 locked
check("5a", /k\.execution_enabled IS DISTINCT FROM false OR k\.emergency_stop_engaged IS DISTINCT FROM true/.test(ISSUE), "RPC requires execution disabled + emergency stop engaged");
check("5b", /execution_locked !== true/.test(FNS), "server check requires locked execution");
check("17", !/execution_enabled\s*=\s*true|emergency_stop_engaged\s*=\s*false|UPDATE public\.launch_chain_production_execution_controls|UPDATE public\.launch_chain_deployments|UPDATE public\.launches/i.test(MIG) &&
  !/execution_enabled:\s*true|emergency_stop_engaged:\s*false/.test(FNS + PANEL + CLIENT), "no path changes execution control, draft or launch");
// 6 binding gate
check("6a", evaluatePcartWalletBinding(ev({}), draft).ok, "exact deployer / 4663 / nonce 1 accepted");
check("6b", (evaluatePcartWalletBinding(ev({ account: "0x1111111111111111111111111111111111111111" }), draft) as any).reason === "WRONG_ACCOUNT", "wrong account fails");
check("6c", (evaluatePcartWalletBinding(ev({ chainId: 46630 }), draft) as any).reason === "WRONG_CHAIN", "wrong chain fails");
check("6d", (evaluatePcartWalletBinding(ev({ latestNonce: 2n, pendingNonce: 2n }), draft) as any).reason === "NONCE_CHANGED", "nonce mismatch fails");
check("6e", (evaluatePcartWalletBinding(ev({ pendingNonce: 2n }), draft) as any).reason === "NONCE_PENDING", "pending nonce mismatch fails");
check("6f", (evaluatePcartWalletBinding(null, draft) as any).reason === "NO_WALLET" && (evaluatePcartWalletBinding(ev({ latestNonce: null }), draft) as any).reason === "NONCE_UNREADABLE", "missing wallet / unreadable nonce fail closed");
check("6g", /fail\("NONCE_PENDING"\)/.test(FNS) && /fail\("NONCE_CHANGED"\)/.test(FNS) && /fail\("WRONG_ACCOUNT"\)/.test(FNS) && /fail\("CHAIN_MISMATCH"\)/.test(FNS), "server revalidation also fails closed");
// 7 code checks
check("7", /fail\("PREDICTED_ADDRESS_HAS_CODE"\)/.test(FNS) && /fail\("SAFE_HAS_NO_CODE"\)/.test(FNS) && /predictPcartProductionAddress\(deployer, savedNonce\)/.test(FNS), "predicted CREATE address must be empty; Safe must have code");
check("7b", predictPcartProductionAddress(DEP, 1n) === predictPcartProductionAddress(DEP.toUpperCase().replace("0X", "0x"), 1n), "prediction deterministic from deployer + saved nonce");
// 8 TTL
check("8a", /c_ttl constant interval := interval '90 seconds'/.test(ISSUE) && /expires_at <= issued_at \+ interval '90 seconds'/.test(MIG), "authorization lifetime capped at 90s (RPC + table CHECK)");
check("8b", PCART_PREPARATION_MAX_TTL_MS === 90_000, "client cap is 90s");
// 9 idempotent / collisions
check("9a", /WHERE deployment_id = d\.id AND client_request_id = v_request/.test(ISSUE) && /RETURN v_row;/.test(ISSUE) && /UNIQUE \(deployment_id, client_request_id\)/.test(MIG), "identical request replays the same row");
check("9b", /A wallet preparation is already active for this draft/.test(ISSUE) && /Preparation request conflict/.test(ISSUE), "collisions refused");
check("9c", /FOR UPDATE/.test(ISSUE), "issue serializes on the draft row");
// 10 cancel only touches authorization
check("10a", /UPDATE public\.pcart_production_preparation_authorizations\s+SET cancelled_at = now\(\), cancelled_by = auth\.uid\(\)/.test(CANCEL) && !/launch_chain_deployments/.test(CANCEL), "cancel updates only the authorization");
check("10b", /cannot be deleted/.test(MIG) && /immutable except one cancellation/.test(MIG), "authorization immutable except one cancel; never deleted");
// 11 expiry
const t0 = Date.parse("2026-10-05T10:00:00Z");
const auth = { issued_at: new Date(t0).toISOString(), expires_at: new Date(t0 + 90_000).toISOString(), cancelled_at: null };
check("11a", isPcartPreparationActive(auth, t0 + 1000) && !isPcartPreparationActive(auth, t0 + 90_000), "expired authorization is not ready evidence");
check("11b", !isPcartPreparationActive({ ...auth, cancelled_at: new Date(t0).toISOString() }, t0 + 1000), "cancelled authorization is not ready evidence");
check("11c", !isPcartPreparationActive({ ...auth, expires_at: new Date(t0 + 120_000).toISOString() }, t0 + 1000), "over-long authorization rejected as evidence");

// 12/13/14 wallet binding — mock EIP-1193 provider
const calls: string[] = [];
const mock = {
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [DEP];
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_getBalance") return "0x2386f26fc10000";
    if (method === "wallet_switchEthereumChain") return null;
    throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
  },
};
(globalThis as any).window = { ethereum: mock };
const W = await import("../src/lib/pcart-production-wallet");
const r = await W.connectPcartInjected();
const evidence = await W.readPcartWalletEvidence();
check("13a", r.ok && r.kind === "injected" && evidence?.chainId === 4663 && evidence.latestNonce === 1n && evidence.pendingNonce === 1n && evidence.balanceWei === 10n ** 16n,
  "desktop injected path reads account/chain/nonce/balance from the bound provider");
check("13b", W.evaluatePcartWalletBinding(evidence, draft).ok, "desktop bound evidence passes the gate");
check("13c", calls.every((m) => ["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_getTransactionCount", "eth_getBalance"].includes(m)), "only read methods were requested");
await W.disconnectPcartWallet();
check("13d", W.getPcartBoundWallet() === null && (await W.readPcartWalletEvidence()) === null, "disconnect clears the bound provider");
check("12a", /resetAppKitConnection\(\)/.test(WALLET) && /openAppKitConnect\(PCART_CHOOSER_TIMEOUT_MS\)/.test(WALLET) && /bound = \{ provider, account, kind: "chooser" \}/.test(WALLET) &&
  /const provider = outcome\.provider/.test(WALLET), "mobile AppKit path binds the chooser's own provider after proven teardown");
check("12b", /subscribeAppKitAccount/.test(WALLET) && /clearLocal\(\)/.test(WALLET), "AppKit account change invalidates the binding");
check("12c", /const p = b\.provider;/.test(WALLET) && !/getActiveProvider|getLauncherProvider|setLauncherProvider/.test(strip(WALLET)), "all reads use the module's own bound provider, never generic providers");
check("14", /export async function chooseAnotherPcartWallet[\s\S]*?await disconnectPcartWallet\(\);\s*return connectPcartChooser\(\);/.test(WALLET) &&
  /if \(!tornDown\)/.test(WALLET), "choose another wallet tears down stale state before reopening");
check("14b", PCART_MAINNET_CHAIN_HEX === "0x1237" && /onClick=\{\(\) => connect\(async \(\) => \(\{ ok: await requestPcartMainnetSwitch\(\)/.test(PANEL) && !/useEffect\([^)]*connectPcart/.test(PANEL),
  "network switch and connect only on explicit click; no auto-connect");

// 15 forbidden primitives
const FORBIDDEN = /eth_sendTransaction|wallet_sendTransaction|sendTransaction|writeContract|signTransaction|signTypedData|personal_sign|eth_sign\b|sendRawTransaction|send_window_issuance|authorizeMainnetSendWindow|canary_permit[^s]|armCanary|arm_launch|persistMainnetDeploymentTxHash|register_verified_launch_contract|notify_launch_watchers|claimMainnetDeploymentHandoff|sendClaimedMainnetDeployment/;
for (const [k, v] of Object.entries(P3_FILES)) {
  const body = k === "MIG" ? v.replace(/--.*$/gm, "") : strip(v);
  const hits = body.match(FORBIDDEN);
  // migration may READ the send-window/permit tables to refuse; only inserts would matter
  const ok = k === "MIG" ? !/INSERT INTO public\.launch_chain_production_(send_window_issuances|canary_permits|presign_authorizations)/.test(body) && !/eth_send|sign/i.test(body.replace(/signer|signers|assign|design/gi, "")) : !hits;
  check(`15-${k}`, ok, `${k} contains no send/sign/window/arming/registration primitive${hits && k !== "MIG" ? ` (found ${hits[0]})` : ""}`);
}
check("15b", !/>\s*(Send|Deploy|Launch)( token| now| PCART)?\s*</.test(PANEL), "no Send/Deploy/Launch button in P3 panel");
// 16 generic canary
check("16", /return attemptFail\("CANONICAL_PCART_PROTECTED"\)/.test(CANARY), "generic canary still CANONICAL_PCART_PROTECTED");
// 18 summary
check("18a", pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true }) === "Reviewed draft saved — wallet preparation next" &&
  pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true, walletReady: true }) === "Wallet ready — mainnet send locked" &&
  pcartMainnetSummary({ approved: true, executionLocked: false, draftSaved: true, walletReady: true }) === "Execution control not locked — review required",
  "Mainnet summary reflects draft / wallet-ready / unlocked state");
check("18b", /walletReady: isPcartPreparationActive\(pcartPreparationQuery\.data, Date\.now\(\)\)/.test(LC) && /<PcartWalletPreparationPanel attempt=\{pcartUnsentDraft\} \/>/.test(LC), "Launch Control wires panel + summary to authoritative state");
check("18c", !/onClick|onLaunch/.test(SUMMARY.slice(SUMMARY.indexOf("Launch unavailable") - 400)) || /disabled/.test(SUMMARY), "final Launch button stays disabled");

console.log(`\npcart-production-p3: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
