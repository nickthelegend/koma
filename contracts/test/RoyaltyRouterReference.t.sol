// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";

contract RoyaltyRouterReferenceTest is Test {
    RoyaltyRouterReference router;
    TestUSDC usdc;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address factory = makeAddr("factory");

    function setUp() public {
        usdc = new TestUSDC();
        router = new RoyaltyRouterReference();
        router.initialize(address(usdc), treasury, owner);
        vm.prank(owner);
        router.setFactory(factory);
    }

    function _curve(uint256 id) internal pure returns (address) {
        return address(uint160(0xC000 + id));
    }

    function _account(uint256 id) internal pure returns (address) {
        return address(uint160(0xA000 + id));
    }

    /// Registers series 1..n where series i's parent is i-1 (series 1 has no parent).
    function _chain(uint256 n) internal {
        vm.startPrank(factory);
        for (uint256 i = 1; i <= n; i++) {
            router.registerSeries(i, _curve(i), _account(i), i - 1);
        }
        vm.stopPrank();
    }

    function _route(uint256 id, uint256 amount) internal {
        usdc.mint(address(router), amount);
        vm.prank(_curve(id));
        router.route(id, amount);
    }

    function test_Initialized() public view {
        assertEq(router.usdc(), address(usdc));
        assertEq(router.treasury(), treasury);
        assertEq(router.owner(), owner);
        assertEq(router.factory(), factory);
    }

    function test_RevertWhen_InitializedTwice() public {
        vm.expectRevert(RoyaltyRouterReference.AlreadyInitialized.selector);
        router.initialize(address(usdc), treasury, owner);
    }

    function test_RevertWhen_InitializeNotDeployer() public {
        RoyaltyRouterReference fresh = new RoyaltyRouterReference();
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, makeAddr("mallory")));
        fresh.initialize(address(usdc), treasury, owner);
    }

    function test_RevertWhen_SetFactoryNotOwner() public {
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, address(this)));
        router.setFactory(address(1));
    }

    function test_RevertWhen_RegisterNotFactory() public {
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, address(this)));
        router.registerSeries(1, _curve(1), _account(1), 0);
    }

    function test_RevertWhen_ParentUnknown() public {
        vm.prank(factory);
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.UnknownSeries.selector, 7));
        router.registerSeries(1, _curve(1), _account(1), 7);
    }

    function test_RevertWhen_RegisteredTwice() public {
        _chain(1);
        vm.prank(factory);
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.SeriesExists.selector, 1));
        router.registerSeries(1, _curve(1), _account(1), 0);
    }

    function test_RevertWhen_RouteNotCurve() public {
        _chain(2);
        vm.prank(_curve(1));
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, _curve(1)));
        router.route(2, 100);
    }

    function test_Views() public {
        _chain(2);
        assertEq(router.parentOf(2), 1);
        assertEq(router.accountOf(2), _account(2));
        assertEq(router.curveOf(2), _curve(2));
    }

    function test_NoParentCharacterTakesSeventyPercent() public {
        _chain(1);
        vm.recordLogs();
        _route(1, 10_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 routed;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(router)) continue;
            assertEq(logs[i].topics[0], IRoyaltyRouter.Routed.selector);
            (uint256 amount, uint8 kind) = abi.decode(logs[i].data, (uint256, uint8));
            address to = address(uint160(uint256(logs[i].topics[2])));
            if (kind == 0) assertEq(abi.encode(to, amount), abi.encode(_account(1), uint256(7_000)));
            else assertEq(abi.encode(to, amount, kind), abi.encode(treasury, uint256(3_000), uint8(2)));
            routed++;
        }
        assertEq(routed, 2);
        assertEq(usdc.balanceOf(_account(1)), 7_000);
        assertEq(usdc.balanceOf(treasury), 3_000);
        assertEq(router.earned(_account(1)), 7_000);
    }

    function test_RemixPoolHalvesPerGeneration() public {
        _chain(3); // 3 -> 2 -> 1
        _route(3, 10_000); // pool = 2000
        assertEq(usdc.balanceOf(_account(2)), 1_000); // pool >> 1
        assertEq(usdc.balanceOf(_account(1)), 500); // pool >> 2
        assertEq(usdc.balanceOf(_account(3)), 5_000 + 500);
        assertEq(usdc.balanceOf(treasury), 3_000);
    }

    function test_RemixDepthCappedAtEight() public {
        _chain(10); // series 10 has 9 ancestors
        uint256 amount = 1 << 20;
        _route(10, amount);
        uint256 pool = amount - amount * 5000 / 10000 - amount * 3000 / 10000;
        for (uint256 depth = 1; depth <= 8; depth++) {
            assertEq(usdc.balanceOf(_account(10 - depth)), pool >> depth, "ancestor share");
        }
        assertEq(usdc.balanceOf(_account(1)), 0, "ninth generation gets nothing");
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_DustGoesToCharacter() public {
        _chain(2);
        _route(2, 7); // char 3, treasury 2, pool 2 -> parent 1, char +1
        assertEq(usdc.balanceOf(_account(2)), 4);
        assertEq(usdc.balanceOf(_account(1)), 1);
        assertEq(usdc.balanceOf(treasury), 2);
    }

    function testFuzz_RoutePaysExactlyAmount(uint256 amount, uint8 depth) public {
        amount = bound(amount, 0, 1e30);
        uint256 n = bound(depth, 1, 12);
        _chain(n);
        _route(n, amount);
        assertEq(usdc.balanceOf(address(router)), 0);
        uint256 total = usdc.balanceOf(treasury);
        for (uint256 i = 1; i <= n; i++) {
            total += usdc.balanceOf(_account(i));
        }
        assertEq(total, amount);
        assertEq(router.earned(treasury), amount * 3000 / 10000);
    }
}
