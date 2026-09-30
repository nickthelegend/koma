// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeriesCoin} from "../SeriesCoin.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @notice Holds the SeriesCoin and VestingWallet creation code so SeriesFactory stays under the EIP-170 limit.
contract CoinDeployer {
    function deployVesting(address beneficiary, uint64 start, uint64 duration) external returns (address) {
        return address(new VestingWallet(beneficiary, start, duration));
    }

    function deployCoin(string calldata name, string calldata symbol, address curve, address vesting)
        external
        returns (address)
    {
        return address(new SeriesCoin(name, symbol, curve, vesting));
    }
}
