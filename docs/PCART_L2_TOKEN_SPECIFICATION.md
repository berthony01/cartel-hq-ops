# PCART-L2 Token Specification — DRAFT

Status: **DRAFT / PCART-L1 OPEN / NON-DEPLOYABLE**
Date: 2026-09-20
Scope of this document: source-level specification only. Phase 1 is a non-operational repository foundation.

## 1. Status and gate

- PCART-L1 remains **OPEN**. See `docs/PCART_MASTER_LAUNCH_PLAN.md` section 13.
- A DRAFT, non-compiled, non-frozen, non-allowlisted `contracts/PepeCartelToken.sol` exists for source-level review and static regression testing only.
- **Phase 2 is blocked until PCART-L1 is explicitly closed.** No compilation, no frozen artifact, no hashes, no allowlisting, no database change, no production request, no testnet or mainnet transaction may occur before that closure and a separate authorization.
- The intended future artifact id is `pepecartel-token-v1`. It is **NOT created and NOT allowlisted** in this phase. The only production-allowlisted artifact remains `cartel-fixed-erc20-v1`.

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

## 5. Intended Phase 2 compiler settings

Inherited from the generic frozen build unless explicitly re-approved at L1 closure:

| Setting | Value |
|---|---|
| solc | `0.8.36+commit.8a079791` |
| OpenZeppelin Contracts | `5.6.1` |
| optimizer | enabled, runs 200 |
| viaIR | false |
| evmVersion | `paris` |
| metadata.bytecodeHash | `none` |
| metadata.appendCBOR | false |

## 6. Phase 2 required outputs (blocked until L1 closure)

Only after PCART-L1 is explicitly closed and PCART-L2 is separately authorized may Phase 2 produce, from a reproducible out-of-band compile:

1. the ABI;
2. the creation bytecode;
3. the deployed runtime bytecode;
4. the keccak256 hash of the creation bytecode;
5. the keccak256 hash of the runtime bytecode;
6. the canonical compiler standard-JSON input used;
7. a frozen artifact manifest under the id `pepecartel-token-v1`.

Because the contract declares no `immutable` state, the runtime bytecode is independent of the constructor argument and can be pinned by hash.

## 7. Treasury recipient — intentionally unresolved

The `treasury_` address is **deliberately undetermined** in this phase. It will be the PEPECARTEL 2-of-3 Safe, which has not yet been selected, deployed or verified. No PCART initial recipient is fixed. This does not block Phase 1 because the address is a constructor argument, not contract state.

## 8. Integration status

- No database, schema, RPC, policy, grant or migration change in Phase 1.
- No `src/**` reference to `PepeCartelToken` or `pepecartel-token-v1` in Phase 1.
- No artifact allowlist widening; `src/lib/launch-evidence-checks.ts` still approves exactly `cartel-fixed-erc20-v1`.
- `MAINNET_LIQUIDITY_TX_ENABLED` remains `false`; runtime mainnet execution control untouched.
- No mainnet or testnet action of any kind in Phase 1.

Static enforcement of the above lives in `scripts/pcart-l2-draft-artifact-regression.ts`.
