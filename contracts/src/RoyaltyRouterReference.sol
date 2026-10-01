// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoyaltyRouter} from "./interfaces/IRoyaltyRouter.sol";

/// @title Solidity reference for the Stylus royalty-router contract
/// @notice Pushes every curve fee straight out: 40% to the series' character TBA, 40% to the treasury and a
///         20% remix pool that pays ancestor i (1 = parent) `pool >> i`, up to 8 generations. Whatever the
///         ancestors don't take (and all rounding dust) goes to the character, so exactly `amount` leaves.
contract RoyaltyRouterReference is IRoyaltyRouter {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant CHARACTER_BPS = 4_000;
    uint256 public constant TREASURY_BPS = 4_000;
    uint256 public constant MAX_DEPTH = 8;

    uint8 internal constant KIND_CHARACTER = 0;
    uint8 internal constant KIND_ANCESTOR = 1;
    uint8 internal constant KIND_TREASURY = 2;

    struct SeriesInfo {
        address curve;
        address account;
        uint256 parent;
    }

    /// @dev Only the deployer may call `initialize`, so the one-shot setup cannot be front-run.
    address private immutable _deployer;

    address public usdc;
    address public treasury;
    address public owner;
    address public factory;

    mapping(uint256 seriesId => SeriesInfo) private _series;
    mapping(address recipient => uint256) public earned;

    event FactoryUpdated(address factory);

    error AlreadyInitialized();
    error NotInitialized();
    error Unauthorized(address caller);
    error ZeroAddress();
    error SeriesExists(uint256 seriesId);
    error UnknownSeries(uint256 seriesId);

    constructor() {
        _deployer = msg.sender;
    }

    function initialize(address usdc_, address treasury_, address owner_) external {
        if (msg.sender != _deployer) revert Unauthorized(msg.sender);
        if (usdc != address(0)) revert AlreadyInitialized();
        if (usdc_ == address(0) || treasury_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        treasury = treasury_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    /// @notice Owner only. Single step: `newOwner` must be able to send transactions (e.g. the admin Safe).
    function transferOwnership(address newOwner) external {
        address current = owner;
        if (msg.sender != current || current == address(0)) revert Unauthorized(msg.sender);
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
        emit OwnershipTransferred(current, newOwner);
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner || owner == address(0)) revert Unauthorized(msg.sender);
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactoryUpdated(factory_);
    }

    function registerSeries(uint256 seriesId, address curve, address characterAccount, uint256 parentSeriesId)
        external
    {
        if (msg.sender != factory || factory == address(0)) revert Unauthorized(msg.sender);
        if (curve == address(0) || characterAccount == address(0)) revert ZeroAddress();
        if (seriesId == 0 || _series[seriesId].curve != address(0)) revert SeriesExists(seriesId);
        if (parentSeriesId != 0 && _series[parentSeriesId].curve == address(0)) revert UnknownSeries(parentSeriesId);
        _series[seriesId] = SeriesInfo(curve, characterAccount, parentSeriesId);
        emit SeriesRegistered(seriesId, curve, characterAccount, parentSeriesId);
    }

    function route(uint256 seriesId, uint256 amount) external {
        SeriesInfo storage s = _series[seriesId];
        if (msg.sender != s.curve || s.curve == address(0)) revert Unauthorized(msg.sender);

        uint256 toCharacter = amount * CHARACTER_BPS / BPS;
        uint256 toTreasury = amount * TREASURY_BPS / BPS;
        uint256 pool = amount - toCharacter - toTreasury;

        uint256 paidAncestors;
        uint256 ancestor = s.parent;
        for (uint256 i = 1; i <= MAX_DEPTH && ancestor != 0; ++i) {
            SeriesInfo storage a = _series[ancestor];
            uint256 share = pool >> i;
            paidAncestors += share;
            _pay(seriesId, a.account, share, KIND_ANCESTOR);
            ancestor = a.parent;
        }

        _pay(seriesId, s.account, toCharacter + (pool - paidAncestors), KIND_CHARACTER);
        _pay(seriesId, treasury, toTreasury, KIND_TREASURY);
    }

    function _pay(uint256 seriesId, address to, uint256 amount, uint8 kind) private {
        if (amount == 0) return;
        earned[to] += amount;
        IERC20(usdc).safeTransfer(to, amount);
        emit Routed(seriesId, to, amount, kind);
    }

    function parentOf(uint256 seriesId) external view returns (uint256) {
        return _series[seriesId].parent;
    }

    function accountOf(uint256 seriesId) external view returns (address) {
        return _series[seriesId].account;
    }

    function curveOf(uint256 seriesId) external view returns (address) {
        return _series[seriesId].curve;
    }
}
