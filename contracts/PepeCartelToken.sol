// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * PCART-L2 FROZEN SOURCE — PEPECARTEL ($PCART).
 *
 * STATUS: PCART-L2 FROZEN SOURCE / COMPILED AND FROZEN AS
 *         `pepecartel-token-v1` / NOT YET PRODUCTION-ALLOWLISTED /
 *         NOT YET DEPLOYED.
 *
 * PCART-L1 is POLICY CLOSED (execution prerequisites still pending). This
 * source has been reproducibly compiled out of band and frozen as the
 * repository artifact `pepecartel-token-v1`:
 *   - artifacts/pepecartel-token-v1.compiler-input.json
 *   - artifacts/pepecartel-token-v1.manifest.json
 *   - src/lib/pepecartel-token.artifact.ts
 *
 * The frozen artifact is NOT integrated into any production allowlist,
 * launcher, verifier, database or runtime path. The only production-
 * allowlisted artifact remains `cartel-fixed-erc20-v1`
 * (contracts/CartelFixedSupplyToken.sol). Exact-artifact testnet rehearsal
 * remains PCART-L2 Phase 3 and has not been performed. No deployment of this
 * source to any network — testnet or mainnet — has occurred or is authorized
 * by the freeze. See docs/PCART_L2_TOKEN_SPECIFICATION.md and
 * docs/PCART_MASTER_LAUNCH_PLAN.md.
 *
 * The `treasury_` constructor address remains UNRESOLVED until the real
 * PEPECARTEL 2-of-3 Safe exists and is verified; it is a constructor
 * argument, not contract state, so the frozen runtime bytecode is unaffected.
 *
 * Frozen V1 token behavior:
 *   - name "PEPECARTEL", symbol "PCART", both hard-coded;
 *   - decimals() is the ERC20 default of 18 and is NOT overridden;
 *   - exactly 1,000,000,000 PCART minted once, inside the constructor, to a
 *     constructor-supplied non-zero treasury recipient;
 *   - nothing else that can change state beyond inherited standard ERC-20
 *     transfer/approve behavior.
 *
 * Deliberately absent: Ownable, AccessControl, roles, admin, any post-
 * construction mint path, custom burn path, pausable, capped, permit,
 * transfer tax / fee-on-transfer, blacklist / whitelist / freeze, trading
 * toggle, cooldown, max-wallet / max-transaction limits, proxy /
 * upgradeability / initializer, selfdestruct, delegatecall, `immutable`
 * state, and any overridden transfer hook.
 *
 * INITIAL_SUPPLY is `constant`, not `immutable`, and the contract declares no
 * `immutable` state, so the deployed runtime bytecode stays independent of the
 * constructor argument and is pinned by hash in the frozen manifest.
 */
contract PepeCartelToken is ERC20 {
    error ZeroTreasury();

    /// Permanently fixed supply: exactly 1,000,000,000 PCART at 18 decimals.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    constructor(address treasury_) ERC20("PEPECARTEL", "PCART") {
        if (treasury_ == address(0)) revert ZeroTreasury();
        _mint(treasury_, INITIAL_SUPPLY);
    }
}
