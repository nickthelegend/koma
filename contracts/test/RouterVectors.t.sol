// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";
import {CircleUSDC, IFiatToken} from "./utils/CircleUSDC.sol";

/// Replays `stylus/test-vectors/router.json` (generated from the Stylus `split.rs`) against the Solidity
/// `RoyaltyRouterReference`, so both engines are pinned to the same 40/20/40 split on every vector.
contract RouterVectorsTest is Test {
    // fields in alphabetical order so `abi.decode` maps the JSON objects straight in
    struct Case {
        uint256 amount;
        uint256[] ancestors;
        uint256 character;
        uint256 depth;
        uint256 treasury;
    }
    string constant CASE_TYPE =
        "Case(uint256 amount,uint256[] ancestors,uint256 character,uint256 depth,uint256 treasury)";

    RoyaltyRouterReference router;
    IFiatToken usdc;
    address treasury = makeAddr("treasury");
    address factory = makeAddr("factory");

    function _curve(uint256 id) internal pure returns (address) {
        return address(uint160(0xC000 + id));
    }

    function _account(uint256 id) internal pure returns (address) {
        return address(uint160(0xA000 + id));
    }

    function setUp() public {
        usdc = CircleUSDC.deploy();
        router = new RoyaltyRouterReference();
        router.initialize(address(usdc), treasury, address(this));
        router.setFactory(factory);
        // series id = depth + 1, so series i has i-1 ancestors
        vm.startPrank(factory);
        for (uint256 i = 1; i <= 11; i++) {
            router.registerSeries(i, _curve(i), _account(i), i - 1);
        }
        vm.stopPrank();
    }

    function test_RouterVectorsMatchStylus() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../stylus/test-vectors/router.json"));
        Case[] memory cases = abi.decode(vm.parseJsonTypeArray(json, ".cases", CASE_TYPE), (Case[]));
        assertEq(cases.length, vm.parseJsonUint(json, ".count"));
        assertGt(cases.length, 2000);
        for (uint256 n; n < cases.length; n++) {
            // recycle the scratch memory each replay allocates (logs), or memory expansion runs out of gas
            uint256 fmp;
            assembly ("memory-safe") {
                fmp := mload(0x40)
            }
            _replay(cases[n]);
            assembly ("memory-safe") {
                mstore(0x40, fmp)
            }
        }

        // amount*4000 overflows just above (2^256-1)/4000, exactly where the Stylus router reverts
        uint256 overflow = vm.parseUint(vm.parseJsonString(json, ".overflowAmount"));
        assertEq(overflow, type(uint256).max / 4_000 + 1);
        deal(address(usdc), address(router), overflow);
        vm.prank(_curve(1));
        vm.expectRevert(); // Panic(0x11)
        router.route(1, overflow);
    }

    function _replay(Case memory c) internal {
        uint256 amount = c.amount;
        uint256 id = c.depth + 1;
        deal(address(usdc), address(router), amount); // balance only; totalSupply untouched
        vm.recordLogs();
        vm.prank(_curve(id));
        router.route(id, amount);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // expected legs in payment order, zero legs skipped: ancestors nearest-first, character, treasury
        uint256 k;
        for (uint256 d; d < c.ancestors.length; d++) {
            k = _expectLeg(logs, k, _account(id - d - 1), c.ancestors[d], 1);
        }
        k = _expectLeg(logs, k, _account(id), c.character, 0);
        k = _expectLeg(logs, k, treasury, c.treasury, 2);
        assertEq(_routedCount(logs), k, "no extra Routed events");
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function _expectLeg(Vm.Log[] memory logs, uint256 k, address to, uint256 amount, uint8 kind)
        internal
        view
        returns (uint256)
    {
        if (amount == 0) return k;
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(router) || logs[i].topics[0] != IRoyaltyRouter.Routed.selector) continue;
            if (seen++ != k) continue;
            (uint256 a, uint8 kd) = abi.decode(logs[i].data, (uint256, uint8));
            assertEq(address(uint160(uint256(logs[i].topics[2]))), to, "recipient");
            assertEq(a, amount, "amount");
            assertEq(kd, kind, "kind");
            return k + 1;
        }
        revert("missing Routed leg");
    }

    function _routedCount(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(router) && logs[i].topics[0] == IRoyaltyRouter.Routed.selector) n++;
        }
    }
}
