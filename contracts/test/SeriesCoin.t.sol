// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";

contract SeriesCoinTest is LaunchpadFixture {
    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        (id, curve, coin) = _launch(0, 25e6, 300);
    }

    function test_SupplySplit() public view {
        assertEq(coin.totalSupply(), 1_000_000_000e18);
        assertEq(coin.balanceOf(address(curve)), 950_000_000e18);
        assertEq(coin.balanceOf(factory.series(id).vesting), 50_000_000e18);
        assertEq(coin.name(), "Moon Ronin");
        assertEq(coin.symbol(), "RONIN");
        assertEq(coin.decimals(), 18);
        assertEq(coin.curve(), address(curve));
    }

    function test_TimestampClock() public {
        assertEq(coin.clock(), block.timestamp);
        assertEq(coin.CLOCK_MODE(), "mode=timestamp");
        vm.roll(block.number + 1000); // block number moves without the clock following
        assertEq(coin.clock(), block.timestamp);
    }

    function test_AutoSelfDelegation() public {
        assertEq(coin.delegates(address(curve)), address(curve));
        uint256 out = _buy(curve, alice, 5e6);
        assertEq(coin.delegates(alice), alice);
        assertEq(coin.getVotes(alice), out);

        vm.prank(alice);
        coin.transfer(bob, out / 4);
        assertEq(coin.delegates(bob), bob);
        assertEq(coin.getVotes(bob), out / 4);
        assertEq(coin.getVotes(alice), out - out / 4);
    }

    function test_ExplicitDelegationIsKept() public {
        uint256 out = _buy(curve, alice, 5e6);
        vm.prank(alice);
        coin.delegate(bob);
        _buy(curve, alice, 1e6); // receiving again must not reset the delegate
        assertEq(coin.delegates(alice), bob);
        assertEq(coin.getVotes(alice), 0);
        assertGt(coin.getVotes(bob), out);
    }

    function test_PastVotesUseTimestamps() public {
        uint256 t0 = block.timestamp;
        uint256 out = _buy(curve, alice, 5e6);
        vm.warp(t0 + 10);
        assertEq(coin.getPastVotes(alice, t0 - 1), 0);
        assertEq(coin.getPastVotes(alice, t0), out);
    }

    function test_PermitSharesNoncesWithVotes() public {
        uint256 pk = 0xA11CE;
        address owner = vm.addr(pk);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                bob,
                1e18,
                0,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", coin.DOMAIN_SEPARATOR(), structHash)));
        coin.permit(owner, bob, 1e18, deadline, v, r, s);
        assertEq(coin.allowance(owner, bob), 1e18);
        assertEq(coin.nonces(owner), 1);
    }

    function test_RevertWhen_SentToPoolManagerBeforeGraduation() public {
        uint256 out = _buy(curve, alice, 5e6);
        vm.prank(alice);
        vm.expectRevert(SeriesCoin.PoolLockedUntilGraduation.selector);
        coin.transfer(address(poolManager), out);
    }

    function test_PoolManagerUnlockedAfterGraduation() public {
        uint256 out = _buy(curve, alice, 5e6);
        _pastSnipe();
        _complete(curve);
        curve.graduate();
        vm.prank(alice);
        coin.transfer(address(poolManager), out); // a donation, but allowed now
    }
}
