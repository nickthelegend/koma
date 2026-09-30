// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BondingCurve} from "../BondingCurve.sol";

/// @notice Holds the BondingCurve creation code so SeriesFactory stays under the EIP-170 limit.
///         The caller becomes the curve's `factory` (the only address that can set its coin), so a
///         stranger using this deployer only gets an unregistered curve.
contract CurveDeployer {
    function deploy(uint256 seriesId, address usdc, address math, address router, address graduator, uint256 target)
        external
        returns (address)
    {
        return address(new BondingCurve(seriesId, usdc, math, router, graduator, target, msg.sender));
    }
}
