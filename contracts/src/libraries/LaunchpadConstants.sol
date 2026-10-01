// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Launchpad constants (see LAUNCHPAD_SPEC.md)
library LaunchpadConstants {
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 internal constant CURVE_SUPPLY = 950_000_000e18;
    uint256 internal constant CREATOR_SUPPLY = 50_000_000e18;
    uint64 internal constant CREATOR_VESTING = 30 days;

    uint256 internal constant VIRTUAL_USDC_0 = 1_000e6;
    uint256 internal constant VIRTUAL_COIN_0 = 1_000_000_000e18;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant FEE_BPS = 150;
    /// @dev Share of the USDC raised that the Graduator sends to the treasury before building the pool.
    uint256 internal constant GRADUATION_FEE_BPS = 500;

    uint256 internal constant SNIPE_WINDOW = 600;
    uint256 internal constant SNIPE_CAP = 20_000_000e18;

    /// @dev Curve coins a target must leave unsold, so graduation always has coins to pair in the pool.
    uint256 internal constant MIN_POOL_COINS = 10_000_000e18;

    uint256 internal constant CANON_THRESHOLD = 1_000_000e18;
    uint256 internal constant DEFAULT_GRADUATION_TARGET = 5_000e6;
    uint64 internal constant DEFAULT_VOTING_WINDOW = 86_400;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
}
