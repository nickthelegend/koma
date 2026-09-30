// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {LaunchpadConstants as C} from "./libraries/LaunchpadConstants.sol";

/// @title KOMA graduator
/// @notice Turns a completed curve into a Uniswap v4 USDC/coin pool (fee 0.3%, tick spacing 60, no hooks)
///         priced at the curve's final price `vU / vC`. Liquidity is full-range and its position NFT is sent
///         to 0x…dEaD, so the pool can never be rugged. Whatever does not fit at that price is not dumped:
///         surplus USDC goes to the treasury and surplus coins are burned.
/// @dev Pool squatting: the pool key is predictable, so anyone can `initialize` it first at a bad price.
///      SeriesCoin refuses transfers into the PoolManager until graduation, so a squatted pool can hold at
///      most USDC. Before minting, the graduator swaps the pool back to the target price: through empty
///      ticks that is free, and through squatter USDC it only ever sells coins at or above the curve price.
contract Graduator is AccessControl, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    uint24 public constant POOL_FEE = 3000;
    int24 public constant TICK_SPACING = 60;
    // forge-lint: disable-next-line(divide-before-multiply)
    int24 internal constant TICK_LOWER = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
    // forge-lint: disable-next-line(divide-before-multiply)
    int24 internal constant TICK_UPPER = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    address public immutable usdc;
    address public immutable treasury;

    mapping(uint256 seriesId => address) public curveOf;
    mapping(uint256 seriesId => PoolKey) private _poolKeys;

    event CurveRegistered(uint256 indexed seriesId, address curve);
    event PoolCreated(
        uint256 indexed seriesId,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        uint256 usdcToPool,
        uint256 coinToPool,
        uint256 liquidity
    );
    event PoolPriceCorrected(uint256 indexed seriesId, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96);

    error ZeroAddress();
    error Unauthorized(address caller);
    error CurveAlreadyRegistered(uint256 seriesId);
    error AlreadyGraduated(uint256 seriesId);
    error PriceOutOfRange(uint160 sqrtPriceX96);

    constructor(
        address admin,
        address poolManager_,
        address positionManager_,
        address permit2_,
        address usdc_,
        address treasury_
    ) {
        if (
            poolManager_ == address(0) || positionManager_ == address(0) || permit2_ == address(0)
                || usdc_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        poolManager = IPoolManager(poolManager_);
        positionManager = IPositionManager(positionManager_);
        permit2 = IAllowanceTransfer(permit2_);
        usdc = usdc_;
        treasury = treasury_;
    }

    function registerCurve(uint256 seriesId, address curve) external onlyRole(FACTORY_ROLE) {
        if (curve == address(0)) revert ZeroAddress();
        if (curveOf[seriesId] != address(0)) revert CurveAlreadyRegistered(seriesId);
        curveOf[seriesId] = curve;
        emit CurveRegistered(seriesId, curve);
    }

    function poolKeyOf(uint256 seriesId) external view returns (PoolKey memory) {
        return _poolKeys[seriesId];
    }

    /// @notice Called by the series' curve after it transferred `usdcAmount` USDC and `coinAmount` coins here.
    function graduate(uint256 seriesId, address coin, uint256 usdcAmount, uint256 coinAmount, uint256 vU, uint256 vC)
        external
        returns (bytes32 poolId, uint256 usdcToPool, uint256 coinToPool)
    {
        if (msg.sender != curveOf[seriesId] || msg.sender == address(0)) revert Unauthorized(msg.sender);
        if (_poolKeys[seriesId].tickSpacing != 0) revert AlreadyGraduated(seriesId);

        // Use as much of both sides as fits at P = vU / vC.
        (usdcToPool, coinToPool) = _lpAmounts(usdcAmount, coinAmount, vU, vC);

        bool usdcIs0 = usdc < coin;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdcIs0 ? usdc : coin),
            currency1: Currency.wrap(usdcIs0 ? coin : usdc),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        _poolKeys[seriesId] = key;
        poolId = PoolId.unwrap(key.toId());

        // price = token1 / token0 in raw units
        uint160 sqrtPriceX96 = _preparePool(seriesId, key, usdcIs0 ? _sqrtPriceX96(vC, vU) : _sqrtPriceX96(vU, vC));
        uint128 liquidity;
        (usdcToPool, coinToPool, liquidity) = _provide(key, usdcIs0, sqrtPriceX96, usdcToPool, coinToPool);

        _sweep(coin);
        emit PoolCreated(seriesId, poolId, sqrtPriceX96, usdcToPool, coinToPool, liquidity);
    }

    /// @dev LP gets all of the scarcer side and the matching amount of the other at P = vU / vC.
    function _lpAmounts(uint256 usdcAmount, uint256 coinAmount, uint256 vU, uint256 vC)
        private
        pure
        returns (uint256 usdcToPool, uint256 coinToPool)
    {
        uint256 coinValue = FullMath.mulDiv(coinAmount, vU, vC);
        if (usdcAmount > coinValue) return (coinValue, coinAmount);
        return (usdcAmount, FullMath.mulDiv(usdcAmount, vC, vU));
    }

    /// @dev Surplus: USDC to the treasury, coins burned.
    function _sweep(address coin) private {
        uint256 left = IERC20(usdc).balanceOf(address(this));
        if (left != 0) IERC20(usdc).safeTransfer(treasury, left);
        left = IERC20(coin).balanceOf(address(this));
        if (left != 0) IERC20(coin).safeTransfer(C.DEAD, left);
    }

    /// @dev Initializes the pool at `target`, or swaps a squatted pool back to it. Returns the pool's price.
    function _preparePool(uint256 seriesId, PoolKey memory key, uint160 target) private returns (uint160) {
        if (target <= TickMath.getSqrtPriceAtTick(TICK_LOWER) || target >= TickMath.getSqrtPriceAtTick(TICK_UPPER)) {
            revert PriceOutOfRange(target);
        }
        (uint160 current,,,) = poolManager.getSlot0(key.toId());
        if (current == 0) {
            poolManager.initialize(key, target);
            return target;
        }
        if (current == target) return target;
        _correctPrice(key, current, target);
        (uint160 corrected,,,) = poolManager.getSlot0(key.toId());
        emit PoolPriceCorrected(seriesId, current, corrected);
        return corrected;
    }

    /// @dev Mints the full-range position with up to the wanted amounts and returns what actually went in.
    function _provide(PoolKey memory key, bool usdcIs0, uint160 sqrtPriceX96, uint256 usdcWant, uint256 coinWant)
        private
        returns (uint256 usdcIn, uint256 coinIn, uint128 liquidity)
    {
        IERC20 t0 = IERC20(Currency.unwrap(key.currency0));
        IERC20 t1 = IERC20(Currency.unwrap(key.currency1));
        uint256 bal0 = t0.balanceOf(address(this));
        uint256 bal1 = t1.balanceOf(address(this));
        // A correction swap can only have turned coins into USDC, so cap the wants at what is held.
        (uint256 want0, uint256 want1) = usdcIs0 ? (usdcWant, coinWant) : (coinWant, usdcWant);
        liquidity = _mintFullRange(key, sqrtPriceX96, Math.min(want0, bal0), Math.min(want1, bal1));
        uint256 used0 = bal0 - t0.balanceOf(address(this));
        uint256 used1 = bal1 - t1.balanceOf(address(this));
        (usdcIn, coinIn) = usdcIs0 ? (used0, used1) : (used1, used0);
    }

    function _mintFullRange(PoolKey memory key, uint160 sqrtPriceX96, uint256 amount0, uint256 amount1)
        private
        returns (uint128 liquidity)
    {
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(TICK_LOWER), TickMath.getSqrtPriceAtTick(TICK_UPPER), amount0, amount1
        );
        _approve(Currency.unwrap(key.currency0), amount0);
        _approve(Currency.unwrap(key.currency1), amount1);

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] =
            abi.encode(
                key,
                TICK_LOWER,
                TICK_UPPER,
                liquidity,
                SafeCast.toUint128(amount0),
                SafeCast.toUint128(amount1),
                C.DEAD,
                bytes("")
            );
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    function _approve(address token, uint256 amount) private {
        IERC20(token).forceApprove(address(permit2), amount);
        permit2.approve(token, address(positionManager), SafeCast.toUint160(amount), SafeCast.toUint48(block.timestamp));
    }

    // ------------------------------------------------------------------ squatted-pool correction

    function _correctPrice(PoolKey memory key, uint160 current, uint160 target) private {
        bool zeroForOne = current > target; // selling token0 pushes the price down
        address tokenIn = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        uint256 amountIn = IERC20(tokenIn).balanceOf(address(this));
        if (amountIn == 0) return;
        poolManager.unlock(abi.encode(key, zeroForOne, amountIn, target));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized(msg.sender);
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) =
            abi.decode(data, (PoolKey, bool, uint256, uint160));
        BalanceDelta delta = poolManager.swap(key, SwapParams(zeroForOne, -SafeCast.toInt256(amountIn), limit), "");
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, int128 amount) private {
        if (amount < 0) {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), SafeCast.toUint256(-int256(amount)));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(currency, address(this), SafeCast.toUint256(int256(amount)));
        }
    }

    /// @dev sqrt(num / den) as a Q64.96.
    function _sqrtPriceX96(uint256 num, uint256 den) private pure returns (uint160) {
        return SafeCast.toUint160(Math.sqrt(FullMath.mulDiv(num, 1 << 192, den)));
    }
}
