// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveMath} from "./interfaces/ICurveMath.sol";
import {IRoyaltyRouter} from "./interfaces/IRoyaltyRouter.sol";
import {IERC3009} from "./interfaces/ILaunchpad.sol";
import {LaunchpadConstants as C} from "./libraries/LaunchpadConstants.sol";

interface IGraduator {
    function graduate(uint256 seriesId, address coin, uint256 usdcAmount, uint256 coinAmount, uint256 vU, uint256 vC)
        external
        returns (bytes32 poolId, uint256 usdcToPool, uint256 coinToPool);
    function poolManager() external view returns (address);
}

/// @title KOMA bonding curve
/// @notice One per series. Sells the 950M curve coins for USDC on a virtual constant-product curve
///         (starting at $1,000 virtual USDC vs 1B virtual coins) until `graduationTarget` USDC has been
///         raised, then hands both reserves to the Graduator, which seeds a Uniswap v4 pool.
/// @dev Gasless flows: `buyWithAuthorization` pulls USDC with the buyer's EIP-3009 signature whose nonce
///      commits to `minCoinOut`, `deadline` and a salt; `sellWithPermit` pairs an EIP-2612 coin permit with
///      an EIP-712 sell intent. Either way the relayer cannot change the trade's terms.
contract BondingCurve is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant BUY_TYPEHASH_TAG = keccak256("KOMA_BUY_V1");
    bytes32 public constant SELL_TYPEHASH =
        keccak256("Sell(address seller,uint256 coinIn,uint256 minUsdcOut,uint256 deadline,uint256 nonce)");

    uint256 public immutable seriesId;
    IERC20 public immutable usdc;
    ICurveMath public immutable math;
    IRoyaltyRouter public immutable router;
    address public immutable graduator;
    uint256 public immutable graduationTarget;
    uint256 public immutable launchedAt;
    /// @notice The only address allowed to call `setCoin` (the SeriesFactory).
    address public immutable factory;

    /// @notice Set once by the factory right after the coin is deployed (the coin mints to this curve).
    IERC20 public coin;
    bool public complete;
    bool public graduated;

    uint256 public vU;
    uint256 public vC;
    /// @notice Virtual product at launch. The math contract works on the live `vU * vC`, which can only
    ///         grow from rounding, so the curve stays solvent.
    uint256 public immutable k;
    uint256 public raised;

    mapping(address seller => uint256) public sellNonces;

    event Trade(
        address indexed trader,
        bool indexed isBuy,
        uint256 usdcAmount,
        uint256 coinAmount,
        uint256 fee,
        uint256 vU,
        uint256 vC,
        uint256 raised
    );
    event Completed(uint256 raised);
    event Graduated(address pool, bytes32 poolId, uint256 usdcToPool, uint256 coinToPool);

    error Unauthorized(address caller);
    error CoinAlreadySet();
    error CoinNotSet();
    error ZeroAddress();
    error ZeroAmount();
    error CurveComplete();
    error NotComplete();
    error AlreadyGraduated();
    error Expired(uint256 deadline);
    error Slippage(uint256 out, uint256 minOut);
    error SnipeCap(uint256 balanceAfter, uint256 cap);
    error InsufficientReserve(uint256 gross, uint256 raised);
    error InvalidIntentSignature();
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error InvalidTarget(uint256 target);

    constructor(
        uint256 seriesId_,
        address usdc_,
        address math_,
        address router_,
        address graduator_,
        uint256 graduationTarget_,
        address factory_
    ) EIP712("KOMA Curve", "1") {
        if (usdc_ == address(0) || math_ == address(0) || router_ == address(0) || graduator_ == address(0)) {
            revert ZeroAddress();
        }
        // The target must be reachable with the coins the curve actually holds.
        if (
            graduationTarget_ == 0
                || ICurveMath(math_).quoteBuy(C.VIRTUAL_USDC_0, C.VIRTUAL_COIN_0, graduationTarget_) > C.CURVE_SUPPLY
        ) revert InvalidTarget(graduationTarget_);
        seriesId = seriesId_;
        usdc = IERC20(usdc_);
        math = ICurveMath(math_);
        router = IRoyaltyRouter(router_);
        graduator = graduator_;
        graduationTarget = graduationTarget_;
        launchedAt = block.timestamp;
        factory = factory_;
        vU = C.VIRTUAL_USDC_0;
        vC = C.VIRTUAL_COIN_0;
        k = C.VIRTUAL_USDC_0 * C.VIRTUAL_COIN_0;
    }

    function setCoin(address coin_) external {
        if (msg.sender != factory) revert Unauthorized(msg.sender);
        if (address(coin) != address(0)) revert CoinAlreadySet();
        if (coin_ == address(0)) revert ZeroAddress();
        coin = IERC20(coin_);
    }

    // ------------------------------------------------------------------ quotes

    /// @notice Fee-inclusive quote. `usdcUsed <= usdcIn`; it is smaller when the buy is clipped at the target.
    function quoteBuy(uint256 usdcIn) public view returns (uint256 coinOut, uint256 fee, uint256 usdcUsed) {
        if (complete || usdcIn == 0) return (0, 0, 0);
        uint256 remaining = graduationTarget - raised;
        usdcUsed = usdcIn;
        fee = _fee(usdcIn);
        uint256 net = usdcIn - fee;
        if (net >= remaining) {
            // Clip: the smallest spend whose net (after the rounded-up fee) is exactly `remaining`.
            net = remaining;
            fee = Math.mulDiv(remaining, C.FEE_BPS, C.BPS - C.FEE_BPS, Math.Rounding.Ceil);
            usdcUsed = remaining + fee;
        }
        coinOut = math.quoteBuy(vU, vC, net);
    }

    function quoteSell(uint256 coinIn) public view returns (uint256 usdcOut, uint256 fee) {
        if (complete || coinIn == 0) return (0, 0);
        uint256 gross = math.quoteSell(vU, vC, coinIn);
        fee = _fee(gross);
        usdcOut = gross - fee;
    }

    function spotPrice() external view returns (uint256) {
        return math.spotPrice(vU, vC);
    }

    function state()
        external
        view
        returns (
            uint256 vU_,
            uint256 vC_,
            uint256 raised_,
            uint256 target,
            bool complete_,
            bool graduated_,
            uint256 launchedAt_
        )
    {
        return (vU, vC, raised, graduationTarget, complete, graduated, launchedAt);
    }

    // ------------------------------------------------------------------ buys

    function buy(uint256 usdcIn, uint256 minCoinOut, address recipient)
        external
        nonReentrant
        returns (uint256 coinOut)
    {
        uint256 usdcUsed;
        uint256 fee;
        (coinOut, fee, usdcUsed) = _buyEffects(usdcIn, minCoinOut, recipient);
        usdc.safeTransferFrom(msg.sender, address(this), usdcUsed);
        _buyInteractions(recipient, coinOut, fee);
    }

    /// @notice Relayed buy. The buyer signs one EIP-3009 `ReceiveWithAuthorization` for `usdcIn` whose nonce is
    ///         `keccak256(abi.encode(BUY_TYPEHASH_TAG, curve, buyer, usdcIn, minCoinOut, deadline, salt))`.
    ///         Any USDC left unused by clipping is refunded to the buyer in the same transaction.
    function buyWithAuthorization(
        address buyer,
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
        // Pulling first is safe: USDC has no transfer hooks and every entry point is nonReentrant.
        {
            bytes32 nonce = buyNonce(buyer, usdcIn, minCoinOut, deadline, salt);
            _receive(buyer, usdcIn, validAfter, validBefore, nonce, v, r, s);
        }
        coinOut = _buyPulled(buyer, usdcIn, minCoinOut);
    }

    function _buyPulled(address buyer, uint256 usdcIn, uint256 minCoinOut) private returns (uint256 coinOut) {
        (uint256 out, uint256 fee, uint256 usdcUsed) = _buyEffects(usdcIn, minCoinOut, buyer);
        if (usdcIn > usdcUsed) usdc.safeTransfer(buyer, usdcIn - usdcUsed);
        _buyInteractions(buyer, out, fee);
        return out;
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
        IERC3009(address(usdc)).receiveWithAuthorization(
            buyer, address(this), usdcIn, validAfter, validBefore, nonce, v, r, s
        );
    }

    /// @notice The EIP-3009 nonce a buyer signs for `buyWithAuthorization`.
    function buyNonce(address buyer, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(BUY_TYPEHASH_TAG, address(this), buyer, usdcIn, minCoinOut, deadline, salt));
    }

    function _buyEffects(uint256 usdcIn, uint256 minCoinOut, address recipient)
        private
        returns (uint256 coinOut, uint256 fee, uint256 usdcUsed)
    {
        IERC20 coin_ = _tradable();
        if (recipient == address(0)) revert ZeroAddress();
        if (usdcIn == 0) revert ZeroAmount();
        (coinOut, fee, usdcUsed) = quoteBuy(usdcIn);
        if (coinOut == 0) revert ZeroAmount();
        if (coinOut < minCoinOut) revert Slippage(coinOut, minCoinOut);
        if (block.timestamp < launchedAt + C.SNIPE_WINDOW) {
            uint256 after_ = coin_.balanceOf(recipient) + coinOut;
            if (after_ > C.SNIPE_CAP) revert SnipeCap(after_, C.SNIPE_CAP);
        }
        uint256 net = usdcUsed - fee;
        uint256 newVU = vU + net;
        uint256 newVC = vC - coinOut;
        uint256 newRaised = raised + net;
        vU = newVU;
        vC = newVC;
        raised = newRaised;
        emit Trade(recipient, true, usdcUsed, coinOut, fee, newVU, newVC, newRaised);
        if (newRaised == graduationTarget) {
            complete = true;
            emit Completed(newRaised);
        }
    }

    function _buyInteractions(address recipient, uint256 coinOut, uint256 fee) private {
        _routeFee(fee);
        coin.safeTransfer(recipient, coinOut);
    }

    // ------------------------------------------------------------------ sells

    function sell(uint256 coinIn, uint256 minUsdcOut, address recipient)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        usdcOut = _sell(msg.sender, recipient, coinIn, minUsdcOut);
    }

    /// @notice Relayed sell: an EIP-2612 permit for the coins plus an EIP-712 `Sell` intent signed by `seller`
    ///         (domain "KOMA Curve"/"1"). If the permit was already used (e.g. front-run), an existing allowance
    ///         is accepted.
    function sellWithPermit(
        address seller,
        uint256 coinIn,
        uint256 minUsdcOut,
        uint256 deadline,
        uint8 pv,
        bytes32 pr,
        bytes32 ps,
        bytes calldata intentSig
    ) external nonReentrant returns (uint256 usdcOut) {
        if (block.timestamp > deadline) revert Expired(deadline);
        if (seller == address(0)) revert ZeroAddress();
        _checkSellIntent(seller, coinIn, minUsdcOut, deadline, intentSig);
        _permitOrAllowance(seller, coinIn, deadline, pv, pr, ps);
        usdcOut = _sell(seller, seller, coinIn, minUsdcOut);
    }

    function _checkSellIntent(
        address seller,
        uint256 coinIn,
        uint256 minUsdcOut,
        uint256 deadline,
        bytes calldata intentSig
    ) private {
        uint256 nonce = sellNonces[seller]++;
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(SELL_TYPEHASH, seller, coinIn, minUsdcOut, deadline, nonce)));
        if (!SignatureChecker.isValidSignatureNow(seller, digest, intentSig)) revert InvalidIntentSignature();
    }

    function _permitOrAllowance(address seller, uint256 coinIn, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        private
    {
        IERC20 coin_ = _tradable();
        try IERC20Permit(address(coin_)).permit(seller, address(this), coinIn, deadline, v, r, s) {}
        catch {
            uint256 allowance = coin_.allowance(seller, address(this));
            if (allowance < coinIn) revert InsufficientAllowance(allowance, coinIn);
        }
    }

    function _sell(address from, address recipient, uint256 coinIn, uint256 minUsdcOut)
        private
        returns (uint256 usdcOut)
    {
        IERC20 coin_ = _tradable();
        if (coinIn == 0) revert ZeroAmount();
        uint256 gross = math.quoteSell(vU, vC, coinIn);
        uint256 raised_ = raised;
        if (gross > raised_) revert InsufficientReserve(gross, raised_);
        uint256 fee = _fee(gross);
        usdcOut = gross - fee;
        if (usdcOut == 0) revert ZeroAmount();
        if (usdcOut < minUsdcOut) revert Slippage(usdcOut, minUsdcOut);

        uint256 newVU = vU - gross;
        uint256 newVC = vC + coinIn;
        vU = newVU;
        vC = newVC;
        raised = raised_ - gross;
        emit Trade(from, false, usdcOut, coinIn, fee, newVU, newVC, raised_ - gross);

        coin_.safeTransferFrom(from, address(this), coinIn);
        _routeFee(fee);
        usdc.safeTransfer(recipient, usdcOut);
    }

    // ------------------------------------------------------------------ graduation

    /// @notice Anyone, once, after the target is hit: moves every coin and all USDC to the Graduator, which
    ///         seeds a full-range Uniswap v4 position at the curve's final price.
    function graduate() external nonReentrant returns (bytes32 poolId) {
        if (!complete) revert NotComplete();
        if (graduated) revert AlreadyGraduated();
        graduated = true;

        IERC20 coin_ = coin;
        uint256 usdcAmount = usdc.balanceOf(address(this));
        uint256 coinAmount = coin_.balanceOf(address(this));
        usdc.safeTransfer(graduator, usdcAmount);
        coin_.safeTransfer(graduator, coinAmount);
        uint256 usdcToPool;
        uint256 coinToPool;
        (poolId, usdcToPool, coinToPool) =
            IGraduator(graduator).graduate(seriesId, address(coin_), usdcAmount, coinAmount, vU, vC);
        emit Graduated(IGraduator(graduator).poolManager(), poolId, usdcToPool, coinToPool);
    }

    // ------------------------------------------------------------------ internals

    function _tradable() private view returns (IERC20 coin_) {
        coin_ = coin;
        if (address(coin_) == address(0)) revert CoinNotSet();
        if (complete) revert CurveComplete();
    }

    function _routeFee(uint256 fee) private {
        if (fee == 0) return;
        usdc.safeTransfer(address(router), fee);
        router.route(seriesId, fee);
    }

    /// @dev 1% of the USDC side, rounded up (against the trader).
    function _fee(uint256 amount) private pure returns (uint256) {
        return Math.mulDiv(amount, C.FEE_BPS, C.BPS, Math.Rounding.Ceil);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
