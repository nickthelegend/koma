// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {Graduator} from "../src/Graduator.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

contract GraduatorTest is LaunchpadFixture {
    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;

    function setUp() public override {
        super.setUp();
        (id, curve, coin) = _launch(0, 25e6, 300);
        _pastSnipe();
    }

    function _key() internal view returns (PoolKey memory key) {
        bool usdcIs0 = address(usdc) < address(coin);
        key = PoolKey({
            currency0: Currency.wrap(usdcIs0 ? address(usdc) : address(coin)),
            currency1: Currency.wrap(usdcIs0 ? address(coin) : address(usdc)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _targetSqrtPrice() internal view returns (uint160) {
        (uint256 vU, uint256 vC,,,,,) = curve.state();
        return address(usdc) < address(coin)
            ? uint160(Math.sqrt(FullMath.mulDiv(vC, 1 << 192, vU)))
            : uint160(Math.sqrt(FullMath.mulDiv(vU, 1 << 192, vC)));
    }

    function _slot0() internal view returns (uint160 sqrtP, int24 tick) {
        (sqrtP, tick,,) = StateLibrary.getSlot0(poolManager, _key().toId());
    }

    function test_GraduatesIntoV4AtCurvePrice() public {
        _complete(curve);
        (uint256 vU, uint256 vC,,,,,) = curve.state();
        uint256 coinsLeft = coin.balanceOf(address(curve));
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint160 target = _targetSqrtPrice();

        vm.expectEmit(false, false, false, false, address(graduator));
        emit Graduator.PoolCreated(id, bytes32(0), 0, 0, 0, 0);
        bytes32 poolId = curve.graduate();

        assertEq(poolId, PoolId.unwrap(_key().toId()));
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
        PoolKey memory stored = graduator.poolKeyOf(id);
        assertEq(PoolId.unwrap(stored.toId()), poolId);

        // Coins are the abundant side at a $25 raise: LP gets all 25 USDC and 25/P coins, the rest is burned.
        uint256 coinsToPool = FullMath.mulDiv(25e6, vC, vU);
        assertApproxEqAbs(usdc.balanceOf(address(poolManager)), 25e6, 1);
        assertApproxEqRel(coin.balanceOf(address(poolManager)), coinsToPool, 1e12);
        assertApproxEqAbs(coin.balanceOf(DEAD), coinsLeft - coinsToPool, 1e18);
        assertLe(usdc.balanceOf(treasury) - treasuryBefore, 1);
        assertEq(IERC721(address(positionManager)).ownerOf(1), DEAD);
        assertGt(StateLibrary.getLiquidity(poolManager, _key().toId()), 0);
    }

    function test_SurplusUsdcGoesToTreasury() public {
        // At the default $5,000 target the ~117M coins left are worth less than the USDC raised, so the LP gets
        // every coin plus their value in USDC and the rest of the USDC goes to the treasury.
        (, BondingCurve big, SeriesCoin bigCoin) = _launch(0, 0, 0);
        _pastSnipe();
        _complete(big);
        (uint256 vU, uint256 vC,,,,,) = big.state();
        uint256 coinsLeft = bigCoin.balanceOf(address(big));
        uint256 value = FullMath.mulDiv(coinsLeft, vU, vC);
        assertLt(value, 5_000e6);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        big.graduate();
        assertApproxEqAbs(usdc.balanceOf(treasury) - treasuryBefore, 5_000e6 - value, 2);
        assertApproxEqAbs(bigCoin.balanceOf(address(poolManager)), coinsLeft, 1e9);
        assertLt(bigCoin.balanceOf(DEAD), 1e9);
    }

    function test_RevertWhen_NotRegisteredCurve() public {
        vm.expectRevert(abi.encodeWithSelector(Graduator.Unauthorized.selector, address(this)));
        graduator.graduate(id, address(coin), 1, 1, 1, 1);
    }

    function test_RevertWhen_GraduatedTwiceViaGraduator() public {
        _complete(curve);
        curve.graduate();
        vm.prank(address(curve));
        vm.expectRevert(abi.encodeWithSelector(Graduator.AlreadyGraduated.selector, id));
        graduator.graduate(id, address(coin), 1, 1, 1, 1);
    }

    function test_RevertWhen_RegisterCurveNotFactory() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), graduator.FACTORY_ROLE()
            )
        );
        graduator.registerCurve(99, address(1));
    }

    function test_RevertWhen_CurveRegisteredTwice() public {
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(Graduator.CurveAlreadyRegistered.selector, id));
        graduator.registerCurve(id, address(1));
    }

    function test_RevertWhen_UnlockCallbackNotPoolManager() public {
        vm.expectRevert(abi.encodeWithSelector(Graduator.Unauthorized.selector, address(this)));
        graduator.unlockCallback("");
    }

    // ------------------------------------------------------------------ pool squatting

    function test_SquattedPoolAbovePriceIsCorrected() public {
        _squatAndGraduate(4);
    }

    function test_SquattedPoolBelowPriceIsCorrected() public {
        _squatAndGraduate(-4);
    }

    function _squatAndGraduate(int256 direction) internal {
        _complete(curve);
        uint160 target = _targetSqrtPrice();
        uint160 bad = direction > 0 ? target * uint160(uint256(direction)) : target / uint160(uint256(-direction));
        poolManager.initialize(_key(), bad);

        vm.expectEmit(true, false, false, false, address(graduator));
        emit Graduator.PoolPriceCorrected(id, bad, target);
        curve.graduate();
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
        assertEq(IERC721(address(positionManager)).ownerOf(1), DEAD);
    }

    /// A squatter initializes the pool with the coin overpriced and parks USDC-only liquidity between that
    /// price and the curve's price. The correction swap sells coins into it (at or above the curve price)
    /// and the pool still ends at the curve price.
    function test_SquatterUsdcLiquidityIsSoldIntoNotAbused() public {
        _complete(curve);
        uint160 target = _targetSqrtPrice();
        bool usdcIs0 = address(usdc) < address(coin);
        // coin overpriced: coin-per-USDC low (usdc token0) or USDC-per-coin high (usdc token1)
        uint160 bad = usdcIs0 ? target / 3 : target * 3;
        poolManager.initialize(_key(), bad);
        int24 tBad = TickMath.getTickAtSqrtPrice(bad);
        int24 tTarget = TickMath.getTickAtSqrtPrice(target);
        (int24 lo, int24 hi) = usdcIs0 ? (_align(tBad) + 60, _align(tTarget)) : (_align(tTarget) + 60, _align(tBad));

        address squatter = makeAddr("squatter");
        _fund(squatter, 1_000e6);
        vm.startPrank(squatter);
        usdc.approve(permit2, type(uint256).max);
        IAllowanceTransfer(permit2).approve(address(usdc), address(positionManager), type(uint160).max, type(uint48).max);
        uint128 liq = usdcIs0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), 1_000e6)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), 1_000e6);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(_key(), lo, hi, liq, type(uint128).max, type(uint128).max, squatter, bytes(""));
        params[1] = abi.encode(_key().currency0, _key().currency1);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params),
            block.timestamp
        );
        vm.stopPrank();
        uint256 pmUsdcBefore = usdc.balanceOf(address(poolManager));
        assertGt(pmUsdcBefore, 990e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        curve.graduate();
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
        // The graduator bought the squatter's USDC with coins; the extra USDC went to the treasury.
        assertGt(usdc.balanceOf(treasury) - treasuryBefore, 900e6);
    }

    function _align(int24 t) internal pure returns (int24) {
        int24 a = (t / 60) * 60;
        if (t < 0 && t % 60 != 0) a -= 60;
        return a;
    }
}
