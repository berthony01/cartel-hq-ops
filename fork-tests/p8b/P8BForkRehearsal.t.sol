// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// P8B-1 FORK PROOF GATE — LOCAL IN-MEMORY FORK ONLY. NO MAINNET WRITES.
// Uses ONLY deterministic local test keys. Never real owner keys.

import "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {MigratorParameters, PoolParameters, LiquidityAllocationBracket} from "../../src/libraries/MigratorParams.sol";
import {PositionDefinition} from "../../src/types/PositionPlannerTypes.sol";
import {Distribution} from "../../src/types/Distribution.sol";

struct AuctionParameters {
    address currency;
    address tokensRecipient;
    address fundsRecipient;
    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock;
    uint256 tickSpacing;
    address validationHook;
    uint256 floorPrice;
    uint128 requiredCurrencyRaised;
    bytes auctionStepsData;
}

interface IERC20x {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function approve(address, uint256) external returns (bool);
}
interface ISafe {
    function setup(address[] calldata, uint256, address, bytes calldata, address, address, uint256, address) external;
    function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes memory signatures) external payable returns (bool);
    function getTransactionHash(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) external view returns (bytes32);
    function nonce() external view returns (uint256);
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function VERSION() external view returns (string memory);
}
interface ISafeFactory { function createProxyWithNonce(address, bytes memory, uint256) external returns (address); }
interface IPermit2 { function approve(address token, address spender, uint160 amount, uint48 expiration) external; }
interface ILauncher {
    function multicall(bytes[] calldata) external payable returns (bytes[] memory);
    function depositToken(address token, uint160 amount) external payable;
    function distributeToken(address token, Distribution calldata d, bytes32 salt) external payable;
}
interface IMultiSend { function multiSend(bytes memory) external payable; }
interface ICCA {
    function submitBid(uint256 maxPrice, uint128 amount, address owner, bytes calldata hookData) external payable returns (uint256);
    function exitBid(uint256) external;
    function claimTokens(uint256) external;
    function sweepUnsoldTokens() external;
    function isGraduated() external view returns (bool);
    function currencyRaised() external view returns (uint256);
    function totalCleared() external view returns (uint256);
    function endBlock() external view returns (uint64);
    function tokensRecipient() external view returns (address);
    function fundsRecipient() external view returns (address);
    function clearingPrice() external view returns (uint256);
    function checkpoint() external;
}
interface ILBP {
    function migrate(address) external;
    event InitializerCreated(address indexed initializer, MigratorParameters migrationParams);
}
interface IPosM {
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256) external view returns (address);
    function transferFrom(address, address, uint256) external;
}
interface IFactoryFee { function protocolFeeController() external view returns (address); }

/// Fork-only shim: Robinhood Chain (Arbitrum Orbit) ArbSys precompile is not emulated by the local EVM.
/// Live: arbBlockNumber() == L2 block.number (measured). Shim returns block.number.
contract ArbSysShim { function arbBlockNumber() external view returns (uint256) { return block.number; } }

contract P8BForkRehearsal is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 constant FORK_BLOCK = 82592963;
    address constant REAL_SAFE = 0xE0d055B3E07c2D1d9C1762Ca9e19b3062207ad03;
    address constant LAUNCHER = 0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0;
    address constant LBP = 0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000;
    address constant HOOK = 0x5fB5229FBA341dFE5a7e6A14d4809D6Cf887a000;
    address constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address constant FEE_SPLITTER = 0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant POSM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant POOLM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant SAFE_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant FALLBACK = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address constant MULTISEND_CALLONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;

    uint256 constant E18 = 1e18;
    uint128 constant AUCTION = 150_000_000 * 1e18;
    uint128 constant LP_RESERVE = 200_000_000 * 1e18;
    uint256 constant FUTURE = 150_000_000 * 1e18;
    uint128 constant DEPOSIT = AUCTION + LP_RESERVE;
    uint64 constant DURATION_BLOCKS = 5_885_000; // 7d at measured 0.10277 s/block
    // P8B v1 LOCKED price params: starting token price floor = 10 ETH / 150M PCART; tick = 1% of floor.
    uint256 constant TICK = 52818775009509558395;
    uint256 constant FLOOR = 5281877500950955839500; // == TICK * 100
    // Release: 60% evenly over 5,884,999 blocks (daily-balanced) + 40% in the final block.
    bytes constant RELEASE_60LIN_40FINAL = hex"00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93da00000200000040313d09000000000001"; // 15 steps

    uint256[3] pks = [uint256(0xA11CE1), uint256(0xA11CE2), uint256(0xA11CE3)];
    ISafe safe;
    IERC20x token;
    address cca;
    uint64 startBlock;
    uint256 safeEth0;
    uint256 safeTok0;
    uint256 pmEth0;
    uint256 pmTok0;
    uint256 ccaEth0;
    uint256 nft0;
    uint256 gross;
    uint256 swept;
    uint256 lpEth;
    uint256 trEth;
    uint256 lpTok;
    uint256 retTok;
    uint256 sold;
    uint256 nft1;
    uint256 safeTok1;
    uint256 unsold;
    uint256 claimed;
    uint256 futureHeld;

    function setUp() public {
        string memory rpc = vm.envString("ROBINHOOD_MAINNET_RPC_URL");
        vm.createSelectFork(rpc, FORK_BLOCK); // local in-memory fork; nothing is broadcast
        require(block.chainid == 4663, "CHAIN");
        vm.etch(address(100), address(new ArbSysShim()).code);
    }

    // ---------------------------------------------------------------- helpers
    function _owners() internal view returns (address[] memory o) {
        o = new address[](3);
        for (uint256 i; i < 3; i++) o[i] = vm.addr(pks[i]);
    }

    function _sigs(bytes32 h, uint256 n) internal view returns (bytes memory s) {
        // sort selected signers ascending by address (Safe requirement)
        address[] memory a = new address[](n);
        uint256[] memory k = new uint256[](n);
        for (uint256 i; i < n; i++) { a[i] = vm.addr(pks[i]); k[i] = pks[i]; }
        for (uint256 i; i < n; i++) for (uint256 j = i + 1; j < n; j++) if (a[j] < a[i]) {
            (a[i], a[j]) = (a[j], a[i]); (k[i], k[j]) = (k[j], k[i]);
        }
        for (uint256 i; i < n; i++) { (uint8 v, bytes32 r, bytes32 ss) = vm.sign(k[i], h); s = abi.encodePacked(s, r, ss, v); }
    }

    function _exec(string memory label, address to, uint256 value, bytes memory data, uint8 op) internal returns (bytes32 h) {
        uint256 n = safe.nonce();
        h = safe.getTransactionHash(to, value, data, op, 0, 0, 0, address(0), address(0), n);
        // one signature must fail
        bytes memory one = _sigs(h, 1);
        vm.expectRevert();
        safe.execTransaction(to, value, data, op, 0, 0, 0, address(0), payable(address(0)), one);
        // two signatures succeed
        bool ok = safe.execTransaction(to, value, data, op, 0, 0, 0, address(0), payable(address(0)), _sigs(h, 2));
        require(ok, "SAFE_EXEC");
        assertEq(safe.nonce(), n + 1);
        console.log("SAFE_TX", label);
        console.log("  nonce", n);
        console.log("  to", to);
        console.log("  operation", op);
        console.log("  value", value);
        console.log("  dataKeccak");
        console.logBytes32(keccak256(data));
        console.log("  safeTxHash");
        console.logBytes32(h);
    }

    function _deploySafeAndToken() internal {
        bytes memory init = abi.encodeCall(ISafe.setup, (_owners(), 2, address(0), "", FALLBACK, address(0), 0, address(0)));
        safe = ISafe(ISafeFactory(SAFE_FACTORY).createProxyWithNonce(SAFE_SINGLETON, init, uint256(keccak256("PCART-P8B-FORK-REHEARSAL"))));
        assertEq(safe.VERSION(), "1.4.1");
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);

        bytes memory creation = vm.parseBytes(vm.readFile("script/pcart.creation.hex"));
        assertEq(keccak256(creation), 0x2edebe9de5877c0775dc87644ca9051a54034f4eee8bd9662c7657d0fd3c2196);
        bytes memory code = abi.encodePacked(creation, abi.encode(address(safe)));
        address t;
        assembly { t := create(0, add(code, 0x20), mload(code)) }
        require(t != address(0), "TOKEN");
        token = IERC20x(t);
        assertEq(keccak256(t.code), 0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4);
        assertEq(token.name(), "PEPECARTEL");
        assertEq(token.symbol(), "PCART");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 * E18);
        assertEq(token.balanceOf(address(safe)), 1_000_000_000 * E18);
        console.log("FORK_REHEARSAL_TOKEN (NOT OFFICIAL)", t);
        console.log("REHEARSAL_SAFE", address(safe));
    }

    function _steps() internal pure returns (bytes memory) { return RELEASE_60LIN_40FINAL; }

    function _schedule() internal pure returns (bytes memory) {
        LiquidityAllocationBracket[] memory b = new LiquidityAllocationBracket[](3);
        b[0] = LiquidityAllocationBracket(0, 8_000_000);
        b[1] = LiquidityAllocationBracket(10 ether, 6_000_000);
        b[2] = LiquidityAllocationBracket(30 ether, 5_000_000);
        return abi.encode(b);
    }

    function _launch() internal returns (MigratorParameters memory mp) {
        startBlock = uint64(block.number + 10);
        uint64 endBlock = startBlock + DURATION_BLOCKS;
        AuctionParameters memory ap = AuctionParameters({
            currency: address(0),
            tokensRecipient: address(safe),
            fundsRecipient: address(1), // MSG_SENDER => LBPStrategy (required)
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock,
            tickSpacing: TICK,
            validationHook: address(0),
            floorPrice: FLOOR,
            requiredCurrencyRaised: 5 ether,
            auctionStepsData: _steps()
        });
        mp = MigratorParameters({
            token: address(token),
            currency: address(0),
            migrationBlock: endBlock + 1,
            reservedTokenAmountForLP: LP_RESERVE,
            recipient: address(safe),
            positionRecipient: FEE_SPLITTER,
            poolParameters: PoolParameters({fee: 2500, tickSpacing: 50, hook: HOOK}),
            positionDefinitions: abi.encode(new PositionDefinition[](0)),
            lpAllocationSchedule: _schedule()
        });
        bytes memory configData = abi.encode(mp, abi.encode(ap));

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ILauncher.depositToken, (address(token), uint160(DEPOSIT)));
        calls[1] = abi.encodeCall(ILauncher.distributeToken, (address(token), Distribution(LBP, DEPOSIT, configData), keccak256("PCART-LAUNCH")));
        bytes memory c1 = abi.encodeCall(IERC20x.approve, (PERMIT2, DEPOSIT));
        bytes memory c2 = abi.encodeCall(IPermit2.approve, (address(token), LAUNCHER, uint160(DEPOSIT), uint48(block.timestamp + 1 days)));
        bytes memory c3 = abi.encodeCall(ILauncher.multicall, (calls));
        bytes memory packed = abi.encodePacked(
            abi.encodePacked(uint8(0), address(token), uint256(0), c1.length, c1),
            abi.encodePacked(uint8(0), PERMIT2, uint256(0), c2.length, c2),
            abi.encodePacked(uint8(0), LAUNCHER, uint256(0), c3.length, c3)
        );
        console.log("PREP_START_BLOCK", startBlock);
        console.log("PREP_PERMIT2_EXPIRATION", block.timestamp + 1 days);
        console.log("PREP_TOKEN", address(token));
        console.log("PREP_SAFE", address(safe));
        vm.recordLogs();
        _exec("PRE_AUCTION_1_OF_1 MultiSendCallOnly[approve Permit2; Permit2.approve launcher; launcher.multicall(deposit,distribute)]",
            MULTISEND_CALLONLY, 0, abi.encodeCall(IMultiSend.multiSend, (packed)), 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == LBP && logs[i].topics[0] == ILBP.InitializerCreated.selector) cca = address(uint160(uint256(logs[i].topics[1])));
        }
        require(cca != address(0), "CCA_NOT_FOUND");
        assertEq(token.balanceOf(cca), AUCTION);
        assertEq(token.balanceOf(LBP), LP_RESERVE);
        assertEq(token.balanceOf(address(safe)), 1_000_000_000 * E18 - DEPOSIT);
        assertEq(ICCA(cca).tokensRecipient(), address(safe));
        assertEq(ICCA(cca).fundsRecipient(), LBP);
        assertEq(ICCA(cca).endBlock() - startBlock, DURATION_BLOCKS);
        console.log("CCA", cca);
    }

    function _bid(uint256 i, uint128 amt) internal returns (uint256 id) {
        address b = vm.addr(0xB1D000 + i);
        vm.deal(b, amt);
        vm.prank(b);
        id = ICCA(cca).submitBid{value: amt}(FLOOR * 20, amt, b, "");
    }

    function _exitAndClaim(uint256[3] memory ids) internal returns (uint256 claimed) {
        for (uint256 i; i < 3; i++) {
            address b = vm.addr(0xB1D001 + i);
            uint256 e0 = b.balance;
            ICCA(cca).exitBid(ids[i]);
            ICCA(cca).claimTokens(ids[i]);
            claimed += token.balanceOf(b);
            console.log("BIDDER_REFUND_WEI", b.balance - e0);
        }
    }

    // ---------------------------------------------------------------- gate tests
    function test_attestRealSafeReadOnly() public view {
        assertEq(ISafe(REAL_SAFE).VERSION(), "1.4.1");
        assertEq(ISafe(REAL_SAFE).getThreshold(), 2);
        assertEq(ISafe(REAL_SAFE).nonce(), 0);
        assertEq(keccak256(REAL_SAFE.code), 0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c);
        assertEq(IFactoryFee(CCA_FACTORY).protocolFeeController(), address(0));
    }

    function test_success30Eth() public {
        _deploySafeAndToken();
        MigratorParameters memory mp = _launch();
        vm.roll(startBlock);
        uint256[3] memory ids;
        ids[0] = _bid(1, 10 ether);
        vm.roll(startBlock + DURATION_BLOCKS / 100); // later bid accepted
        ids[1] = _bid(2, 12 ether);
        vm.roll(startBlock + DURATION_BLOCKS / 50);  // later bid accepted
        ids[2] = _bid(3, 8 ether);
        vm.roll(startBlock + DURATION_BLOCKS);       // end block
        vm.expectRevert();
        _bid(4, 1 ether);                            // bids closed at end
        vm.roll(mp.migrationBlock);

        safeEth0 = address(safe).balance;
        safeTok0 = token.balanceOf(address(safe));
        pmEth0 = POOLM.balance;
        pmTok0 = token.balanceOf(POOLM);
        ccaEth0 = cca.balance;
        nft0 = IPosM(POSM).nextTokenId();

        ILBP(LBP).migrate(cca); // permissionless, no prior explicit checkpoint
        assertTrue(ICCA(cca).isGraduated());

        gross = ICCA(cca).currencyRaised();
        swept = ccaEth0 - cca.balance;
        lpEth = POOLM.balance - pmEth0;
        trEth = address(safe).balance - safeEth0;
        lpTok = token.balanceOf(POOLM) - pmTok0;
        retTok = token.balanceOf(address(safe)) - safeTok0;
        sold = ICCA(cca).totalCleared();
        console.log("GROSS_RAISED_WEI", gross);
        console.log("SWEPT_TO_STRATEGY_WEI", swept);
        console.log("PROTOCOL_FEE_WEI", gross - swept);
        console.log("LP_ETH_WEI", lpEth);
        console.log("TREASURY_ETH_WEI", trEth);
        console.log("TOKENS_SOLD", sold);
        console.log("LP_TOKENS_CONSUMED", lpTok);
        console.log("LP_RESERVE_RETURNED", retTok);
        console.log("CLEARING_PRICE_Q96", ICCA(cca).clearingPrice());

        // LP custody
        nft1 = IPosM(POSM).nextTokenId();
        assertEq(nft1 - nft0, 1, "ONE_POSITION");
        assertEq(IPosM(POSM).ownerOf(nft0), FEE_SPLITTER);
        vm.prank(address(safe));
        vm.expectRevert();
        IPosM(POSM).transferFrom(FEE_SPLITTER, address(safe), nft0);
        console.log("LP_NFT_ID", nft0);

        // pool fee
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 2500, 50, IHooks(HOOK));
        (uint160 sp,,, uint24 lpFee) = IPoolManager(POOLM).getSlot0(key.toId());
        assertGt(sp, 0);
        assertEq(lpFee, 2500);

        // unsold: explicit Safe sweep required
        safeTok1 = token.balanceOf(address(safe));
        _exec("POST_AUCTION_1_OF_1 CCA.sweepUnsoldTokens", cca, 0, abi.encodeCall(ICCA.sweepUnsoldTokens, ()), 0);
        unsold = token.balanceOf(address(safe)) - safeTok1;
        console.log("UNSOLD_SWEPT_TO_SAFE", unsold);

        claimed = _exitAndClaim(ids);
        console.log("TOKENS_CLAIMED_BY_BIDDERS", claimed);

        futureHeld = token.balanceOf(address(safe));
        console.log("SAFE_PCART_END", futureHeld);
        // exact accounting
        assertApproxEqAbs(gross, 30 ether, 1, "GROSS_WITHIN_1_WEI");
        console.log("CCA_ETH_DUST_LEFT", cca.balance);
        console.log("CCA_PCART_DUST_LEFT", token.balanceOf(cca));
        assertApproxEqAbs(lpEth, 20 ether, 1, "LP_20");
        assertEq(trEth, 10 ether, "TREASURY_10");
        assertEq(gross - swept, 0, "NO_PROTOCOL_FEE");
        assertEq(lpEth + trEth, swept, "ETH_CONSERVED");
        assertEq(lpTok + retTok, LP_RESERVE, "RESERVE_CONSERVED");
        assertEq(claimed + unsold + token.balanceOf(cca), AUCTION, "AUCTION_CONSERVED"); assertLe(token.balanceOf(cca), 10);
        assertGe(futureHeld, 1_000_000_000 * E18 - DEPOSIT, "NON_LAUNCH_650M_INCL_FUTURE_150M_UNTOUCHED");
        assertEq(token.balanceOf(LBP), 0);
    }

    function test_belowFloor4Eth() public {
        _deploySafeAndToken();
        MigratorParameters memory mp = _launch();
        vm.roll(startBlock);
        uint256 id1 = _bid(1, 3 ether);
        uint256 id2 = _bid(2, 1 ether);
        vm.roll(mp.migrationBlock);
        uint256 safeEth0 = address(safe).balance;
        uint256 safeTok0 = token.balanceOf(address(safe));
        uint256 nft0 = IPosM(POSM).nextTokenId();
        ILBP(LBP).migrate(cca); // permissionless; fails internally -> recovery
        assertFalse(ICCA(cca).isGraduated());
        assertEq(IPosM(POSM).nextTokenId(), nft0, "NO_POSITION");
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 2500, 50, IHooks(HOOK));
        (uint160 sp,,,) = IPoolManager(POOLM).getSlot0(key.toId());
        assertEq(sp, 0, "NO_POOL");
        assertEq(address(safe).balance - safeEth0, 0, "TREASURY_KEEPS_NOTHING");
        assertEq(token.balanceOf(address(safe)) - safeTok0, LP_RESERVE, "RESERVE_RETURNED");
        console.log("BELOW_FLOOR_RESERVE_RETURNED", uint256(LP_RESERVE));

        uint256 t1 = token.balanceOf(address(safe));
        _exec("POST_AUCTION_FAIL CCA.sweepUnsoldTokens", cca, 0, abi.encodeCall(ICCA.sweepUnsoldTokens, ()), 0);
        assertEq(token.balanceOf(address(safe)) - t1, AUCTION, "ALL_AUCTION_RETURNED");
        assertEq(token.balanceOf(address(safe)), 1_000_000_000 * E18, "SAFE_WHOLE");

        address b1 = vm.addr(0xB1D001);
        address b2 = vm.addr(0xB1D002);
        ICCA(cca).exitBid(id1);
        ICCA(cca).exitBid(id2);
        assertEq(b1.balance, 3 ether, "REFUND1");
        assertEq(b2.balance, 1 ether, "REFUND2");
        vm.expectRevert();
        ICCA(cca).claimTokens(id1);
        assertEq(cca.balance, 0);
        console.log("BELOW_FLOOR_REFUNDS_WEI", b1.balance + b2.balance);
    }
}
