# PCART Safe Verification Hardening — Audit and Residual Build Plan

## Start-gate finding (read this first)

The authorised gate names HEAD `34f76a6d…`. Current HEAD is `9939c37e2e725b06b04286753f66ae667c7578d8`, working tree clean. The Option A hardening unit was already executed and verified in the preceding turns (committed at `38f17928…`, platform auto-commits since). **No duplicate build is proposed.**

Verified by direct inspection of `src/lib/treasury-safe-verify.ts`, `src/lib/treasury-safe-verify.functions.ts` and `scripts/pcart-l1b-treasury-safe-verify-regression.ts` at current HEAD.

### Requirements already BUILT

| # | Requirement | State |
|---|---|---|
| 1 | chain exactly 4663 | BUILT |
| 2 | candidate has contract code | BUILT |
| 3 | masterCopy() equals canonical SafeL2 v1.4.1 singleton | BUILT (via `masterCopy()` only) |
| 4 | proxy runtime code-hash match | BUILT, pin provenance weaker than this spec demands (see below) |
| 5 | VERSION() readable and exactly 1.4.1 | BUILT, no longer optional |
| 6 | 3 unique non-zero owners | BUILT |
| 7 | threshold exactly 2 | BUILT |
| 8 | nonce() readable | BUILT |
| 9 | getModulesPaginated(0x1, 1) proves no modules | BUILT (empty array AND next === sentinel) |
| 10 | guard storage slot zero/unset | BUILT |
| 11 | all malformed/reverted/ambiguous reads fail closed | BUILT, distinct failure codes |

Transport already restricted to `eth_chainId`, `eth_getCode`, `eth_getStorageAt`, read-only `eth_call`; managed server RPC only; authenticated; no persistence; non-gating for production submission.

### Residual gaps vs this specification

- **G1 — proxy hash provenance.** The pinned hash `0xd7d408eb…fb4c` was taken from the official `@safe-global/safe-contracts@1.4.1` package artifact and asserted by `keccak256` in the regression, but it was not derived by compiling `SafeProxy.sol` with solc 0.7.6, optimizer disabled, and the derivation command/provenance is not recorded in the docs.
- **G2 — singleton proven one way only.** Storage slot 0 is not read; only `masterCopy()` is. A malicious fallback could answer `masterCopy()` while slot 0 says otherwise.
- **G3 — fallback handler not checked.** Open question 5.
- **G4 — wording.** Panel says "Canonical Safe v1.4.1 profile verified", not the "HARDENED VERIFIED" label this spec uses.

## Answers to the design questions

1. **Files/functions.** Only `treasury-safe-verify.ts` (constants + `evaluateTreasurySafe`), `treasury-safe-verify.functions.ts` (one extra `eth_getStorageAt` read, optionally two), the panel (label + one evidence line), the L1B regression, and three docs.
2. **Reads.** Add `eth_getStorageAt(candidate, 0x0)` for the singleton slot. No new methods beyond the four already allowed.
3. **Both, and fail on disagreement.** Yes — recommended. Require slot 0 and `masterCopy()` to each equal the canonical singleton and to equal each other; a mismatch is its own failure code `SINGLETON_SLOT_DISAGREEMENT`. This closes the spoofing gap that a code-hash check alone only narrows.
4. **Decoding.** Storage words: exactly 32 bytes / 66 hex chars, else unreadable; address = low 20 bytes with the high 12 bytes required zero. `nonce()`: exactly one 32-byte word, any value. Modules: strict `(address[],address)` ABI decode, pass only if the array is empty and next is `0x…01`. `VERSION()`: strict dynamic-string decode, exact `1.4.1`.
5. **Fallback handler — recommend NOT adding as a hard requirement in this unit.** The canonical Safe deployment flow sets `CompatibilityFallbackHandler`, so a correct PCART Safe will normally have a non-zero handler; requiring zero would fail a legitimate treasury. Recommendation: read the fallback-handler slot, surface it as informational evidence only, and keep it entirely separate from the guard and module gates. Making it a gate requires first pinning the canonical handler address for chain 4663, which this unit is not authorised to source.
6. **Failure model.** Unchanged pattern: single ordered evaluation, first failure wins, `isCanonicalSafeV141` true only when every check is true; add `SINGLETON_SLOT_UNREADABLE` and `SINGLETON_SLOT_DISAGREEMENT`.
7. **Wording.** Keep success gated on the full profile (already true). Change the success label to "Hardened verified — canonical Safe v1.4.1 profile", keep the existing disclaimers that signer identities are not pinned and nothing was created, approved or moved.
8. **Stay advisory.** No production-request gate in this unit. `ProductionDeploymentRequestPanel.tsx` remains untouched and unchanged in the diff.
9. **Regression.** Add to `pcart-l1b-…`: slot-0 happy path; slot-0 unreadable; slot-0 wrong singleton; slot-0 vs masterCopy disagreement; slot-0 dirty high bytes; fallback-handler informational field does not affect the verdict; provenance comment present.
10. **Allowlist / prohibited.** Below.

## Proposed residual unit (smallest safe delta)

**Step 0 — proxy hash derivation (blocking gate).** In `/tmp` only: fetch `@safe-global/safe-contracts@1.4.1`, compile `SafeProxy.sol` with solc 0.7.6, optimizer disabled, evm target as per the package config, keccak256 the deployed runtime. If it equals `0xd7d408eb…fb4c`, record the exact command and provenance in the compatibility manifest and a regression comment. If it does not reproduce unambiguously, **STOP and return PLAN BLOCKED ON PROXY HASH** — no weakening, no re-pinning.

**Step 1 — slot-0 singleton proof (G2).** Constants `SAFE_SINGLETON_STORAGE_SLOT = 0x0…0`; read it; require canonical value and agreement with `masterCopy()`.

**Step 2 — fallback handler informational read (G3).** Read the slot, display it, never gate on it.

**Step 3 — label (G4)** and doc status update.

### Allowlist (8 files, no other file may change)

1. `src/lib/treasury-safe-verify.ts`
2. `src/lib/treasury-safe-verify.functions.ts`
3. `src/components/cartel/TreasurySafeVerificationPanel.tsx`
4. `scripts/pcart-l1b-treasury-safe-verify-regression.ts`
5. `scripts/pcart-l1-closure-regression.ts` (only if a new pinned status string requires re-pinning)
6. `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md`
7. `docs/PCART_L1_CLOSURE_PACK.md`
8. `docs/PCART_MASTER_LAUNCH_PLAN.md`

### Prohibited

No Supabase/SQL/migration; no production-request eligibility change; no artifact allowlist change; no PCART compilation or artifact; no Safe deployment or signer selection; no write RPC, signing, transaction or value movement; no ARM/CLAIM/send-window/runtime-control change; no liquidity work; no generic launcher behaviour change; no package.json or lockfile change; no deploy/publish/secret/Telegram action; no edit to `ProductionDeploymentRequestPanel.tsx` or `.lovable/plan.md` beyond this plan.

### Verification

Updated L1B regression; then closure, l2-draft, hardening-b, p1a, p2c2, p3c-f, p3c-f1, p3c-f2, launcher-b, launcher-b3, verifier-state, wallet-connector; `bunx tsgo --noEmit`; `bun run build`; exact-file diff confirmation and zero diff on all protected paths.

### Stop point

STOP after the residual hardening is committed and verified. No Safe creation, no signer selection, no PCART-L2.

### Remains PENDING regardless

Actual Safe deployment; the three signer addresses; live canonical pass against the real Safe; exact owner-address match; funded execution wallet; external legal review; Phase 2 compilation; L1-e2 testnet rehearsal; pre-L5 on-chain revalidation.
