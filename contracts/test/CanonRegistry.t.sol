// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {CanonRegistry} from "../src/CanonRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract CanonRegistryTest is LaunchpadFixture {
    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    address whale = makeAddr("whale");
    address minnow = makeAddr("minnow");
    uint64 constant WINDOW = 300;

    function setUp() public override {
        super.setUp();
        (id, curve, coin) = _launch(0, 0, WINDOW);
        _buy(curve, whale, 2e6); // ~2M coins >= 1M threshold
        _buy(curve, minnow, 0.5e6); // ~0.5M coins
        vm.warp(block.timestamp + 1);
    }

    function _propose(uint256 issueId, address proposer) internal returns (uint256) {
        vm.prank(relayer);
        return canon.propose(id, issueId, proposer);
    }

    function test_SeriesRegisteredByFactory() public view {
        CanonRegistry.SeriesConfig memory cfg = canon.seriesConfig(id);
        assertEq(address(cfg.coin), address(coin));
        assertEq(address(cfg.characterNft), address(nft));
        assertEq(cfg.votingWindow, WINDOW);
        assertEq(canon.nextEpisode(id), 1);
    }

    function test_RevertWhen_RegisterNotFactory() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), canon.FACTORY_ROLE())
        );
        canon.registerSeries(9, address(coin), address(nft), 1, 60);
    }

    function test_RevertWhen_RegisterTwiceOrBadWindow() public {
        vm.startPrank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.SeriesExists.selector, id));
        canon.registerSeries(id, address(coin), address(nft), 1, 60);
        vm.expectRevert(CanonRegistry.InvalidWindow.selector);
        canon.registerSeries(9, address(coin), address(nft), 1, 0);
        vm.stopPrank();
    }

    function test_HolderAboveThresholdOpensSlot() public {
        vm.expectEmit(address(canon));
        emit CanonRegistry.SlotOpened(id, 1, uint64(block.timestamp - 1), uint64(block.timestamp + WINDOW));
        vm.expectEmit(address(canon));
        emit CanonRegistry.Proposed(id, 1, 11, whale);
        uint256 ep = _propose(11, whale);
        assertEq(ep, 1);
        (uint64 snapshot, uint64 endsAt, bool finalized, uint256 winner, uint256 count) = canon.slot(id, 1);
        assertEq(snapshot, block.timestamp - 1);
        assertEq(endsAt, block.timestamp + WINDOW);
        assertFalse(finalized);
        assertEq(winner, 0);
        assertEq(count, 1);
        (uint256 sid, uint256 episode, address proposer) = canon.seriesOfIssue(11);
        assertEq(abi.encode(sid, episode, proposer), abi.encode(id, uint256(1), whale));
        assertEq(canon.votingPower(id, 1, whale), coin.balanceOf(whale));
    }

    function test_RevertWhen_BelowThreshold() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.NotEligible.selector, minnow));
        canon.propose(id, 11, minnow);
    }

    function test_VotesBoughtAfterSnapshotDoNotCount() public {
        _propose(11, whale); // snapshot = now - 1
        _buy(curve, minnow, 2e6); // minnow now holds > 1M coins, but only after the snapshot
        assertGt(coin.getVotes(minnow), 1_000_000e18);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.NotEligible.selector, minnow));
        canon.propose(id, 12, minnow);
        assertLt(canon.votingPower(id, 1, minnow), 1_000_000e18);
    }

    function test_CharacterOwnerCanPropose() public {
        assertEq(coin.getVotes(creator), 0);
        _propose(11, creator);
        // and after selling the NFT, the new owner can
        uint256 characterId = factory.series(id).characterId;
        vm.prank(creator);
        nft.transferFrom(creator, minnow, characterId);
        _propose(12, minnow);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.NotEligible.selector, creator));
        canon.propose(id, 13, creator);
    }

    function test_RevertWhen_ProposeNotRelayer() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, whale, canon.RELAYER_ROLE())
        );
        vm.prank(whale);
        canon.propose(id, 11, whale);
    }

    function test_RevertWhen_IssueProposedTwice() public {
        _propose(11, whale);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.AlreadyProposed.selector, 11));
        canon.propose(id, 11, creator);
    }

    function test_RevertWhen_UnknownSeriesOrZeroIssue() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.UnknownSeries.selector, 99));
        canon.propose(99, 11, whale);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.InvalidIssue.selector, 0));
        canon.propose(id, 0, whale);
        vm.stopPrank();
    }

    function test_RevertWhen_ProposeAfterWindow() public {
        _propose(11, whale);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.VotingClosed.selector, id, 1));
        canon.propose(id, 12, whale);
    }

    function test_FinalizeFlow() public {
        _propose(11, whale);
        _propose(12, creator);
        uint256[] memory ids = canon.proposals(id, 1);
        assertEq(ids.length, 2);
        assertEq(ids[1], 12);

        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.VotingOpen.selector, id, 1));
        canon.finalize(id, 1, 12, bytes32("root"), 5, 9);

        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.NotAProposal.selector, 77));
        canon.finalize(id, 1, 77, bytes32("root"), 5, 9);
        vm.expectRevert(CanonRegistry.InvalidTally.selector);
        canon.finalize(id, 1, 12, bytes32("root"), 10, 9);

        vm.expectEmit(address(canon));
        emit CanonRegistry.CanonFinalized(id, 1, 12, bytes32("root"), 5, 9);
        canon.finalize(id, 1, 12, bytes32("root"), 5, 9);
        assertEq(canon.canonOf(id, 1), 12);
        assertEq(canon.nextEpisode(id), 2);
        (,, bool finalized, uint256 winner,) = canon.slot(id, 1);
        assertTrue(finalized);
        assertEq(winner, 12);

        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.AlreadyFinalized.selector, id, 1));
        canon.finalize(id, 1, 12, bytes32("root"), 5, 9);
        vm.stopPrank();

        // episode 2 opens fresh on the next proposal, and an episode-1 issue cannot win it
        uint256 ep = _propose(13, whale);
        assertEq(ep, 2);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.NotAProposal.selector, 11));
        canon.finalize(id, 2, 11, bytes32(0), 0, 0);
    }

    function test_RevertWhen_FinalizeUnopenedSlot() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CanonRegistry.SlotNotOpen.selector, id, 1));
        canon.finalize(id, 1, 11, bytes32(0), 0, 0);
    }

    function test_RevertWhen_FinalizeNotRelayer() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), canon.RELAYER_ROLE())
        );
        canon.finalize(id, 1, 11, bytes32(0), 0, 0);
    }

    function test_VotingPowerZeroBeforeSlot() public view {
        assertEq(canon.votingPower(id, 1, whale), 0);
    }
}
