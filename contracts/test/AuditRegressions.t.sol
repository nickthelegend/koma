// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Test.sol";
import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {CircleUSDC} from "./utils/CircleUSDC.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";

/// Regression tests for contracts/AUDIT.md, on real Circle USDC (blacklist / pause are Circle's own code).
contract AuditRegressionsTest is LaunchpadFixture {
    uint256 parentId;
    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    address account;
    address parentAccount;
    address trader = makeAddr("trader");

    function setUp() public override {
        super.setUp();
        (parentId,,) = _launch(0, 0, 0);
        (id, curve, coin) = _launch(parentId, 0, 0); // a remix: its fees also pay the parent's character
        account = factory.series(id).characterAccount;
        parentAccount = factory.series(parentId).characterAccount;
        _pastSnipe();
    }

    // ------------------------------------------------------------------ fees (AUDIT.md I-1)

    /// Fee = ceil(1.5%) of the USDC side; 40% own character, 20% remix pool (parent pool/2, rest to own
    /// character), 40% treasury. Nobody else is paid and the router keeps nothing.
    function test_FeeRecipientsAreExactlyCharacterAncestorTreasury() public {
        uint256 tBefore = usdc.balanceOf(treasury);
        vm.recordLogs();
        _buy(curve, trader, 100e6); // fee 1.5 USDC: char 0.6, pool 0.3 (parent 0.15), treasury 0.6
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(usdc.balanceOf(account), 0.6e6 + 0.15e6);
        assertEq(usdc.balanceOf(parentAccount), 0.15e6);
        assertEq(usdc.balanceOf(treasury) - tBefore, 0.6e6);
        assertEq(usdc.balanceOf(address(router)), 0);
        uint256 routed;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(router) || logs[i].topics[0] != IRoyaltyRouter.Routed.selector) continue;
            address to = address(uint160(uint256(logs[i].topics[2])));
            assertTrue(to == account || to == parentAccount || to == treasury, "unexpected fee recipient");
            (uint256 amount,) = abi.decode(logs[i].data, (uint256, uint8));
            routed += amount;
        }
        assertEq(routed, 1.5e6);
    }

    // ------------------------------------------------------------------ USDC blacklist (AUDIT.md M-1)

    function test_BlacklistedCharacterAccountDoesNotBlockTrading() public {
        _expectDeferredTrading(account);
    }

    function test_BlacklistedAncestorAccountDoesNotBlockRemixTrading() public {
        _expectDeferredTrading(parentAccount);
    }

    function test_BlacklistedTreasuryDoesNotBlockTrading() public {
        _expectDeferredTrading(treasury);
    }

    function _expectDeferredTrading(address blocked) internal {
        CircleUSDC.blacklist(blocked);
        // buy: the fee is parked, the trader still gets every coin quoted
        _fund(trader, 100e6);
        vm.startPrank(trader);
        usdc.approve(address(curve), 100e6);
        (uint256 quoted,,) = curve.quoteBuy(100e6);
        vm.expectEmit(address(curve));
        emit BondingCurve.FeeRoutingDeferred(1.5e6);
        uint256 got = curve.buy(100e6, quoted, trader);
        assertEq(got, quoted);
        // sell: the trader can always exit
        (uint256 usdcOut, uint256 sellFee) = curve.quoteSell(got);
        coin.approve(address(curve), got);
        assertEq(curve.sell(got, usdcOut, trader), usdcOut);
        vm.stopPrank();
        assertEq(usdc.balanceOf(trader), usdcOut);
        assertEq(curve.unroutedFees(), 1.5e6 + sellFee);
        // reserves are untouched by the parked fees
        assertEq(usdc.balanceOf(address(curve)), curve.raised() + curve.unroutedFees());

        vm.expectRevert(); // still blacklisted: flushing fails loudly, nothing moves
        curve.flushFees();
        CircleUSDC.unBlacklist(blocked);
        uint256 before = usdc.balanceOf(blocked);
        vm.expectEmit(address(curve));
        emit BondingCurve.FeesFlushed(1.5e6 + sellFee);
        curve.flushFees();
        assertEq(curve.unroutedFees(), 0);
        assertGt(usdc.balanceOf(blocked), before, "the blocked recipient is paid once unblocked");
        assertEq(usdc.balanceOf(address(curve)), curve.raised());
        vm.expectRevert(BondingCurve.ZeroAmount.selector);
        curve.flushFees();
    }

    /// Parked fees never go to the pool: graduation hands over exactly the reserves.
    function test_GraduationExcludesUnroutedFees() public {
        (, BondingCurve small,) = _launch(0, 25e6, 0);
        _pastSnipe();
        address smallAccount = factory.series(small.seriesId()).characterAccount;
        CircleUSDC.blacklist(smallAccount);
        _complete(small);
        uint256 parked = small.unroutedFees();
        assertGt(parked, 0);
        small.graduate();
        assertEq(usdc.balanceOf(address(small)), parked, "only the parked fees stay");
        CircleUSDC.unBlacklist(smallAccount);
        small.flushFees(); // still routable after graduation
        assertEq(usdc.balanceOf(address(small)), 0);
    }

    function test_RevertWhen_PushFeeCalledExternally() public {
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.Unauthorized.selector, address(this)));
        curve.pushFee(1);
    }

    /// A caller cannot pick a gas limit that makes routing run out of gas while the trade itself succeeds:
    /// at every gas limit the buy either reverts or routes its fee.
    function test_GasGriefingCannotForceFeeDeferral() public {
        _fund(trader, 1_000e6);
        vm.prank(trader);
        usdc.approve(address(curve), type(uint256).max);
        bytes memory call = abi.encodeCall(BondingCurve.buy, (1e6, 0, trader));
        uint256 succeeded;
        uint256 deferredAt;
        for (uint256 g = 100_000; g < 1_500_000; g += 2_500) {
            uint256 snap = vm.snapshotState();
            vm.prank(trader);
            (bool ok,) = address(curve).call{gas: g}(call);
            if (ok) {
                succeeded++;
                if (curve.unroutedFees() != 0 && deferredAt == 0) deferredAt = g;
            }
            vm.revertToState(snap);
        }
        assertEq(deferredAt, 0, "fee deferred by gas starvation");
        assertGt(succeeded, 0);
    }

    // ------------------------------------------------------------------ USDC pause (AUDIT.md I-8)

    /// Circle pausing USDC halts trading and graduation atomically (no partial state); unpausing resumes.
    function test_UsdcPauseHaltsAndResumes() public {
        uint256 held = _buy(curve, trader, 10e6);
        CircleUSDC.pause();
        vm.startPrank(trader);
        coin.approve(address(curve), held);
        vm.expectRevert();
        curve.sell(held, 0, trader);
        vm.stopPrank();
        assertEq(coin.balanceOf(trader), held);
        assertEq(curve.unroutedFees(), 0);
        CircleUSDC.unpause();
        vm.prank(trader);
        assertGt(curve.sell(held, 0, trader), 0);
    }
}
