// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Royalty router
/// @notice Implemented by the Stylus `royalty-router` contract and by `RoyaltyRouterReference`.
///         Splits every trading fee: 40% character TBA, 20% remix pool (ancestors), 40% treasury.
interface IRoyaltyRouter {
    event Routed(uint256 indexed seriesId, address indexed recipient, uint256 amount, uint8 kind); // kind: 0 character, 1 ancestor, 2 treasury
    event SeriesRegistered(uint256 indexed seriesId, address curve, address characterAccount, uint256 parentSeriesId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function initialize(address usdc, address treasury, address owner) external; // once
    function setFactory(address factory) external; // owner only
    function transferOwnership(address newOwner) external; // owner only; newOwner != 0
    function registerSeries(uint256 seriesId, address curve, address characterAccount, uint256 parentSeriesId)
        external; // factory only; parent must exist or be 0
    function route(uint256 seriesId, uint256 amount) external; // only curveOf(seriesId); USDC already transferred to the router
    function parentOf(uint256 seriesId) external view returns (uint256);
    function accountOf(uint256 seriesId) external view returns (address);
    function curveOf(uint256 seriesId) external view returns (address);
    function earned(address recipient) external view returns (uint256); // lifetime USDC routed to recipient
    function treasury() external view returns (address);
    function usdc() external view returns (address);
    function factory() external view returns (address);
    function owner() external view returns (address);
}
