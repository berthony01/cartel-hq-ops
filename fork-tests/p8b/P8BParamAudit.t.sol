// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
// P8B PARAMETER AUDIT — LOCAL IN-MEMORY FORK ONLY. NO MAINNET WRITES. Local test keys only.
import "./P8BForkRehearsal.t.sol";

contract P8BParamAudit is P8BForkRehearsal {
    bytes constant S1_UNIFORM_DAILY = hex"000001000003dbb9000002000008f851000001000003dbb9000002000008f851000001000003dbb9000002000008f851000001000003dbb9000002000008f851000001000003dbb9000002000008f851000001000003dbb9000002000008f851000001000003dbba000002000008f852"; // 14 steps
    bytes constant S2_FRONT_2THEN1 = hex"00000200003eca3800000100001b0210"; // 2 steps
    bytes constant S3_MILD_60_40 = hex"00000200002b24ec000003000001c13800000100001cc34800000200001022dc"; // 4 steps
    bytes constant S4_UNI_60LIN_40FINAL = hex"00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93de000002000000402c00000100000c93da00000200000040313d09000000000001"; // 15 steps
    bytes constant S5_75LIN_25FINAL = hex"0000010000094ed0000002000003853a0000010000094ed0000002000003853a0000010000094ed0000002000003853a0000010000094ed0000002000003853a0000010000094ed0000002000003853a0000010000094ed0000002000003853a0000010000094ece000002000003853d2625a00000000001"; // 15 steps
    uint256 constant Q96 = 1 << 96;
    struct Sc { uint256 floorRaise; uint256 n; uint8 sched; uint256 demand; uint8 timing; bool sensitive; }
    struct Res { uint256 gross; uint256 sold; uint256 clear; uint256 lpEth; uint256 trEth; uint256 lpTok; uint256 maxClear; uint256 failedBids; uint256 partialExits; uint256 effEarlyX; uint256 effLateX; uint256 migGas; bool grad; }

    function _stepsOf(uint8 s) internal pure returns (bytes memory) {
        if (s == 1) return S1_UNIFORM_DAILY; if (s == 2) return S2_FRONT_2THEN1; if (s == 3) return S3_MILD_60_40;
        if (s == 4) return S4_UNI_60LIN_40FINAL; return S5_75LIN_25FINAL;
    }

    function _launchP(uint256 floorQ, uint256 tickQ, bytes memory steps) internal returns (uint64 mig) {
        startBlock = uint64(block.number + 10);
        uint64 endBlock = startBlock + DURATION_BLOCKS;
        AuctionParameters memory ap = AuctionParameters(address(0), address(safe), address(1), startBlock, endBlock, endBlock, tickQ, address(0), floorQ, 5 ether, steps);
        MigratorParameters memory mp = MigratorParameters({token: address(token), currency: address(0), migrationBlock: endBlock + 1,
            reservedTokenAmountForLP: LP_RESERVE, recipient: address(safe), positionRecipient: FEE_SPLITTER,
            poolParameters: PoolParameters({fee: 2500, tickSpacing: 50, hook: HOOK}), positionDefinitions: abi.encode(new PositionDefinition[](0)), lpAllocationSchedule: _schedule()});
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ILauncher.depositToken, (address(token), uint160(DEPOSIT)));
        calls[1] = abi.encodeCall(ILauncher.distributeToken, (address(token), Distribution(LBP, DEPOSIT, abi.encode(mp, abi.encode(ap))), keccak256("PCART-LAUNCH")));
        bytes memory c1 = abi.encodeCall(IERC20x.approve, (PERMIT2, DEPOSIT));
        bytes memory c2 = abi.encodeCall(IPermit2.approve, (address(token), LAUNCHER, uint160(DEPOSIT), uint48(block.timestamp + 1 days)));
        bytes memory c3 = abi.encodeCall(ILauncher.multicall, (calls));
        bytes memory packed = abi.encodePacked(abi.encodePacked(uint8(0), address(token), uint256(0), c1.length, c1),
            abi.encodePacked(uint8(0), PERMIT2, uint256(0), c2.length, c2), abi.encodePacked(uint8(0), LAUNCHER, uint256(0), c3.length, c3));
        vm.recordLogs();
        uint256 n = safe.nonce();
        bytes memory data = abi.encodeCall(IMultiSend.multiSend, (packed));
        bytes32 h = safe.getTransactionHash(MULTISEND_CALLONLY, 0, data, 1, 0, 0, 0, address(0), address(0), n);
        require(safe.execTransaction(MULTISEND_CALLONLY, 0, data, 1, 0, 0, 0, address(0), payable(address(0)), _sigs(h, 2)));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        cca = address(0);
        for (uint256 i; i < logs.length; i++) if (logs[i].emitter == LBP && logs[i].topics[0] == ILBP.InitializerCreated.selector) cca = address(uint160(uint256(logs[i].topics[1])));
        require(cca != address(0) && token.balanceOf(cca) == AUCTION, "LAUNCH");
        mig = endBlock + 1;
    }

    // bid plan: returns offsets (blocks from start) and amounts; group = 0 early half, 1 late half
    function _plan(Sc memory s) internal pure returns (uint64[] memory off, uint128[] memory amt, uint256[] memory maxMul100) {
        uint256 k = s.timing == 4 ? 40 : (s.sensitive ? 30 : 10);
        off = new uint64[](k); amt = new uint128[](k); maxMul100 = new uint256[](k);
        uint64 D = DURATION_BLOCKS;
        for (uint256 i; i < k; i++) {
            amt[i] = uint128(s.demand / k);
            maxMul100[i] = s.sensitive ? 100 + (i * 7 * 100) / 30 * 1 + 1 : 2000; // sensitive: 1.01x..~3x floor, else 20x
            if (s.timing == 0) off[i] = uint64(1 + i);                                  // EARLY
            else if (s.timing == 1 || s.timing == 4) off[i] = uint64(1 + (D - 200) * i / k); // EVEN / MANY_SMALL
            else if (s.timing == 2) off[i] = uint64(D - D / 14 + (D / 14 - 200) * i / k);     // LATE: last 12h
            else { // ONE_LARGE_LATE: 9 even bidders = 50%, final bidder 50% ~100 blocks before end
                if (i < k - 1) { off[i] = uint64(1 + (D - 200) * i / (k - 1)); amt[i] = uint128(s.demand / 2 / (k - 1)); }
                else { off[i] = D - 100; amt[i] = uint128(s.demand / 2); }
            }
        }
        if (s.sensitive) { // shuffle bid order deterministically so prices arrive mixed
            for (uint256 i; i < k; i++) { uint256 j = uint256(keccak256(abi.encode(i))) % k; (maxMul100[i], maxMul100[j]) = (maxMul100[j], maxMul100[i]); }
        }
    }

    uint64[] pOff; uint128[] pAmt; uint256[] pMm; uint256[] pIds; bool[] pOk;
    uint256 curFloor; uint256 curTick;

    function _bids(Res memory r) internal {
        uint64 nextDay = DURATION_BLOCKS / 7;
        for (uint256 i; i < pOff.length; i++) {
            while (nextDay < pOff[i]) { vm.roll(startBlock + nextDay); ICCA(cca).checkpoint(); _samp(r); nextDay += DURATION_BLOCKS / 7; }
            vm.roll(startBlock + pOff[i]);
            address b = vm.addr(0xB1D000 + 1 + i);
            uint128 a = pAmt[i];
            vm.deal(b, a);
            uint256 mp = (curFloor * pMm[i] / 100) / curTick * curTick;
            vm.prank(b);
            try ICCA(cca).submitBid{value: a}(mp, a, b, "") returns (uint256 id) { pIds.push(id); pOk.push(true); } catch { pIds.push(0); pOk.push(false); r.failedBids++; }
            _samp(r);
        }
    }
    function _samp(Res memory r) internal view { uint256 c = ICCA(cca).clearingPrice(); if (c > r.maxClear) r.maxClear = c; }

    function _run(Sc memory s) internal returns (Res memory r) {
        uint256 snap = vm.snapshotState();
        curTick = s.floorRaise * Q96 / (uint256(AUCTION) * s.n);
        curFloor = curTick * s.n;
        uint64 mig = _launchP(curFloor, curTick, _stepsOf(s.sched));
        (uint64[] memory off, uint128[] memory amt, uint256[] memory mm) = _plan(s);
        pOff = off; pAmt = amt; pMm = mm; delete pIds; delete pOk;
        _bids(r);
        vm.roll(startBlock + DURATION_BLOCKS); ICCA(cca).checkpoint();
        vm.roll(mig);
        _migrate(r);
        _exits(s, r);
        _log(s, r, curFloor);
        vm.revertToState(snap);
    }
    function _migrate(Res memory r) internal {
        uint256 se = address(safe).balance; uint256 pe = POOLM.balance; uint256 pt = token.balanceOf(POOLM);
        uint256 g0 = gasleft(); ILBP(LBP).migrate(cca); r.migGas = g0 - gasleft();
        r.grad = ICCA(cca).isGraduated(); r.gross = ICCA(cca).currencyRaised(); r.sold = r.grad ? ICCA(cca).totalCleared() : 0;
        r.clear = ICCA(cca).clearingPrice(); r.lpEth = POOLM.balance - pe; r.trEth = address(safe).balance - se; r.lpTok = token.balanceOf(POOLM) - pt;
    }

    function _exits(Sc memory s, Res memory r) internal {
        uint256[4] memory acc; uint256 half = s.timing == 3 ? pOff.length - 1 : pOff.length / 2;
        for (uint256 i; i < pOff.length; i++) {
            if (!pOk[i]) continue;
            address b = vm.addr(0xB1D000 + 1 + i);
            uint256 e0 = b.balance; uint256 t0 = token.balanceOf(b);
            try ICCA(cca).exitBid(pIds[i]) {} catch { r.partialExits++; continue; }
            if (r.grad) { try ICCA(cca).claimTokens(pIds[i]) {} catch {} }
            uint256 g = i < half ? 0 : 2;
            acc[g] += pAmt[i] - (b.balance - e0); acc[g + 1] += token.balanceOf(b) - t0;
        }
        r.effEarlyX = acc[1] == 0 ? 0 : acc[0] * 1e18 / acc[1];
        r.effLateX = acc[3] == 0 ? 0 : acc[2] * 1e18 / acc[3];
    }

    function _log(Sc memory s, Res memory r, uint256 floorQ) internal pure {
        console.log(string.concat("ROW,", vm.toString(s.floorRaise / 1e15), ",", vm.toString(s.n), ",S", vm.toString(s.sched), ",", vm.toString(s.demand / 1e15), ",T", vm.toString(s.timing), s.sensitive ? ",SENS" : ",FLAT"));
        console.log(string.concat("  ,", vm.toString(r.gross), ",", vm.toString(r.sold), ",", vm.toString(r.clear), ",", vm.toString(floorQ), ",", vm.toString(r.maxClear)));
        console.log(string.concat("  ,", vm.toString(r.lpEth), ",", vm.toString(r.trEth), ",", vm.toString(r.lpTok), ",", vm.toString(r.failedBids), ",", vm.toString(r.partialExits)));
        console.log(string.concat("  ,", vm.toString(r.effEarlyX), ",", vm.toString(r.effLateX), ",", vm.toString(r.migGas), r.grad ? ",GRAD" : ",NOGRAD"));
    }

    function _base() internal { _deploySafeAndToken(); }
    uint256[6] FLOORS = [uint256(5 ether), 10 ether, 15 ether, 20 ether, 30 ether, 37.5 ether];
    uint256[4] DEM = [uint256(4 ether), 15 ether, 30 ether, 50 ether];

    function _floorRow(uint256 fi) internal { _base(); for (uint256 d; d < 4; d++) _run(Sc(FLOORS[fi], 100, 4, DEM[d], 1, false)); }
    function test_F0() public { _floorRow(0); } function test_F1() public { _floorRow(1); } function test_F2() public { _floorRow(2); }
    function test_F3() public { _floorRow(3); } function test_F4() public { _floorRow(4); } function test_F5() public { _floorRow(5); }

    function _schedRow(uint8 sc, uint256 floorRaise) internal { _base(); for (uint8 t; t < 5; t++) for (uint256 d = 1; d < 4; d++) _run(Sc(floorRaise, 100, sc, DEM[d], t, false)); }
    function test_S1() public { _schedRow(1, 10 ether); } function test_S2() public { _schedRow(2, 10 ether); } function test_S3() public { _schedRow(3, 10 ether); }
    function test_S4() public { _schedRow(4, 10 ether); } function test_S5() public { _schedRow(5, 10 ether); }

    function _stepRow(uint256 n) internal { _base(); for (uint256 d = 1; d < 4; d += 2) { _run(Sc(10 ether, n, 4, DEM[d], 1, true)); _run(Sc(10 ether, n, 4, DEM[d], 2, true)); } }
    function test_K1bp() public { _stepRow(10000); } function test_K1pct() public { _stepRow(100); } function test_K10pct() public { _stepRow(10); }
}
