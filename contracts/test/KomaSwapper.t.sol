// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {KomaSwapper} from "../src/KomaSwapper.sol";

contract KomaSwapperTest is LaunchpadFixture {
    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    uint256 traderPk = 0x7AD3;
    address trader;

    function setUp() public override {
        super.setUp();
        trader = vm.addr(traderPk);
        (id, curve, coin) = _launch(0, 25e6, 300);
        _pastSnipe();
        _complete(curve);
        curve.graduate();
    }

    function test_BuyAndSellThroughPool() public {
        _fund(trader, 10e6);
        vm.startPrank(trader);
        usdc.approve(address(swapper), 10e6);
        vm.expectEmit(true, true, true, false, address(swapper));
        emit KomaSwapper.Swapped(id, trader, trader, true, 10e6, 0);
        uint256 coins = swapper.swapExactIn(id, true, 10e6, 1, trader);
        assertEq(coin.balanceOf(trader), coins);
        assertEq(usdc.balanceOf(trader), 0);

        coin.approve(address(swapper), coins);
        uint256 back = swapper.swapExactIn(id, false, coins, 1, trader);
        vm.stopPrank();
        assertEq(usdc.balanceOf(trader), back);
        assertEq(coin.balanceOf(trader), 0);
        // two 0.3% fees plus price impact, never a profit
        assertLt(back, 10e6);
        assertGt(back, 9.9e6);
        assertEq(usdc.balanceOf(address(swapper)), 0);
        assertEq(coin.balanceOf(address(swapper)), 0);
    }

    function test_SwapToOtherRecipient() public {
        address friend = makeAddr("friend");
        _fund(trader, 1e6);
        vm.startPrank(trader);
        usdc.approve(address(swapper), 1e6);
        uint256 coins = swapper.swapExactIn(id, true, 1e6, 0, friend);
        vm.stopPrank();
        assertEq(coin.balanceOf(friend), coins);
    }

    function test_RevertWhen_Slippage() public {
        _fund(trader, 1e6);
        vm.startPrank(trader);
        usdc.approve(address(swapper), 1e6);
        vm.expectPartialRevert(KomaSwapper.Slippage.selector);
        swapper.swapExactIn(id, true, 1e6, type(uint256).max, trader);
        vm.stopPrank();
    }

    function test_RevertWhen_NotGraduated() public {
        (uint256 id2,,) = _launch(0, 25e6, 300);
        vm.expectRevert(abi.encodeWithSelector(KomaSwapper.NotGraduated.selector, id2));
        swapper.swapExactIn(id2, true, 1e6, 0, trader);
    }

    function test_RevertWhen_BadInputs() public {
        vm.expectRevert(KomaSwapper.ZeroAmount.selector);
        swapper.swapExactIn(id, true, 0, 0, trader);
        vm.expectRevert(KomaSwapper.ZeroAddress.selector);
        swapper.swapExactIn(id, true, 1, 0, address(0));
    }

    function test_RevertWhen_UnlockCallbackNotPoolManager() public {
        vm.expectRevert(abi.encodeWithSelector(KomaSwapper.Unauthorized.selector, address(this)));
        swapper.unlockCallback("");
    }

    function _authSwap(uint256 usdcIn, uint256 minOut, uint256 deadline, bytes32 salt)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 nonce =
            keccak256(abi.encode(keccak256("KOMA_SWAP_V1"), address(swapper), trader, id, usdcIn, minOut, deadline, salt));
        assertEq(nonce, swapper.swapNonce(trader, id, usdcIn, minOut, deadline, salt));
        return _signReceive(traderPk, address(swapper), usdcIn, 0, block.timestamp + 1 hours, nonce);
    }

    function test_SwapWithAuthorization() public {
        _fund(trader, 5e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authSwap(5e6, 1, deadline, "s");
        vm.prank(relayer);
        uint256 coins = swapper.swapWithAuthorization(trader, id, 5e6, 1, deadline, "s", 0, block.timestamp + 1 hours, v, r, s);
        assertGt(coins, 0);
        assertEq(coin.balanceOf(trader), coins);
        assertEq(usdc.balanceOf(trader), 0);
    }

    function test_RevertWhen_SwapAuthorizationTampered() public {
        _fund(trader, 5e6);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authSwap(5e6, 1e30, deadline, "s");
        vm.expectRevert("FiatTokenV2: invalid signature");
        swapper.swapWithAuthorization(trader, id, 5e6, 0, deadline, "s", 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_RevertWhen_SwapAuthorizationExpired() public {
        uint256 deadline = block.timestamp - 1;
        vm.expectRevert(abi.encodeWithSelector(KomaSwapper.Expired.selector, deadline));
        swapper.swapWithAuthorization(trader, id, 5e6, 0, deadline, "s", 0, block.timestamp + 1 hours, 0, 0, 0);
    }
}
