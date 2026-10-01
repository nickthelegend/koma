// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {LaunchpadConstants as C} from "./libraries/LaunchpadConstants.sol";
import {IBondingCurveView, IGraduatorView} from "./interfaces/ILaunchpad.sol";

/// @title KOMA series coin
/// @notice Fixed 1B supply: 95% to the bonding curve, 5% to the creator's vesting wallet. Holding is voting:
///         every recipient is self-delegated on first receipt, and the clock is `block.timestamp` because
///         Arbitrum's `block.number` is the L1 block number.
/// @dev Until the curve graduates, the coin cannot be sent to the Uniswap v4 PoolManager, so no v4 pool (any
///      fee tier or hook) can trade it before the curve completes. The graduation pool itself is protected by
///      the Graduator's initialize-gating hook (AUDIT.md H-1); this lock keeps price discovery on the curve.
contract SeriesCoin is ERC20, ERC20Permit, ERC20Votes {
    address public immutable curve;
    address private immutable _poolManager;

    error PoolLockedUntilGraduation();

    constructor(string memory name_, string memory symbol_, address curve_, address vesting_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        curve = curve_;
        _poolManager = IGraduatorView(IBondingCurveView(curve_).graduator()).poolManager();
        _mint(curve_, C.CURVE_SUPPLY);
        _mint(vesting_, C.CREATOR_SUPPLY);
    }

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        if (to == _poolManager && !IBondingCurveView(curve).graduated()) revert PoolLockedUntilGraduation();
        super._update(from, to, value);
        if (to != address(0) && delegates(to) == address(0)) _delegate(to, to);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
