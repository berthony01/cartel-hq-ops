# C8.3 Read-Only Architecture Audit — Restricted Fixed-Supply ERC-20 (Testnet Only)

Start gate verified: HEAD `2658f08af1461d895a89da1303259f2d3cdb2620`, working tree clean, no edits made in this audit.

## A. Existing C8.2 surface C8.3 must reuse (verified)

Code:
- `src/lib/chain-registry.ts` — chain 46630 only, RPC URL + single env override, explorer helpers, `REQUIRED_CONFIRMATIONS = 5`, frozen test-artifact bytecode constants.
- `src/lib/chain-launcher.ts` — EIP-1193 provider access, `connectWallet`, `readChainId`, `readBalanceWei`, `ensureTestnet`, `isUserRejection`, `broadcastTestDeployment`, and the four RPC wrappers (create / submit / abandon / list).
- `src/lib/chain-verify.functions.ts` — authenticated server function `verifyChainDeployment`; independent chain reads, shape checks (to=null, value=0, sender match), receipt/confirmation logic, runtime-bytecode fingerprint, service-role apply RPC.
- `src/routes/_authenticated/chain-launcher.tsx` — owner-gated UI, attempt lifecycle, pre-broadcast abandon sentinel.

Database (`public.launch_chain_deployments`, 22 columns, 3 rows: 2 ABANDONED + 1 CONFIRMED `0xfd741c…921e`, 1417 confirmations):
- Hard CHECKs already pin `chain_id = 46630` and `network_environment = 'TESTNET'`; address/hash regex checks; status enum DRAFT→SUBMITTED→PENDING→CONFIRMED/FAILED/ABANDONED; FKs to `launches` and `workspaces`.
- RLS enabled with one read policy (platform-owner operator); table grants: anon none, authenticated SELECT only, service_role full.
- RPCs: `create_launch_chain_deployment_attempt`, `submit_launch_chain_deployment_tx`, `abandon_launch_chain_deployment_attempt`, `list_launch_chain_deployments`, `authorize_launch_chain_deployment`, `can_read_launch_chain_deployment`, service-role-only `apply_launch_chain_deployment_verification`, plus two tenant/update enforcement triggers (EXECUTE revoked from PUBLIC).

C8.3 extends this harness. It creates no new lifecycle, no new tenant model, no second deployments table.

## B. Smart-contract pipeline

None exists. No Foundry, Hardhat, solc, `.sol` sources, or artifacts anywhere in the repo; the only chain code is viem-based TypeScript.

Recommendation: do **not** introduce a Solidity build toolchain into this repo/Worker build. Compile the contract out-of-band with a pinned solc version and commit a **frozen artifact constant** (ABI + creation bytecode + solc version/settings + keccak hashes) in the same style as the C8.2 frozen bytecode. This keeps the trusted surface reviewable as a shipped constant and keeps the Cloudflare Worker build free of Node-only tooling.

## C. Dependencies

`viem@^2.56.3` is already installed and is sufficient for ABI encoding (`encodeAbiParameters`, `encodeDeployData`), `keccak256`, address checksum/validation (`getAddress`, `isAddress`), `parseUnits`, and all read calls. `zod@^3` is available for input validation.

Smallest safe set for C8.3: **no new runtime dependency**. OpenZeppelin Contracts is used as the *source* of the token (audited ERC-20 base), consumed at out-of-band compile time — it does not need to become an npm dependency of this app. If a compile step is ever brought in-repo, it belongs in a separate isolated tool directory, never in the app dependency graph. Nothing installed in this audit.

## D. Recommended contract pattern

`CartelFixedSupplyToken` — OpenZeppelin `ERC20` only. No `Ownable`, no `ERC20Burnable`, no `ERC20Pausable`, no access-control roles, no hooks.

```text
constructor(string name_, string symbol_, uint256 totalSupply_, address recipient_)
  require(recipient_ != address(0))
  require(totalSupply_ > 0)
  _mint(recipient_, totalSupply_)
```

- decimals fixed at 18 (inherited default, not overridable by input).
- No `mint`, `burnFrom`-by-owner, tax, blacklist, freeze, trading toggle, max-wallet/max-tx, or upgrade proxy.
- No owner exists after deployment: total supply is minted once to the disclosed recipient and the contract has zero privileged functions. Post-deployment minting: **NOT RECOMMENDED**, and not included.
- Result: the only state-changing functions are the standard ERC-20 `transfer`, `approve`, `transferFrom`.

## E. Deterministic server-side verification

All checks run in an extended `verifyChainDeployment` (same trust model: authenticated, RLS-read row, independent RPC reads, service-role apply). Practical checks, in order:

1. `eth_chainId` / registry pin = 46630, `network_environment = TESTNET`.
2. `tx.from` == stored `deployer_address`; `tx.to` is null; `tx.value` == 0.
3. **Exact init-code equality** — the strongest check available. The server recomputes `expected_init_code = FROZEN_CREATION_BYTECODE || abi.encode(name, symbol, supply, recipient)` from the intent stored in the database at attempt creation, and compares byte-for-byte with `tx.input`. This simultaneously proves the contract source, the constructor arguments, and that no substituted bytecode was signed.
4. Receipt `status == 0x1`, `contractAddress` present, receipt hash matches request.
5. Confirmations `>= 5` before anything is marked CONFIRMED; block hash overwritten every check (reorg-safe, as in C8.2).
6. **Runtime code check** — `eth_getCode` keccak compared to the artifact's expected runtime hash. Feasible here because the contract uses no `immutable` variables (name/symbol are storage strings), so runtime code is constructor-argument independent. If the pinned artifact ever gains immutables this check must degrade to a length/prefix check and step 3 remains authoritative.
7. **Live metadata via `eth_call`** at the created address: `name()`, `symbol()`, `decimals() == 18`, `totalSupply() == intent supply`, `balanceOf(recipient) == totalSupply`. Any mismatch → FAILED with a specific failure code.

Steps 3 and 7 together mean the browser is trusted for nothing: intent is recorded before signing, and the chain is the arbiter afterwards.

## F. Database changes actually required

Extend `launch_chain_deployments` — do not create a parallel table (columns nullable, so every existing row and the C8.2 path stay valid):

- `deployment_kind text not null default 'TEST_ARTIFACT'` CHECK in `('TEST_ARTIFACT','FIXED_SUPPLY_ERC20')`
- `artifact_id text` (pinned artifact identifier, e.g. `cartel-fixed-erc20-v1`)
- `token_name text`, `token_symbol text`, `token_decimals smallint CHECK (token_decimals = 18)`
- `token_total_supply numeric(78,0) CHECK (token_total_supply > 0)` (base units)
- `token_recipient text CHECK (~ '^0x[0-9a-f]{40}$' and <> zero address)`
- `expected_init_code_hash text CHECK (~ '^0x[0-9a-f]{64}$')`
- verified-side: `verified_token_name text`, `verified_token_symbol text`, `verified_total_supply numeric(78,0)`, `verified_recipient_balance numeric(78,0)`
- row CHECK: when `deployment_kind = 'FIXED_SUPPLY_ERC20'`, all token intent columns are NOT NULL.

RPCs (existing C8.2 functions stay frozen and unmodified):
- new `create_launch_chain_token_deployment_attempt(_launch_id, _client_request_id, _deployer_address, _artifact_id, _token_name, _token_symbol, _token_total_supply, _token_recipient, _expected_init_code_hash)` — same owner+operator authorization, same attempt-number/idempotency semantics, server-side re-validation of every field.
- extend `apply_launch_chain_deployment_verification` with optional verified-token parameters (service-role only, additive, defaulted).
- `list_launch_chain_deployments` returns the new columns automatically (row type).
- Grants mirror C8.2 exactly: anon none, authenticated EXECUTE on the create RPC only, apply RPC service-role only. No RLS policy change.

Nothing writes `launches.official_contract_address`, `set_launch_contract_address`, or any lifecycle column.

## G. Chain Launcher UI

Add a second mode on the existing owner-only route (test artifact remains, unchanged and default). Fields — exactly four, nothing else:

| Field | Validation |
| --- | --- |
| Token name | trimmed, 1–32 chars, printable ASCII only |
| Token symbol | trimmed, 2–11 chars, `^[A-Z0-9]+$` after uppercasing |
| Fixed total supply | integer whole-token string, 1 … 1,000,000,000,000 (10^12); converted with `parseUnits(value, 18)`; no decimals accepted |
| Initial recipient | `isAddress` + `getAddress` checksum; zero address rejected; defaults to (and is pre-filled with) the connected wallet, but is editable and explicitly displayed |

Decimals are fixed at 18 and shown read-only, not an input. Before signing, the UI shows a mandatory disclosure panel: exact name/symbol/supply/recipient, "100% of supply is minted once to this address", "no owner, no mint, no tax, no blacklist, no pause", "Robinhood Chain TESTNET (46630) — not a real token, not tradable, no liquidity". Same pre-broadcast abandon sentinel as the C8.2 patch.

## H. Threat model

| Risk | Control |
| --- | --- |
| Malicious/oversized input | Zod + RPC-side re-validation + DB CHECKs (defence in depth, all three) |
| Supply overflow | `numeric(78,0)` upper bound + uint256 range assertion before encoding |
| Wrong chain / accidental mainnet | 4663 absent from the codebase entirely; wallet chain check pre-send; DB CHECK `chain_id = 46630`; verifier re-pins |
| Wallet/account mismatch | `tx.from` compared to stored `deployer_address` server-side |
| Substituted or tampered bytecode | Exact init-code equality against server-recomputed expected calldata (E.3) |
| Front-end tampering | Browser is not trusted for any recorded fact; intent is stored before signing and re-derived server-side |
| Replay / duplicate attempts | `client_request_id` idempotency + attempt numbering, both already enforced |
| Database tampering | Table writes only via SECURITY DEFINER RPCs; authenticated has SELECT only; apply RPC is service-role only; update trigger constrains transitions |
| Verification bypass | Only the server function can call the apply RPC; terminal states are not re-openable |
| RPC disagreement / reorg | 5-confirmation threshold; block hash rewritten each check; below threshold nothing is finalized |
| Privileged token functions | Contract has none by construction — reviewable in the frozen artifact |
| Duplicate token name/symbol | Not blocked on chain (impossible), surfaced in UI as a non-authoritative warning; not a security control and must not be described as one |
| Misleading legitimacy | Every surface labelled TESTNET TEST TOKEN; no Launch Watch, Telegram, broadcast, or public-network exposure in C8.3 |

## I. Build allowlist for C8.3

Allowed:
- `src/lib/chain-registry.ts` (add frozen ERC-20 artifact constants only; mainnet stays absent)
- `src/lib/chain-launcher.ts` (add token intent encoding + token broadcast + new create RPC wrapper)
- `src/lib/chain-verify.functions.ts` (add token verification branch)
- `src/routes/_authenticated/chain-launcher.tsx` (token mode UI)
- exactly one new migration under `supabase/migrations/`
- `src/integrations/supabase/types.ts` only as regenerated output

Prohibited: mainnet 4663 in any form; arbitrary user bytecode/Solidity input; `launches` writes, `official_contract_address`, `set_launch_contract_address`, lifecycle transitions; Launch Watch, Telegram, inbox, broadcast, notification, cron, edge-function changes; liquidity/DEX (C8.6); package.json/lockfile changes; nav/route additions; edits to existing migrations or C8.2 RPC bodies; publish/deploy; any private key, mnemonic, seed, or server signer.

## J. Tests required before C8.3 can close

1. Artifact reproducibility: recompiling the pinned source with the pinned solc version and settings reproduces the committed creation bytecode and runtime keccak, byte-for-byte.
2. Static contract property review: no `mint` after construction, no owner/roles, no pause/blacklist/fee/limit logic, no proxy/upgrade path, no selfdestruct, no immutables.
3. Unit/pure tests on the encoder: init code = frozen bytecode ‖ encoded args; symbol/name/supply/address validators accept the legal set and reject the illegal set (empty, oversized, non-ASCII, lowercase symbol, zero supply, over-max supply, zero address, malformed address).
4. Rollback-safe SQL QA (transaction, always rolled back): new columns/CHECKs, kind-conditional NOT NULL, RPC authorization for owner / non-owner / cross-tenant, grants (anon none, authenticated SELECT + create-RPC EXECUTE, apply RPC service-role only), RLS policy unchanged, no residue afterwards.
5. Negative verifier tests: sender mismatch, non-creation tx, non-zero value, init-code mismatch, reverted receipt, runtime-hash mismatch, metadata mismatch, sub-threshold confirmations — each must produce FAILED/PENDING, never CONFIRMED.
6. Live testnet wallet E2E: real deploy, verifier reaches CONFIRMED at ≥5 confirmations, independent raw JSON-RPC cross-check of metadata and balances, and confirmation that `launches` and `official_contract_address` are untouched.
7. `eslint` on touched files, `bunx tsgo --noEmit`, `bun run build` — all clean.

## K. Direct creation bytecode vs factory — decision

**Choose direct deployment from the frozen creation bytecode. No factory in C8.3.**

- Direct: trusted surface is one immutable constant plus ABI-encoded args; verification is exact init-code equality; no extra deployed contract, no factory ownership/authority question, no factory address to protect or migrate; identical to the C8.2 harness already proven end-to-end.
- Factory: adds a persistent privileged contract, a deployment-of-the-deployer trust step, event-based (weaker) verification, and an on-chain authority model contradicting constraint 8 — its only real gains (gas amortisation, on-chain registry) are irrelevant for owner-only testnet work.

A factory can be revisited at C8.6 if liquidity orchestration genuinely requires atomicity.

## L. Must remain untouched

The single live launch — PEPECARTEL / `$PCART`, chain **Solana**, status `WATCHLIST_OPEN`, `official_contract_address` NULL, with a live Launch Watch token and active watchers/notifications. C8.3 attempts attach to this launch row only as subordinate `launch_chain_deployments` children. Its `chain`, `status`, `official_contract_address`, `contract_registered_*`, all lifecycle timestamps, and its Launch Watch token must not change. An EVM testnet test token must never be presented as, or promoted to, the official PEPECARTEL contract.

## Recommendation

**GO** for C8.3 as scoped above: extend the proven C8.2 harness with a `FIXED_SUPPLY_ERC20` deployment kind, one frozen OpenZeppelin-based artifact, one additive migration, one new create RPC, one additive verifier branch, and a four-field owner-only UI mode — testnet 46630 only, no factory, no mint, no owner, no liquidity, no launch-lifecycle contact.

Open item to confirm before build: the artifact must be compiled out-of-band and its bytecode/hashes supplied (or the compile explicitly authorized as a separate isolated step), since no Solidity toolchain exists in this repository.
