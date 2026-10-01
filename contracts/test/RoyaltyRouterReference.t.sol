// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";
import {CircleUSDC, IFiatToken} from "./utils/CircleUSDC.sol";

contract RoyaltyRouterReferenceTest is Test {
    RoyaltyRouterReference router;
    IFiatToken usdc;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address factory = makeAddr("factory");

    function setUp() public {
        usdc = CircleUSDC.deploy();
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
        if (amount != 0) CircleUSDC.mint(address(router), amount); // FiatToken rejects zero mints
        vm.prank(_curve(id));
        router.route(id, amount);
    }

    /// Ownership hand-over used by the mainnet deploy: deployer initializes as owner, wires, transfers to ADMIN.
    function test_TransferOwnership() public {
        address admin = makeAddr("admin");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, makeAddr("stranger")));
        router.transferOwnership(admin);
        vm.startPrank(owner);
        vm.expectRevert(RoyaltyRouterReference.ZeroAddress.selector);
        router.transferOwnership(address(0));
        vm.expectEmit(address(router));
        emit IRoyaltyRouter.OwnershipTransferred(owner, admin);
        router.transferOwnership(admin);
        assertEq(router.owner(), admin);
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, owner));
        router.setFactory(owner);
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, owner));
        router.transferOwnership(owner);
        vm.stopPrank();
        vm.prank(admin);
        router.setFactory(admin);
        assertEq(router.factory(), admin);
        assertEq(router.treasury(), treasury, "treasury cannot change");
    }

    function test_InitializeEmitsOwnership() public {
        RoyaltyRouterReference r = new RoyaltyRouterReference();
        vm.expectEmit(address(r));
        emit IRoyaltyRouter.OwnershipTransferred(address(0), owner);
        r.initialize(address(usdc), treasury, owner);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RoyaltyRouterReference.Unauthorized.selector, owner));
        r.initialize(address(usdc), treasury, owner); // deployer-only, once
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

    function test_NoParentCharacterTakesSixtyPercent() public {
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
            if (kind == 0) assertEq(abi.encode(to, amount), abi.encode(_account(1), uint256(6_000)));
            else assertEq(abi.encode(to, amount, kind), abi.encode(treasury, uint256(4_000), uint8(2)));
            routed++;
        }
        assertEq(routed, 2);
        assertEq(usdc.balanceOf(_account(1)), 6_000); // 40% + the whole 20% pool
        assertEq(usdc.balanceOf(treasury), 4_000);
        assertEq(router.earned(_account(1)), 6_000);
    }

    function test_RemixPoolHalvesPerGeneration() public {
        _chain(3); // 3 -> 2 -> 1
        _route(3, 10_000); // pool = 2000
        assertEq(usdc.balanceOf(_account(2)), 1_000); // pool >> 1
        assertEq(usdc.balanceOf(_account(1)), 500); // pool >> 2
        assertEq(usdc.balanceOf(_account(3)), 4_000 + 500);
        assertEq(usdc.balanceOf(treasury), 4_000);
    }

    function test_RemixDepthCappedAtEight() public {
        _chain(10); // series 10 has 9 ancestors
        uint256 amount = 1 << 20;
        _route(10, amount);
        uint256 pool = amount - amount * 4000 / 10000 - amount * 4000 / 10000;
        for (uint256 depth = 1; depth <= 8; depth++) {
            assertEq(usdc.balanceOf(_account(10 - depth)), pool >> depth, "ancestor share");
        }
        assertEq(usdc.balanceOf(_account(1)), 0, "ninth generation gets nothing");
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_DustGoesToCharacter() public {
        _chain(2);
        _route(2, 7); // char 2, treasury 2, pool 3 -> parent 3>>1 = 1, char +2
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
        assertEq(router.earned(treasury), amount * 4000 / 10000);
    }

    function test_SplitConstants() public view {
        assertEq(router.CHARACTER_BPS(), 4_000);
        assertEq(router.TREASURY_BPS(), 4_000);
    }

    /// 40/20/40 split with 0..10 ancestors: every leg matches the formula and the legs sum to `amount`.
    function test_SplitFortyTwentyFortyAllDepths() public {
        _chain(11); // series i has i-1 ancestors
        uint256 amount = 1_234_567; // odd, so rounding dust is exercised
        for (uint256 id = 1; id <= 11; id++) {
            _checkSplit(id, amount);
        }
    }

    function testFuzz_SplitFortyTwentyFortyAllDepths(uint256 amount, uint8 id) public {
        _chain(11);
        _checkSplit(bound(id, 1, 11), bound(amount, 0, 1e30));
    }

    function _checkSplit(uint256 id, uint256 amount) internal {
        uint256[12] memory before;
        for (uint256 i = 1; i <= 11; i++) {
            before[i] = usdc.balanceOf(_account(i));
        }
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        _route(id, amount);

        uint256 char = amount * 4_000 / 10_000;
        uint256 tre = amount * 4_000 / 10_000;
        uint256 pool = amount - char - tre;
        uint256 ancestorsPaid;
        uint256 depth = id - 1 > 8 ? 8 : id - 1;
        for (uint256 d = 1; d <= depth; d++) {
            assertEq(usdc.balanceOf(_account(id - d)) - before[id - d], pool >> d, "ancestor leg");
            ancestorsPaid += pool >> d;
        }
        for (uint256 d = depth + 1; d < id; d++) {
            assertEq(usdc.balanceOf(_account(id - d)), before[id - d], "beyond depth 8 gets nothing");
        }
        uint256 charPaid = usdc.balanceOf(_account(id)) - before[id];
        assertEq(charPaid, char + pool - ancestorsPaid, "character leg");
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, tre, "treasury leg");
        assertEq(charPaid + tre + ancestorsPaid, amount, "sums exactly");
        assertEq(usdc.balanceOf(address(router)), 0);
    }
}
