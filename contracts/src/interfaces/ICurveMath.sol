// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Bonding-curve math (virtual constant product)
/// @notice Implemented by the Stylus `curve-math` contract and by `CurveMathReference`.
///         Fee-free; the curve applies fees. Every function reverts when `vU == 0` or `vC == 0`.
interface ICurveMath {
    /// @return coinOut `vC - ceil(vU*vC / (vU + usdcIn))` (rounds against the buyer)
    function quoteBuy(uint256 vU, uint256 vC, uint256 usdcIn) external pure returns (uint256 coinOut);
    /// @return usdcOut `vU - ceil(vU*vC / (vC + coinIn))` (rounds against the seller)
    function quoteSell(uint256 vU, uint256 vC, uint256 coinIn) external pure returns (uint256 usdcOut);
    /// @return usdcIn `targetVU - vU`; reverts if `targetVU < vU`
    function usdcToReach(uint256 vU, uint256 vC, uint256 targetVU) external pure returns (uint256 usdcIn);
    /// @return priceX18 `vU * 1e18 / vC` (raw USDC units per 1e18 coin units, scaled by 1e18)
    function spotPrice(uint256 vU, uint256 vC) external pure returns (uint256 priceX18);
}
