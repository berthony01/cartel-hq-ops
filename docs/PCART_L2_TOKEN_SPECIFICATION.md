# PCART-L2 Token Specification — FROZEN ARTIFACT

Status: **COMPILED + FROZEN REPOSITORY ARTIFACT / NOT PRODUCTION-ALLOWLISTED / NOT DEPLOYED**
Date: 2026-09-20
Scope of this document: source-level specification plus the frozen Phase 2 compile outputs. No runtime integration, no chain action.

## 1. Status and gate

- PCART-L1 is **POLICY CLOSED** (execution prerequisites still pending). See `docs/PCART_MASTER_LAUNCH_PLAN.md` sections 13 and 14.
- `contracts/PepeCartelToken.sol` is now the **frozen PCART-L2 source**. It has been reproducibly compiled out of band and frozen as artifact id **`pepecartel-token-v1`**.
- The frozen artifact is **NOT production-allowlisted, NOT deployed, and has NOT passed any testnet rehearsal.** The only production-allowlisted artifact remains `cartel-fixed-erc20-v1`; `src/lib/launch-evidence-checks.ts` is unchanged.
- **Phase 3 — exact-artifact testnet rehearsal — is mandatory next** and requires separate explicit authorization. Production allowlist integration is a separate phase after that.
- Phase 2 is complete only after the frozen-artifact regression, the draft/status regression, the full historical suite, `bunx tsgo --noEmit` and `bun run build` all pass.

## 2. Token identity and supply

| Property | Value |
|---|---|
| Contract name | `PepeCartelToken` |
| ERC-20 name | `PEPECARTEL` (hard-coded) |
| ERC-20 symbol | `PCART` (hard-coded) |
| Decimals | 18 (inherited ERC20 default, `decimals()` not overridden) |
| Total supply | exactly `1_000_000_000 * 10 ** 18` base units, permanently fixed |
| Supply constant | `uint256 public constant INITIAL_SUPPLY` |

## 3. Constructor behavior

- Signature: `constructor(address treasury_)` — exactly one argument.
- `treasury_ == address(0)` reverts with `error ZeroTreasury()`.
- Exactly one `_mint(treasury_, INITIAL_SUPPLY)` call, inside the constructor.
- No other constructor side effects.

## 4. Deliberately absent capability

Ownable, AccessControl, roles or admin of any kind; any post-construction mint API; custom burn path; pausable; capped; permit/EIP-2612; transfer tax or fee-on-transfer; blacklist, whitelist or freeze; trading toggle; cooldown; max-wallet or max-transaction limits; proxy, upgradeability or initializer; `selfdestruct`; `delegatecall`; `immutable` state; overridden transfer hooks.

Behavior beyond the above is exactly the OpenZeppelin ERC20 reference implementation.

## 5. Frozen reproducible compiler settings

| Setting | Value |
|---|---|
| solc | `0.8.36+commit.8a079791` |
| solc full version | `0.8.36+commit.8a079791.Emscripten.clang` |
| OpenZeppelin Contracts | `5.6.1` |
| optimizer | enabled, runs 200 |
| viaIR | false |
| evmVersion | `paris` |
| metadata.bytecodeHash | `none` |
| metadata.appendCBOR | false |

The compile was performed out of band in a temporary directory. Nothing in this repository compiles Solidity at build time or at runtime, and no package manifest or lockfile was touched.

## 6. Phase 2 outputs — frozen

| Output | Path |
|---|---|
| Canonical standard-JSON compiler input (self-contained, 6 source units) | `artifacts/pepecartel-token-v1.compiler-input.json` |
| Frozen artifact manifest | `artifacts/pepecartel-token-v1.manifest.json` |
| Frozen TypeScript artifact (ABI, creation + runtime bytecode, hashes) | `src/lib/pepecartel-token.artifact.ts` |

Actual hashes (keccak256):

| Value | Hash |
|---|---|
| Creation bytecode | `0x2edebe9de5877c0775dc87644ca9051a54034f4eee8bd9662c7657d0fd3c2196` |
| Deployed runtime bytecode | `0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4` |
| Canonical compiler input | `0xfd46fdfcf75e84e9ae691d16f8329fde27a2dea0d3bff2d460a2afa2df3ed72c` |
| `contracts/PepeCartelToken.sol` source | `0x395ca82da40deca324e67ecf3563b2b31aeaa896b582222599f536e5ae3577f8` |

Because the contract declares no `immutable` state, the runtime bytecode is independent of the constructor argument and is pinned by hash. The frozen creation bytecode is the constructor-independent creation prefix; ABI-encoded constructor arguments are appended only at deployment time and are not part of the artifact.

## 7. Treasury recipient — still unresolved

The `treasury_` address remains **deliberately undetermined**. It will be the PEPECARTEL 2-of-3 Safe, which has not yet been selected, deployed or verified. No PCART initial recipient is fixed, and no wallet, signer or Safe address appears in the source, the compiler input, the manifest or the TypeScript artifact.

## 8. Integration status (updated by PCART-L3, repo only)

- The frozen artifact is still **NOT production-allowlisted, NOT deployed, and no rehearsal has been performed.** Manifest status flags are unchanged.
- PCART-L3 adds an exact-artifact **TESTNET rehearsal path** for the canonical `pepecartel-launch` PROJECT only: `src/lib/launch-artifact-registry.ts` (identity, init code, runtime hash, fixed intent, environment allowlist), `src/lib/pcart-rehearsal.ts`, `src/components/chain/PcartRehearsalPanel.tsx`, and artifact-aware verification in `src/lib/chain-verify.functions.ts`. The generic verification branch is unchanged.
- Database support is **staged, not applied**: `docs/sql/PCART_L3_launcher_rehearsal_and_mainnet_isolation.sql`. Until it is applied in a separate gated turn, the rehearsal RPC is missing and the app fails closed (nothing is created or broadcast). No `supabase/migrations/**` file references `pepecartel-token-v1`.
- Mainnet isolation: the canonical launch shows a read-only blocked checkpoint instead of the generic production request form; the staged SQL makes the generic request and begin-execution RPCs reject it and binds every production request immutably to `cartel-fixed-erc20-v1`.
- `src/lib/launch-evidence-checks.ts` still approves exactly `cartel-fixed-erc20-v1`. `MAINNET_LIQUIDITY_TX_ENABLED` remains `false`; runtime mainnet execution control untouched.
- No mainnet or testnet action of any kind has been performed.

Static enforcement lives in `scripts/pcart-l2-draft-artifact-regression.ts`, `scripts/pcart-l2-frozen-artifact-regression.ts` and `scripts/pcart-l3-launcher-integration-regression.ts`.
