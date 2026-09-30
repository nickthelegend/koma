// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICurveMath} from "./interfaces/ICurveMath.sol";

/// @title Solidity reference for the Stylus curve-math contract
/// @notice Used by the unit tests, by the localnet deploy (anvil cannot run Stylus) and as the
///         differential oracle and gas baseline for the Stylus build. Rounding follows the spec:
///         the virtual product `k = vU * vC` is divided with a ceiling, so the trader always gets the floor.
contract CurveMathReference is ICurveMath {
    error ZeroReserve();
    error TargetBelowReserve(uint256 vU, uint256 targetVU);

    function quoteBuy(uint256 vU, uint256 vC, uint256 usdcIn) external pure returns (uint256) {
        _nonZero(vU, vC);
        return vC - _ceilDiv(vU * vC, vU + usdcIn);
    }

    function quoteSell(uint256 vU, uint256 vC, uint256 coinIn) external pure returns (uint256) {
        _nonZero(vU, vC);
        return vU - _ceilDiv(vU * vC, vC + coinIn);
    }

    function usdcToReach(uint256 vU, uint256 vC, uint256 targetVU) external pure returns (uint256) {
        _nonZero(vU, vC);
        if (targetVU < vU) revert TargetBelowReserve(vU, targetVU);
        return targetVU - vU;
    }

    function spotPrice(uint256 vU, uint256 vC) external pure returns (uint256) {
        _nonZero(vU, vC);
        return vU * 1e18 / vC;
    }

    function _nonZero(uint256 vU, uint256 vC) private pure {
        if (vU == 0 || vC == 0) revert ZeroReserve();
    }

    /// @dev `ceil(a / b)` for b > 0 (b is always a positive reserve sum here).
    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
