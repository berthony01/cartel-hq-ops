# PCART-L1 Closure — Phased Plan (PLAN/AUDIT ONLY)

HEAD inspected: `476211c31d6646d7650c6ba1aab4ea9a9be3a6d8`, working tree clean. No file edited, no SQL, nothing deployed, no chain action.

## 1. Exact remaining L1 items after Phase 1

From `docs/PCART_MASTER_LAUNCH_PLAN.md` lines 133, 204, 302, 317 — five open items, unchanged by Phase 1:

| # | Open L1 item | Closable by repo-only work? |
|---|---|---|
| L1-a | Exact operational ETH gas reserve | YES — policy freeze |
| L1-b | Exact multisig implementation AND address | PARTIAL — implementation choice closable; the address requires a real Safe deployment (out of scope) |
| L1-c | Legal/comms review | PARTIAL — internal comms rules closable; external legal sign-off is an owner-side prerequisite, never fabricated |
| L1-d | Live Robinhood/Uniswap compatibility confirmation | YES as a dated, versioned, fail-closed manifest of researched addresses |
| L1-e | Fork/testnet simulation | NO as written — see section 7 (circularity) |

Frozen items (sections 2, 3, 4, 4.1, 5) are untouched by this plan.

## 2. Safe v1.4.1 L2 architecture vs current code

Consistent. `src/lib/treasury-safe-verify.ts` already pins Robinhood 4663 (`ROBINHOOD_MAINNET_CHAIN_ID`), requires exactly 3 unique non-zero owners and threshold 2, and the L1B fixtures use `VERSION` `"1.4.1"`. Choosing the v1.4.1 SafeL2 singleton + SafeProxyFactory therefore adds no new assumption.

Its own header states it is **not** cryptographic proof of a specific proxy or singleton version — that is the real gap. Stronger verification to add **before** any Safe is used (a later phase, not the repo-only pack):

1. Read the proxy's singleton/masterCopy storage slot 0 and require it to equal the canonical v1.4.1 SafeL2 singleton for 4663.
2. Compare the proxy's runtime code hash against a pinned expected SafeProxy code hash.
3. Require `VERSION()` to be readable and exactly `1.4.1` (today an unreadable VERSION still passes — check `L1B-11`).
4. Read `getModulesPaginated` and require an empty module list, and require the guard slot to be zero — a module or guard can move funds outside the 2-of-3 rule.
5. Require `nonce()` to be readable; treat every unreadable read as fail-closed.
6. Keep all of it advisory-to-the-eye but make it a hard gate for the PCART treasury recipient specifically (see section 8 PENDING list).

Only items 1–6 as an **expected-values manifest** belong in the repo-only pack now; wiring them into the verifier is a separate authorized unit.

## 3. 0.10 ETH reserve / 0.05 ETH floor policy

Reasonable as a budget guardrail, with three conditions:

- It is a **budget** figure, not a gas prediction, and must never be read as permission to spend. State that explicitly in the doc.
- It must remain strictly separate from CCA/LBP funding ETH and from the 10 ETH graduation-minimum planning gate already frozen in L1A.
- It must not replace live `eth_estimateGas` × current fee data plus a margin at execution time. The floor is necessary, never sufficient.

Repository implications now: **documentation constants only**. Do not add an ETH-balance gate to any submission or execution path in this pack — that would change runtime behavior of the frozen launcher. A later authorized unit may add a read-only advisory balance display.

## 4. Repo-only L1 Closure Pack — exact files

Add:
1. `docs/PCART_L1_CLOSURE_PACK.md` — the closure record: per-item CLOSED/PENDING status, operational reserve policy, treasury architecture decision, internal comms rules, and the simulation-sequencing resolution.
2. `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md` — dated `2026-09-20`, versioned `v1`, listing chain 4663 / testnet 46630 / native ETH, the Safe v1.4.1 SafeL2 singleton and SafeProxyFactory addresses, Uniswap Liquidity Launcher v3.2.0, LBPStrategy pointer, CCA factory, TokenSplitter, Permit2, UniversalRouterStrategy pointer — each marked RESEARCHED, NOT ON-CHAIN VERIFIED, with an explicit **MUST BE REVALIDATED IMMEDIATELY BEFORE L5 EXECUTION** clause and a fail-closed rule: any mismatch at revalidation blocks execution.
3. `docs/PCART_L1_COMMS_RULES.md` — internal communications rules only (may be folded into file 1 if you prefer three files becoming two).
4. `scripts/pcart-l1-closure-regression.ts` — static guardrails (section 5).

Change:
5. `docs/PCART_MASTER_LAUNCH_PLAN.md` — new section 14 recording L1 closure status per item, amending lines 133 / 204 / 302 / 317 pointers only. No frozen economic value altered.

Nothing under `src/**`, `supabase/**`, `docs/sql/**`, `contracts/**`, `package.json`, or `.lovable/plan.md`.

## 5. Regression tests to add

`scripts/pcart-l1-closure-regression.ts`, dependency-free `node:fs` + `node:assert`, asserting:

1. Closure pack and manifest exist and carry their status markers.
2. Manifest is dated and version-tagged, contains the revalidation-before-L5 clause and a fail-closed statement.
3. Every address in the manifest is a well-formed checksum-shaped `0x` + 40 hex string, and each is labelled RESEARCHED / NOT ON-CHAIN VERIFIED.
4. Manifest addresses appear in **no** file under `src/**`, `supabase/**` or `contracts/**` — documentation only; no router, factory, Permit2 or Safe address leaks into runtime code.
5. Reserve policy states 0.10 ETH reserve and 0.05 ETH wallet floor, and states it is a budget guardrail requiring live gas estimation.
6. Comms rules contain the prohibitions: no guaranteed return/profit/price claim, no Robinhood endorsement/listing implication, no "no sale" framing, no LIVE announcement before verified deployment + source verification + registration + liquidity evidence.
7. No legal-approval claim: the pack must not assert legal counsel or compliance approval; it must name external sign-off as an owner-side prerequisite.
8. Safe architecture section names v1.4.1 SafeL2 + SafeProxyFactory and lists the six stronger verification requirements as PENDING.
9. Non-activation tripwires, unchanged in spirit from `pcart-l2-draft-artifact-regression.ts`: `pepecartel-token-v1` still absent from `src/**` and `supabase/migrations/**`; `APPROVED_OFFICIAL_ARTIFACT_ID` still exactly `cartel-fixed-erc20-v1`; `src/lib/cartel-fixed-erc20.artifact.ts` hashes unchanged; `MAINNET_LIQUIDITY_TX_ENABLED` still `false`; migration count still 82; no PCART treasury address is written anywhere in the repo.
10. The closure pack explicitly states Phase 2 compilation still requires separate authorization.

Re-run unchanged: `pcart-l2-draft-artifact`, `pcart-l1b-treasury-safe-verify`, `hardening-b`, `p1a-project-journey`, `p2c2-launch-isolation`, `p3c-f`/`f1`/`f2`, `launcher-b`/`b3`, `verifier-state-write-activation`, `wallet-connector`, plus `bunx tsgo --noEmit` and `bun run build`.

## 6. DB migration needed now?

**None. Zero SQL.** No table, column, CHECK, RPC, policy, grant or data change. The artifact-allowlist widening and PCART-specific invariants remain Phase 3 (post-compile). The migration-count tripwire stays pinned at 82.

## 7. Resolving the L1-vs-L3 simulation circularity

The current wording is genuinely circular: L1 demands fork/testnet simulation, but the exact artifact is intentionally uncompiled until Phase 2, after L1 closes. Resolution, without weakening safety — **split item L1-e into two distinct obligations**:

- **L1-e1 — Infrastructure/protocol compatibility evidence (closes L1).** Satisfied by: the already-finalized mainnet canary (a real 4663 deployment of `cartel-fixed-erc20-v1` proving the chain, RPC, gas, evidence and finality path work end to end), plus the dated compatibility manifest, plus static/read-only checks. This proves the *rails*, which is all L1 ever needed to freeze policy.
- **L1-e2 — Exact-artifact rehearsal (does NOT close L1; stays Phase 3).** A real testnet 46630 deployment of the compiled `pepecartel-token-v1`, separately authorized. It remains a hard prerequisite for mainnet PCART deployment.

Safety is unchanged because nothing that L1 closure unlocks is an on-chain action: closure unlocks only Phase 2 compilation, itself a separately authorized repo-only step. Record this split in the master-plan amendment so the prerequisite is relocated, not deleted.

## 8. CLOSED vs PENDING after the repo-only pack

**Can be marked CLOSED:**
- L1-a operational ETH reserve policy (0.10 / 0.05, budget guardrail).
- L1-b (implementation half only) — Safe v1.4.1 SafeL2 + SafeProxyFactory on 4663 chosen as the frozen treasury architecture.
- L1-c (internal half only) — PEPECARTEL communications rules.
- L1-d — dated, versioned, fail-closed compatibility manifest, with mandatory L5 revalidation.
- L1-e1 — infrastructure/protocol compatibility evidence.

**Must remain PENDING (and L1 cannot be declared fully closed for execution purposes until each is met):**
- Actual PEPECARTEL Safe deployment; the Safe address and 3 signer addresses.
- The six stronger Safe verifications (singleton slot, proxy code hash, strict VERSION, empty modules, zero guard, readable nonce) implemented in the verifier and passing against the real Safe.
- PCART initial treasury recipient address.
- External legal sign-off, if the owner requires it.
- L1-e2 exact-artifact testnet rehearsal (Phase 3).
- On-chain revalidation of every manifest address immediately before L5.
- Funded deployer wallet meeting the 0.05 ETH floor.

Recommended framing: **L1 POLICY CLOSED / L1 EXECUTION PREREQUISITES PENDING.** Phase 2 compilation may be authorized on POLICY CLOSED alone.

## 9. Exact stop point

Stop immediately after the repo-only pack is committed and all gates pass. Specifically, stop **before**: creating or deploying any Safe; funding any wallet; compiling anything; producing `pepecartel-token-v1`; any testnet or mainnet transaction; any ARM/CLAIM/send-window action; any PCART production request; any SQL. Report SHA, diffstat, per-suite counts, CLOSED/PENDING table, residual uncertainty. Do not start Phase 2.

## 10. Prohibited changes

Any `src/**`, `supabase/**`, `docs/sql/**` or generated-types edit; any migration or SQL; editing `contracts/PepeCartelToken.sol` or `src/lib/cartel-fixed-erc20.artifact.ts`; widening the artifact allowlist; adding `pepecartel-token-v1` outside documentation; placing any Safe, router, factory, Permit2 or treasury address into runtime code; any compile step or solc/hardhat/foundry install; any package/config change; changing `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` or runtime execution control; creating a PCART production request; Safe creation; wallet signing, broadcasting or value movement on any chain; deploy, publish, secret change or Telegram send; weakening or deleting any existing regression assertion; asserting legal approval anywhere in the pack.
