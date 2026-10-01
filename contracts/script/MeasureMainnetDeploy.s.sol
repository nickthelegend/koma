// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeployLaunchpad} from "./DeployLaunchpad.s.sol";
import {CurveMathReference} from "../src/CurveMathReference.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";

/// @title Gas measurement of the Arbitrum One deploy on a LOCAL anvil fork
/// @notice Runs the real mainnet path of DeployLaunchpad (address book, guards, role hand-over, post-checks) on
///         `anvil --fork-url https://arb1.arbitrum.io/rpc --chain-id 42161`. anvil cannot execute Stylus WASM, so
///         this script first deploys CurveMathReference / RoyaltyRouterReference purely as gas stand-ins for the
///         Stylus programs and skips only the Stylus-code check. It refuses to run anywhere but anvil
///         (`anvil_nodeInfo` must answer), so it can never put the reference engine on Arbitrum One.
///   anvil --fork-url https://arb1.arbitrum.io/rpc --chain-id 42161 --port 18755 --auto-impersonate
///   ADMIN=.. TREASURY=.. RELAYER=.. ALLOW_EOA_ADMIN=true BASE_URI=https://x/c/ KOMA_BASE_URI=https://x/t/ \
///   ADDRESSES_OUT=none forge script script/MeasureMainnetDeploy.s.sol --rpc-url http://127.0.0.1:18755 \
///     --broadcast --unlocked --sender <throwaway address funded with anvil_setBalance>
contract MeasureMainnetDeploy is DeployLaunchpad {
    error NotLocalAnvil();
    error NotArbitrumOneFork(uint256 chainId);

    function run() public override returns (Deployment memory d) {
        if (block.chainid != ARBITRUM_ONE) revert NotArbitrumOneFork(block.chainid);
        try vm.rpc("anvil_nodeInfo", "[]") returns (bytes memory) {}
        catch {
            revert NotLocalAnvil();
        }
        vm.startBroadcast();
        address math = address(new CurveMathReference());
        address router = address(new RoyaltyRouterReference());
        vm.stopBroadcast();
        vm.setEnv("MATH", vm.toString(math));
        vm.setEnv("ROUTER", vm.toString(router));
        d = super.run();
    }

    /// @dev Stand-ins are EVM contracts; everything else on the mainnet path stays enforced.
    function _checkEngine(Config memory) internal view override {}
}
