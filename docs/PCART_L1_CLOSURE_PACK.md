# PCART-L1 Closure Pack

Version: **v1**
Date: **2026-09-20**
Status: **PCART-L1 POLICY CLOSED / EXECUTION PREREQUISITES PENDING**

This pack is **documentation and static regression only**. It closes PCART-L1 *policy*. It does **not** mean PCART is launch-ready, execution-ready, or mainnet-ready, and it authorizes no Safe creation, no compilation, no artifact, no SQL, no production request, no testnet or mainnet transaction, no wallet funding, no ARM/CLAIM/send window, no liquidity execution, no deploy/publish, no secret change and no Telegram send.

**Phase 2 (reproducible compilation and freezing of `pepecartel-token-v1`) still requires separate authorization after this pack.** It is not started here.

Companion documents: `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md`, `docs/PCART_L1_COMMS_RULES.md`, `docs/PCART_L2_TOKEN_SPECIFICATION.md`, `docs/PCART_MASTER_LAUNCH_PLAN.md`. Static guardrails: `scripts/pcart-l1-closure-regression.ts`.

---

## 1. Operational ETH policy (POLICY CLOSED)

- **Frozen operational gas reserve: 0.10 ETH**, held explicitly **separate from liquidity / CCA auction funding**. It is not part of any liquidity budget and may not be repurposed as auction capital.
- **Execution-wallet floor: at least 0.05 ETH immediately available** in the designated execution wallet **before any mainnet PCART deployment or launch execution action**.
- These figures are **budget guardrails, NOT gas-price predictions and NOT authorization to spend.** Meeting the floor grants no permission to execute anything.
- **Live gas estimation remains mandatory at execution time.** Every execution must use current fee data and live estimation, and must require sufficient balance for the estimated maximum cost **plus a substantial safety margin**. The floor is necessary, never sufficient.
- **Documentation-only in this unit.** No runtime balance gate is added to any submission or execution path.

## 2. Treasury architecture policy (POLICY CLOSED — implementation choice only)

**Frozen preferred implementation:** **Safe v1.4.1 SafeL2 + SafeProxyFactory** on Robinhood Chain **4663**, with **exactly 3 unique non-zero owners** and **threshold 2** (2-of-3).

Canonical references (documentation only; see the manifest for evidence class):

| Component | Address | Expected code hash |
|---|---|---|
| SafeL2 v1.4.1 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |
| SafeProxyFactory v1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |

The Safe official deployment registry maps Robinhood chain `4663` and testnet `46630` to the canonical SafeL2 v1.4.1 deployment.

**The actual PEPECARTEL Safe does not exist.** Signer addresses are unresolved, the Safe address is unresolved, and no PCART treasury recipient is fixed. None of them is invented here.

### 2.1 Stronger Safe verification requirements — IMPLEMENTATION BUILT / LIVE VALIDATION PENDING

All of the following must be implemented and must **pass against the real Safe** before that Safe may be used as the PCART treasury. **Fail closed on any ambiguity, unreadable read, or mismatch.**

1. **BUILT** — singleton / masterCopy must equal the canonical SafeL2 v1.4.1 singleton.
2. **BUILT** — proxy runtime code hash must match the expected canonical SafeProxy code.
3. **BUILT** — `VERSION()` must be readable and exactly `1.4.1` (strict; an unreadable VERSION must not pass).
4. **BUILT** — modules must be empty.
5. **BUILT** — guard must be zero / unset.
6. **BUILT** — `nonce()` must be readable.
7. **PENDING** — owners must exactly match the selected 3 signer addresses.
8. **BUILT** — threshold must be exactly 2.

**BUILT** means the check exists in code, fails closed, and is covered by static regression. It does **not** mean it has been run against a real PEPECARTEL Safe, because no such Safe exists.

### 2.2 Hardening status update (2026-09-20, separately authorized read-only unit)

The v1 closure snapshot above originally recorded all eight items as PENDING, and the verifier was not modified in that earlier closure unit. A later, separately authorized **read-only, repo-only** unit hardened `src/lib/treasury-safe-verify.ts` from an ABI-compatible 2-of-3 check into a canonical Safe v1.4.1 profile check:

- exact SafeProxy v1.4.x runtime code hash `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c`;
- `masterCopy()` (selector `0xa619486e`) must equal the canonical SafeL2 v1.4.1 singleton;
- strict `VERSION()` exactly `1.4.1` — no longer optional;
- readable `nonce()`;
- `getModulesPaginated(SENTINEL_MODULES, 1)` must decode to an empty list with the sentinel as `next`;
- the v1.4.1 transaction-guard storage slot must be zero / unset;
- 3 unique non-zero owners and threshold exactly 2 preserved;
- every failed, reverted or malformed read fails closed, over the managed server RPC only, authenticated and read-only.

**Still PENDING:** live validation against the future actual PEPECARTEL Safe, and the exact selected owner-address match (item 7). The hardened verifier **remains non-gating** for production request submission, creates nothing, approves nothing and moves nothing. A canonical pass is **not** a PEPECARTEL treasury approval.


## 3. Robinhood / Uniswap compatibility (POLICY CLOSED — dated research evidence)

Recorded in `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md` v1, dated 2026-09-20: chain 4663 / testnet 46630 / native ETH, the Safe v1.4.1 addresses above, LiquidityLauncher v3.2.0, the LBPStrategy pointer, the CCA factory, TokenSplitter, Permit2 and the UniversalRouterStrategy pointer — each **RESEARCHED / NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT**, with **mandatory independent on-chain revalidation immediately before L5** and a **fail-closed mismatch rule**.

## 4. Internal communications policy (POLICY CLOSED)

Recorded in `docs/PCART_L1_COMMS_RULES.md` v1. It is an internal communications policy only; **this pack makes no claim of legal counsel, legal advice, or legal/compliance approval**, and external legal review remains a separate owner-side prerequisite.

## 5. L1-e1 / L1-e2 — simulation sequencing resolved

The old single "fork/testnet simulation" prerequisite was circular: it demanded exact-artifact simulation while the exact PCART artifact is deliberately uncompiled until Phase 2, which only begins after L1 closes. It is **split, not waived**:

- **L1-e1 — Infrastructure/protocol compatibility evidence. CLOSES L1 POLICY.** Evidence: the already-finalized **separate generic mainnet canary** proving the protected chain / RPC / gas / evidence / finality rails, plus this dated compatibility manifest, plus static/read-only checks.
- **L1-e2 — Exact-artifact rehearsal. REMAINS MANDATORY, Phase 3.** After Phase 2 compiles and freezes `pepecartel-token-v1`, an exact-artifact rehearsal **MUST pass on Robinhood testnet 46630 before any PCART mainnet deployment.** Relocated, not waived.

## 6. Status table

### POLICY CLOSED

| Item | Status |
|---|---|
| Exact operational ETH reserve policy (0.10 / 0.05) | POLICY CLOSED |
| Treasury implementation choice (Safe v1.4.1 SafeL2 + SafeProxyFactory, 2-of-3) | POLICY CLOSED |
| Internal communications policy | POLICY CLOSED |
| Dated/versioned Robinhood/Uniswap compatibility research manifest | POLICY CLOSED |
| L1-e1 infrastructure/protocol compatibility evidence | POLICY CLOSED |

### PENDING EXECUTION PREREQUISITES

| Item | Status |
|---|---|
| Actual PCART Safe deployment | PENDING |
| Exact 3 signer addresses | PENDING |
| Actual Safe address and PCART treasury recipient | PENDING |
| Stronger Safe verification implementation | BUILT / HARDENED (see 2.2) |
| Live stronger-verification pass against the actual Safe + exact owner-address match | PENDING |
| Funded execution wallet satisfying the 0.05 ETH floor at execution time | PENDING |
| External legal review, if the owner requires it | PENDING |
| Phase 2 compilation / frozen artifact (separately authorized) | PENDING |
| Phase 3 exact-artifact testnet rehearsal on 46630 (L1-e2) | PENDING |
| Independent on-chain revalidation of the compatibility manifest immediately before L5 | PENDING |
| Every existing deployment/liquidity safety gate | PENDING / UNCHANGED |

## 7. Unchanged safety state

The only production-allowlisted artifact remains `cartel-fixed-erc20-v1` with its existing creation and runtime bytecode hashes. `MAINNET_LIQUIDITY_TX_ENABLED` remains `false`. The runtime mainnet execution control, the artifact allowlist, the database schema, and every existing regression assertion are untouched by this pack.
