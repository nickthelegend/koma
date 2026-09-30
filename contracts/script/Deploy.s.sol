// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KomaIssues} from "../src/KomaIssues.sol";

/// forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
/// env: DEPLOYER_PRIVATE_KEY, KOMA_MINTER, KOMA_BASE_URI
contract Deploy is Script {
    function run() external returns (KomaIssues koma) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address minter = vm.envOr("KOMA_MINTER", admin);
        string memory base = vm.envOr("KOMA_BASE_URI", string("http://localhost:4310/api/tokens/"));
        vm.startBroadcast(pk);
        koma = new KomaIssues(admin, minter, base);
        vm.stopBroadcast();
        console.log("KomaIssues", address(koma));
    }
}
