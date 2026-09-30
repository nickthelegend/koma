// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurveMathReference} from "../src/CurveMathReference.sol";

contract CurveMathReferenceTest is Test {
    CurveMathReference math;
    uint256 constant U0 = 1_000e6;
    uint256 constant C0 = 1_000_000_000e18;

    function setUp() public {
        math = new CurveMathReference();
    }

    function test_QuoteBuyKnownValue() public view {
        // 100 USDC on a fresh curve: 1e27 - ceil(1e36 / 1.1e9)
        uint256 expected = C0 - (U0 * C0 + 1_100e6 - 1) / 1_100e6;
        assertEq(math.quoteBuy(U0, C0, 100e6), expected);
        assertEq(expected, 90_909_090_909_090_909_090_909_090); // floor for the buyer
    }

    function test_QuoteSellKnownValue() public view {
        // Selling 1e26 coins into a curve at (1100e6, 1e27): 1100e6 - ceil(1.1e36 / 1.1e27) = 100e6
        assertEq(math.quoteSell(1_100e6, C0, 1e26), 1_100e6 - 1_000_000_000);
        // Non-exact division rounds against the seller.
        assertEq(math.quoteSell(3, 7, 2), 3 - 3); // ceil(21/9) = 3
        assertEq(math.quoteSell(10, 10, 3), 10 - 8); // ceil(100/13) = 8
    }

    function test_BuyRoundsAgainstBuyer() public view {
        // k = 21, vU + u = 4 -> ceil(21/4) = 6 -> coinOut = 1 (exact would be 1.75)
        assertEq(math.quoteBuy(3, 7, 1), 1);
    }

    function test_ZeroInputIsZeroOutput() public view {
        assertEq(math.quoteBuy(U0, C0, 0), 0);
        assertEq(math.quoteSell(U0, C0, 0), 0);
    }

    function test_UsdcToReach() public view {
        assertEq(math.usdcToReach(U0, C0, U0 + 25e6), 25e6);
        assertEq(math.usdcToReach(U0, C0, U0), 0);
    }

    function test_RevertWhen_TargetBelowReserve() public {
        vm.expectRevert(abi.encodeWithSelector(CurveMathReference.TargetBelowReserve.selector, U0, U0 - 1));
        math.usdcToReach(U0, C0, U0 - 1);
    }

    function test_SpotPrice() public view {
        // Literal spec formula vU * 1e18 / vC: $1,000 / 1B coins = 1 raw USDC unit per whole coin.
        assertEq(math.spotPrice(U0, C0), 1);
        assertEq(math.spotPrice(6_000e6, C0 / 6), 36); // 36 raw units per coin after a 5k raise
        assertEq(math.spotPrice(U0, 1e18), U0);
    }

    function test_RevertWhen_ZeroReserves() public {
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.quoteBuy(0, C0, 1);
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.quoteBuy(U0, 0, 1);
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.quoteSell(0, C0, 1);
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.quoteSell(U0, 0, 1);
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.spotPrice(U0, 0);
        vm.expectRevert(CurveMathReference.ZeroReserve.selector);
        math.usdcToReach(0, C0, 1);
    }

    /// Exactness of the ceiling: the new reserve is the smallest that keeps the product >= vU*vC.
    function testFuzz_QuoteBuyIsExactCeil(uint256 vU, uint256 vC, uint256 u) public view {
        vU = bound(vU, 1, 1e15);
        vC = bound(vC, 1, 1e30);
        u = bound(u, 0, 1e15);
        uint256 out = math.quoteBuy(vU, vC, u);
        uint256 newVC = vC - out;
        assertGe((vU + u) * newVC, vU * vC);
        if (newVC > 0) assertLt((vU + u) * (newVC - 1), vU * vC);
    }

    function testFuzz_QuoteSellIsExactCeil(uint256 vU, uint256 vC, uint256 c) public view {
        vU = bound(vU, 1, 1e15);
        vC = bound(vC, 1, 1e30);
        c = bound(c, 0, 1e30);
        uint256 out = math.quoteSell(vU, vC, c);
        uint256 newVU = vU - out;
        assertGe(newVU * (vC + c), vU * vC);
        if (newVU > 0) assertLt((newVU - 1) * (vC + c), vU * vC);
    }

    function testFuzz_BuyThenSellNeverProfits(uint256 u) public view {
        u = bound(u, 1, 1e13);
        uint256 out = math.quoteBuy(U0, C0, u);
        uint256 back = math.quoteSell(U0 + u, C0 - out, out);
        assertLe(back, u);
    }
}
