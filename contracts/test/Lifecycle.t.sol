// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract LifecycleTest is LaunchpadFixture {
    using StateLibrary for *;

    function test_LaunchBuyGraduateSwap() public {
        (uint256 id, BondingCurve curve, SeriesCoin coin) = _launch(0, 25e6, 300);
        _pastSnipe();
        _complete(curve);
        assertEq(curve.raised(), 25e6);
        bytes32 poolId = curve.graduate();
        PoolKey memory key = graduator.poolKeyOf(id);
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
        assertGt(sqrtP, 0);
        assertEq(IERC721(address(positionManager)).ownerOf(1), DEAD);
        assertEq(usdc.balanceOf(address(curve)), 0);
        assertEq(coin.balanceOf(address(curve)), 0);
        assertEq(usdc.balanceOf(address(graduator)), 0);
        assertEq(coin.balanceOf(address(graduator)), 0);
        key;

        address trader = makeAddr("trader");
        _fund(trader, 10e6);
        vm.startPrank(trader);
        usdc.approve(address(swapper), 10e6);
        uint256 coinsOut = swapper.swapExactIn(id, true, 10e6, 1, trader);
        coin.approve(address(swapper), coinsOut);
        uint256 usdcBack = swapper.swapExactIn(id, false, coinsOut, 1, trader);
        vm.stopPrank();
        assertGt(coinsOut, 0);
        assertLt(usdcBack, 10e6);
        assertGt(usdcBack, 9.9e6);
    }
}
