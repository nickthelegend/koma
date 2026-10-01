// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Test.sol";
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
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {CircleUSDC} from "./utils/CircleUSDC.sol";

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
            hooks: IHooks(address(graduator))
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

        uint256 fee = 1.25e6; // 5% of the 25 USDC raised
        vm.expectEmit(true, false, false, true, address(graduator));
        emit Graduator.GraduationFee(id, fee);
        vm.expectEmit(false, false, false, false, address(graduator));
        emit Graduator.PoolCreated(id, bytes32(0), 0, 0, 0, 0);
        bytes32 poolId = curve.graduate();

        assertEq(poolId, PoolId.unwrap(_key().toId()));
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
        PoolKey memory stored = graduator.poolKeyOf(id);
        assertEq(PoolId.unwrap(stored.toId()), poolId);

        // Coins are the abundant side at a $25 raise: after the 1.25 USDC fee the LP gets all 23.75 USDC and
        // 23.75/P coins, the rest is burned.
        uint256 coinsToPool = FullMath.mulDiv(25e6 - fee, vC, vU);
        assertApproxEqAbs(usdc.balanceOf(address(poolManager)), 25e6 - fee, 1);
        assertApproxEqRel(coin.balanceOf(address(poolManager)), coinsToPool, 1e12);
        assertApproxEqAbs(coin.balanceOf(DEAD), coinsLeft - coinsToPool, 1e18);
        uint256 toTreasury = usdc.balanceOf(treasury) - treasuryBefore;
        assertGe(toTreasury, fee);
        assertLe(toTreasury, fee + 1); // fee + mint dust
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
        uint256 fee = 250e6; // 5% of 5,000
        assertLt(value, 5_000e6 - fee);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        big.graduate();
        // fee + the USDC the coins could not match
        assertApproxEqAbs(usdc.balanceOf(treasury) - treasuryBefore, fee + (5_000e6 - fee - value), 2);
        assertApproxEqAbs(bigCoin.balanceOf(address(poolManager)), coinsLeft, 1e9);
        assertLt(bigCoin.balanceOf(DEAD), 1e9);
    }

    function test_GraduationFeeConstant() public view {
        assertEq(graduator.GRADUATION_FEE_BPS(), 500);
    }

    /// Any target: exactly 5% of the USDC raised goes to the treasury as the fee, the pool opens at the
    /// curve's final price, and every USDC unit is accounted for (fee + pool + surplus == raised).
    function testFuzz_GraduationFeeAndPoolPrice(uint256 target) public {
        // 19,000 USDC (the max target) sells every curve coin, leaving nothing to pair: see the report note.
        target = bound(target, 1e6, 15_666e6);
        (uint256 sid, BondingCurve c, SeriesCoin sc) = _launch(0, target, 0);
        _pastSnipe();
        _complete(c);
        assertEq(c.raised(), target);
        uint160 want = _curveSqrtPrice(c, sc);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        (uint256 seenFee, uint160 sqrtLogged, uint256 usdcToPool) = _graduateAndDecode(c, sid);
        uint256 fee = target * 500 / 10_000;
        assertEq(seenFee, fee, "fee event");

        // pool price == curve final price
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(poolManager, graduator.poolKeyOf(sid).toId());
        assertEq(sqrtP, want, "pool price");
        assertEq(sqrtLogged, want);

        // treasury gets the fee plus whatever the LP could not use; nothing is left behind
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, target - usdcToPool, "treasury");
        assertLe(usdcToPool, target - fee);
        assertEq(usdc.balanceOf(address(graduator)), 0);
        assertEq(sc.balanceOf(address(graduator)), 0);
    }

    function _curveSqrtPrice(BondingCurve c, SeriesCoin sc) internal view returns (uint160) {
        (uint256 vU, uint256 vC,,,,,) = c.state();
        return address(usdc) < address(sc)
            ? uint160(Math.sqrt(FullMath.mulDiv(vC, 1 << 192, vU)))
            : uint160(Math.sqrt(FullMath.mulDiv(vU, 1 << 192, vC)));
    }

    function _graduateAndDecode(BondingCurve c, uint256 sid)
        internal
        returns (uint256 fee, uint160 sqrtLogged, uint256 usdcToPool)
    {
        fee = type(uint256).max;
        vm.recordLogs();
        c.graduate();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(graduator)) continue;
            if (logs[i].topics[0] == Graduator.GraduationFee.selector) {
                assertEq(uint256(logs[i].topics[1]), sid);
                fee = abi.decode(logs[i].data, (uint256));
            } else if (logs[i].topics[0] == Graduator.PoolCreated.selector) {
                (, sqrtLogged, usdcToPool,,) = abi.decode(logs[i].data, (bytes32, uint160, uint256, uint256, uint256));
            }
        }
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

    // ------------------------------------------------------------------ pool squatting (AUDIT.md H-1)

    /// Nobody but the Graduator can create the series pool: before graduation, at any price, from anyone.
    function test_RevertWhen_SomeoneElseInitializesThePool() public {
        uint160 target = _targetSqrtPrice(); // launch price; the pool is created at the final price below
        uint160[3] memory prices = [target, target * 3, target / 3];
        for (uint256 i; i < prices.length; i++) {
            vm.prank(makeAddr("squatter"));
            vm.expectRevert(
                abi.encodeWithSelector(
                    CustomRevert.WrappedError.selector,
                    address(graduator),
                    IHooks.beforeInitialize.selector,
                    abi.encodeWithSelector(Graduator.Unauthorized.selector, makeAddr("squatter")),
                    abi.encodeWithSelector(Hooks.HookCallFailed.selector)
                )
            );
            poolManager.initialize(_key(), prices[i]);
        }
        // ...and the uninitialized pool accepts no liquidity, swaps or donations meanwhile.
        vm.expectRevert();
        poolManager.donate(_key(), 1, 1, "");
        _complete(curve);
        target = _targetSqrtPrice();
        curve.graduate();
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
    }

    function test_RevertWhen_HookCalledDirectly() public {
        vm.expectRevert(abi.encodeWithSelector(Graduator.Unauthorized.selector, address(this)));
        graduator.beforeInitialize(address(this), _key(), 1 << 96);
        vm.prank(address(poolManager));
        vm.expectRevert(abi.encodeWithSelector(Graduator.Unauthorized.selector, address(this)));
        graduator.beforeInitialize(address(this), _key(), 1 << 96);
    }

    /// The constructor refuses any address that does not carry exactly the BEFORE_INITIALIZE flag.
    function test_RevertWhen_GraduatorAddressHasWrongHookFlags() public {
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, address(0x1234)));
        deployCodeTo(
            "Graduator.sol:Graduator",
            abi.encode(admin, address(poolManager), address(positionManager), permit2, address(usdc), treasury),
            address(0x1234)
        );
        address wrong = address(uint160(GRADUATOR_AT) | uint160(Hooks.BEFORE_SWAP_FLAG));
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, wrong));
        deployCodeTo(
            "Graduator.sol:Graduator",
            abi.encode(admin, address(poolManager), address(positionManager), permit2, address(usdc), treasury),
            wrong
        );
    }

    /// The H-1 proof of concept, before the fix: squat the hookless key at 1000x the price and park 1,500 one-unit
    /// USDC bids between that price and the curve price (pre-fix graduation then needed ~37.8M gas, above
    /// Arbitrum's 32M per-tx limit), plus a bid wall bigger than every curve coin (pre-fix: revert). The
    /// graduation pool uses the Graduator hook, so the squatted key is irrelevant and graduation is cheap.
    function test_SquattedHooklessKeyCannotBlockGraduation() public {
        _complete(curve);
        uint160 target = _targetSqrtPrice();
        bool usdcIs0 = address(usdc) < address(coin);
        PoolKey memory squat = _key();
        squat.hooks = IHooks(address(0));
        uint160 bad = usdcIs0 ? target / 1000 : target * 1000;
        poolManager.initialize(squat, bad);
        int24 tBad = TickMath.getTickAtSqrtPrice(bad);
        int24 tTarget = TickMath.getTickAtSqrtPrice(target);
        (int24 lo, int24 hi) = usdcIs0 ? (_align(tBad) + 60, _align(tTarget)) : (_align(tTarget) + 60, _align(tBad));
        _fund(address(this), 1_000_000e6);
        usdc.approve(permit2, type(uint256).max);
        IAllowanceTransfer(permit2).approve(address(usdc), address(positionManager), type(uint160).max, type(uint48).max);
        uint256 n;
        for (int24 a = lo; a + 60 <= hi && n < 1500; a += 60) {
            _mintSquat(squat, a, a + 60, 1, usdcIs0);
            n++;
        }
        _mintSquat(squat, lo, hi, 900_000e6, usdcIs0);
        assertEq(n, 1500);

        uint256 g = gasleft();
        curve.graduate();
        assertLt(g - gasleft(), 2_000_000, "graduation gas stays bounded");
        (uint160 sqrtP,) = _slot0();
        assertEq(sqrtP, target);
        assertGt(StateLibrary.getLiquidity(poolManager, _key().toId()), 0);
    }

    function _mintSquat(PoolKey memory key, int24 lo, int24 hi, uint256 amount, bool usdcIs0) internal {
        uint160 a = TickMath.getSqrtPriceAtTick(lo);
        uint160 b = TickMath.getSqrtPriceAtTick(hi);
        uint128 liq = usdcIs0
            ? LiquidityAmounts.getLiquidityForAmount0(a, b, amount)
            : LiquidityAmounts.getLiquidityForAmount1(a, b, amount);
        if (liq == 0) liq = 1;
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lo, hi, liq, type(uint128).max, type(uint128).max, address(this), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params),
            block.timestamp
        );
    }

    // ------------------------------------------------------------------ USDC blacklist (AUDIT.md M-1)

    /// A blacklisted treasury cannot block graduation: the fee and surplus are parked in `treasuryOwed`,
    /// excluded from the pool, and flushed to the treasury once Circle lifts the blacklist.
    function test_BlacklistedTreasuryDoesNotBlockGraduation() public {
        (, BondingCurve big, SeriesCoin bigCoin) = _launch(0, 0, 0); // $5,000: fee + USDC surplus
        _pastSnipe();
        _complete(big);
        (uint256 vU, uint256 vC,,,,,) = big.state();
        uint256 coinsLeft = bigCoin.balanceOf(address(big));
        uint256 value = FullMath.mulDiv(coinsLeft, vU, vC);
        CircleUSDC.blacklist(treasury);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        big.graduate();
        uint256 owed = graduator.treasuryOwed();
        assertApproxEqAbs(owed, 5_000e6 - value, 2, "fee + surplus parked");
        assertEq(usdc.balanceOf(address(graduator)), owed, "only the owed USDC stays");
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        assertGt(StateLibrary.getLiquidity(poolManager, graduator.poolKeyOf(2).toId()), 0);

        vm.expectRevert(); // still blacklisted
        graduator.flushTreasury();
        CircleUSDC.unBlacklist(treasury);
        vm.expectEmit(address(graduator));
        emit Graduator.TreasuryFlushed(owed);
        graduator.flushTreasury();
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, owed);
        assertEq(graduator.treasuryOwed(), 0);
        assertEq(usdc.balanceOf(address(graduator)), 0);
        vm.expectRevert(Graduator.NothingOwed.selector);
        graduator.flushTreasury();
    }

    /// Owed USDC from one graduation is never spent on the next series' pool.
    function test_OwedTreasuryUsdcIsNotPooledByLaterGraduations() public {
        CircleUSDC.blacklist(treasury);
        _complete(curve);
        curve.graduate();
        uint256 owed = graduator.treasuryOwed();
        assertGe(owed, 1.25e6);
        CircleUSDC.unBlacklist(treasury);

        (uint256 id2, BondingCurve c2,) = _launch(0, 25e6, 0);
        _pastSnipe();
        _complete(c2);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        (uint256 fee,, uint256 usdcToPool) = _graduateAndDecode(c2, id2);
        assertEq(fee, 1.25e6);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 25e6 - usdcToPool, "second series paid in full");
        assertEq(graduator.treasuryOwed(), owed, "first series' debt untouched");
        assertEq(usdc.balanceOf(address(graduator)), owed);
    }

    function _align(int24 t) internal pure returns (int24) {
        int24 a = (t / 60) * 60;
        if (t < 0 && t % 60 != 0) a -= 60;
        return a;
    }
}
