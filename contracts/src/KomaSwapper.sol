// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC3009} from "./interfaces/ILaunchpad.sol";

interface IGraduatorKeys {
    function poolKeyOf(uint256 seriesId) external view returns (PoolKey memory);
}

/// @title KOMA swapper
/// @notice Post-graduation trading of a series coin against USDC through its Uniswap v4 pool, including a
///         gasless buy that reuses the curve's EIP-3009 nonce-commitment trick.
contract KomaSwapper is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SWAP_TYPEHASH_TAG = keccak256("KOMA_SWAP_V1");

    IPoolManager public immutable poolManager;
    IGraduatorKeys public immutable graduator;
    address public immutable usdc;

    event Swapped(
        uint256 indexed seriesId, address indexed payer, address indexed recipient, bool buyCoin, uint256 amountIn, uint256 amountOut
    );

    error ZeroAddress();
    error ZeroAmount();
    error NotGraduated(uint256 seriesId);
    error Unauthorized(address caller);
    error Expired(uint256 deadline);
    error Slippage(uint256 out, uint256 minOut);

    constructor(address poolManager_, address graduator_, address usdc_) {
        if (poolManager_ == address(0) || graduator_ == address(0) || usdc_ == address(0)) revert ZeroAddress();
        poolManager = IPoolManager(poolManager_);
        graduator = IGraduatorKeys(graduator_);
        usdc = usdc_;
    }

    /// @param buyCoin true: USDC in, coins out; false: coins in, USDC out.
    function swapExactIn(uint256 seriesId, bool buyCoin, uint256 amountIn, uint256 minOut, address recipient)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        (PoolKey memory key, address tokenIn) = _route(seriesId, buyCoin, amountIn, recipient);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _swap(seriesId, key, tokenIn, amountIn, minOut, msg.sender, recipient, buyCoin);
    }

    /// @notice Relayed buy. The buyer signs one EIP-3009 `ReceiveWithAuthorization` for `usdcIn` to this
    ///         contract whose nonce is
    ///         `keccak256(abi.encode(SWAP_TYPEHASH_TAG, swapper, buyer, seriesId, usdcIn, minCoinOut, deadline, salt))`.
    function swapWithAuthorization(
        address buyer,
        uint256 seriesId,
        uint256 usdcIn,
        uint256 minCoinOut,
        uint256 deadline,
        bytes32 salt,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 coinOut) {
        if (block.timestamp > deadline) revert Expired(deadline);
        {
            bytes32 nonce = swapNonce(buyer, seriesId, usdcIn, minCoinOut, deadline, salt);
            _receive(buyer, usdcIn, validAfter, validBefore, nonce, v, r, s);
        }
        coinOut = _buyPulled(buyer, seriesId, usdcIn, minCoinOut);
    }

    /// @notice The EIP-3009 nonce a buyer signs for `swapWithAuthorization`.
    function swapNonce(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(SWAP_TYPEHASH_TAG, address(this), buyer, seriesId, usdcIn, minCoinOut, deadline, salt));
    }

    function _receive(
        address buyer,
        uint256 usdcIn,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        IERC3009(usdc).receiveWithAuthorization(buyer, address(this), usdcIn, validAfter, validBefore, nonce, v, r, s);
    }

    function _buyPulled(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut) private returns (uint256) {
        (PoolKey memory key, address tokenIn) = _route(seriesId, true, usdcIn, buyer);
        return _swap(seriesId, key, tokenIn, usdcIn, minCoinOut, buyer, buyer, true);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized(msg.sender);
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address recipient) =
            abi.decode(data, (PoolKey, bool, uint256, address));
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (int128 dIn, int128 dOut) = zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        (Currency cIn, Currency cOut) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        // Exact input: the input delta is <= 0 and the output delta >= 0.
        uint256 paid = SafeCast.toUint256(-int256(dIn));
        uint256 out = SafeCast.toUint256(int256(dOut));
        if (paid != 0) {
            poolManager.sync(cIn);
            IERC20(Currency.unwrap(cIn)).safeTransfer(address(poolManager), paid);
            poolManager.settle();
        }
        if (out != 0) poolManager.take(cOut, recipient, out);
        return abi.encode(paid, out);
    }

    function _route(uint256 seriesId, bool buyCoin, uint256 amountIn, address recipient)
        private
        view
        returns (PoolKey memory key, address tokenIn)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();
        key = graduator.poolKeyOf(seriesId);
        if (key.tickSpacing == 0) revert NotGraduated(seriesId);
        address c0 = Currency.unwrap(key.currency0);
        address coin = c0 == usdc ? Currency.unwrap(key.currency1) : c0;
        tokenIn = buyCoin ? usdc : coin;
    }

    function _swap(
        uint256 seriesId,
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address payer,
        address recipient,
        bool buyCoin
    ) private returns (uint256 amountOut) {
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        (uint256 paid, uint256 out) =
            abi.decode(poolManager.unlock(abi.encode(key, zeroForOne, amountIn, recipient)), (uint256, uint256));
        if (out < minOut) revert Slippage(out, minOut);
        // A swap that hit the price limit may not use all of the input; hand the rest back.
        if (paid < amountIn) IERC20(tokenIn).safeTransfer(payer, amountIn - paid);
        amountOut = out;
        emit Swapped(seriesId, payer, recipient, buyCoin, paid, out);
    }
}
