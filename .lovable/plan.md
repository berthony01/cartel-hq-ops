# PCART Treasury Safe Creation — Read-Only Audit (no changes made)

Nothing was edited, applied, deployed, signed or sent. Every finding below comes from a file read done for this audit.

## Short answer
You can build this safely inside Cartel HQ. It needs one short code step first (B0) and one small storage addition (E). Two values can't be found anywhere in the project, so they need your decision. Until then, the fastest safe option is still the official Safe app (see H).

## Findings

**A. Is the wallet setup enough?** Mostly yes. `src/lib/wallet-connector.ts` already enforces Robinhood Chain (eip155:4663): it switches chains only when the user taps, and it reads the chain from the wallet session rather than trusting the wallet's default. `src/lib/chain-mainnet-wallet.ts` already has a "send exactly one transaction, no retry, an unclear result is treated as failure" pattern. That send path is tied to server-issued token-deployment envelopes and the mainnet kill switches, so it should NOT be reused as-is (see the separation section below). A small separate sender is needed that copies its rules: one `eth_sendTransaction`, chain checked again just before the wallet prompt, no automatic retry.

**B. Setup data for a plain 2-of-3 Safe.** These values come from the public Safe v1.4.1 `setup` interface. No Safe contract code or ABI exists in the project or its installed packages. `@safe-global/safe-apps-*` are Safe app SDKs, not the Safe protocol kit. So every value below has to be pinned and checked against the published source before use:
- `_owners`: the 3 saved signers, in saved order (signer_1, signer_2, signer_3)
- `_threshold`: 2
- `to`: 0x0000000000000000000000000000000000000000
- `data`: 0x
- `fallbackHandler`: **unresolved.** The project pins no fallback handler. Zero is valid and gives the strict "no handler" result you asked for. The official Safe app normally sets the CompatibilityFallbackHandler instead, which some signing tools need for contract signatures (EIP-1271). This is your decision; the project doesn't settle it.
- `paymentToken`: 0x0000000000000000000000000000000000000000
- `payment`: 0
- `paymentReceiver`: 0x0000000000000000000000000000000000000000

**C. Factory method and salt.** Use `createProxyWithNonce(singleton = SafeL2 0x29fc…C762, initializer, saltNonce)`. Don't use `createChainSpecificProxyWithNonce` or the callback variant. The saltNonce should be fixed and saved before the wallet prompt (for example a hash of the launch ID plus a saved attempt number), so the predicted address stays the same if you retry. If a send result is unclear, check whether code already exists at the predicted address before allowing anything new. Never pick a new salt silently.

**D. Can the address be predicted before sending?** Yes, without sending anything. It's CREATE2 on the factory, with salt = keccak256(keccak256(initializer) ++ saltNonce) and the code hash = keccak256(factory `proxyCreationCode()` ++ singleton padded to 32 bytes). `proxyCreationCode()` can be read from the factory, and the result can be cross-checked with an `eth_call` simulation of the create. viem (already installed) has everything needed.

**E. Where to save the Safe address.** There is no suitable place today. `launch_treasury_signer_configs` stores only the signers and threshold; no table has a Safe address column. Minimal storage needed (not created in this audit):
- New columns on `launch_treasury_signer_configs`: `safe_address`, `safe_salt_nonce`, `safe_creation_tx_hash`, `safe_verified_at`, `safe_verified_block`
- Writes go only through a security-definer RPC that the workspace owner can call. The server re-runs the verifier itself and never trusts a pass reported by the browser.

**F. Readiness change.** `pcart-launch-readiness.ts` already requires `treasurySafeVerified === true`. In `launch-control.tsx:1083` that value is hard-coded to `false`. It should be set to true only when a saved Safe address exists AND a fresh server check passes AND the on-chain owners exactly match the saved signer set. Gap: the current verifier checks that there are 3 owners and a threshold of 2. It does not check that they are the INTENDED 3 owners. An exact owner-set comparison has to be added.

**G. Smallest safe allowlist (later build, split into steps)**
- B0: `src/lib/treasury-safe-create.ts` (new, pure code): pinned factory/setup interface fragments, initializer encoder, CREATE2 address prediction, exact owner-set comparison. Adds a narrow L1C-6 exception for the factory address in `scripts/pcart-l1-closure-regression.ts`.
- B1: staged SQL plus rollback for the columns and RPC in E (applied only with your approval).
- B2: `TreasurySafeCreatePanel.tsx` (new) inside the Treasury area of `launch-control.tsx`. Plain-English review, predicted address, one wallet confirm, waits for the receipt, then runs the existing `verifyTreasurySafe` and the exact-owner check, then saves through the RPC.
- B3: wire `treasurySafeVerified` into readiness.
- Tests: new `scripts/pcart-treasury-safe-create-regression.ts` (initializer bytes match a pinned expected value, prediction matches a known vector, wrong owner/order/threshold fails, nonzero fallback/module/guard is rejected, no retry path, mainnet kill switches untouched). Extend `pcart-launch-simplification-regression.ts` for the readiness change. Extend `pcart-l1b-treasury-safe-verify-regression.ts` for the exact owner match.

**Separation from token-deployment controls.** The Safe creation send must not read or change `execution_enabled`, the emergency stop, canary permits or presign authorizations. It also must not open any path for token deployment requests. It is treasury setup that requires explicit wallet confirmation and has no auto-retry.

**H. Reasons not to build this (or to wait)**
1. No pinned Safe v1.4.1 setup or factory interface exists in the project. These are the bytes that would actually be sent, and today they would be written from memory. That needs a pinned-source check first (cost: B0).
2. The fallback handler choice (B) is unresolved and changes how the Safe behaves with signing tools later.
3. The factory's `proxyCreationCode` and code hash aren't yet pinned in the manifest, so the prediction depends on a fresh read.
4. You'd be doing a single, one-time action. The official Safe app supports custom chains less reliably, but it is battle-tested. Using it, then pasting the address into the existing verifier, needs only steps B1 and B3 and zero new transaction code.

Recommendation: if the official Safe app supports chain 4663 for you, use it, then build only B1 + B3 (save the address + mark Treasury ready after exact verification). Otherwise do B0–B3 in that order, stopping for review after each step.

## Decisions needed from you
- Fallback handler: zero (strict) or the canonical CompatibilityFallbackHandler v1.4.1 (address to be pinned and checked on-chain first).
- Route: official Safe app + verify-and-save, or the full in-app creation.
