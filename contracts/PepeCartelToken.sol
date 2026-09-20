// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * PCART-L2 DRAFT CANDIDATE — PEPECARTEL ($PCART).
 *
 * STATUS: DRAFT PCART-L2 CANDIDATE / NOT COMPILED / NOT FROZEN /
 *         NOT ALLOWLISTED / NOT DEPLOYABLE WHILE PCART-L1 IS OPEN.
 *
 * This file exists solely for source-level review and static regression
 * testing during PCART-L1. It is NOT compiled by this repository, NO frozen
 * artifact has been produced from it, NO artifact id (`pepecartel-token-v1`)
 * has been created or allowlisted, and NO database, launcher, verifier or
 * runtime path references it. The only production-allowlisted artifact
 * remains `cartel-fixed-erc20-v1` (contracts/CartelFixedSupplyToken.sol).
 *
 * Deployment of this source to any network — testnet or mainnet — is
 * prohibited until PCART-L1 is explicitly closed and PCART-L2 is separately
 * authorized. See docs/PCART_L2_TOKEN_SPECIFICATION.md and
 * docs/PCART_MASTER_LAUNCH_PLAN.md.
 *
 * Frozen V1 token behavior mirrored here:
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
 * constructor argument and can be pinned by hash in PCART-L2.
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
