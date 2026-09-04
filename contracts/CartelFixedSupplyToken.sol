// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * C8.3 — CARTEL HQ restricted fixed-supply test token.
 *
 * TESTNET ONLY (Robinhood Chain Testnet, chain id 46630).
 *
 * This contract deliberately contains NOTHING beyond the OpenZeppelin ERC20
 * reference implementation:
 *   - no Ownable / AccessControl / roles, so no privileged account exists
 *     after deployment;
 *   - no mint function of any kind: the entire supply is minted exactly once
 *     inside the constructor and can never be increased;
 *   - no burn/capped/pausable/permit extension, no proxy or upgrade path;
 *   - no transfer tax, fee-on-transfer, blacklist, whitelist, freeze,
 *     cooldown, trading toggle, max-wallet or max-transaction logic;
 *   - no hooks overridden, no selfdestruct, no delegatecall;
 *   - no `immutable` state, so the deployed runtime bytecode is independent
 *     of the constructor arguments and can be pinned by hash.
 *
 * decimals() is the ERC20 default of 18 and is not overridden.
 */
contract CartelFixedSupplyToken is ERC20 {
    error ZeroRecipient();
    error ZeroSupply();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address recipient_
    ) ERC20(name_, symbol_) {
        if (recipient_ == address(0)) revert ZeroRecipient();
        if (totalSupply_ == 0) revert ZeroSupply();
        _mint(recipient_, totalSupply_);
    }
}
