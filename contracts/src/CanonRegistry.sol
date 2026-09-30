// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {LaunchpadConstants as C} from "./libraries/LaunchpadConstants.sol";

/// @title KOMA canon registry
/// @notice Decides which proposed issue becomes episode N of a series. Coin holders vote off-chain with EIP-712
///         signatures weighted by their on-chain voting power at the slot snapshot; the relayer tallies and
///         commits the result (and the keccak of every accepted vote) on-chain.
contract CanonRegistry is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    struct SeriesConfig {
        IVotes coin;
        IERC721 characterNft;
        uint256 characterId;
        uint64 votingWindow;
        uint64 nextEpisode;
    }

    struct Slot {
        uint64 snapshot;
        uint64 endsAt;
        bool finalized;
        uint256 winner;
        uint256[] proposals;
    }

    struct IssueRef {
        uint256 seriesId;
        uint256 episode;
        address proposer;
    }

    mapping(uint256 seriesId => SeriesConfig) private _series;
    mapping(uint256 seriesId => mapping(uint256 episode => Slot)) private _slots;
    mapping(uint256 issueId => IssueRef) private _issues;

    event SeriesRegistered(uint256 indexed seriesId, address coin, address characterNft, uint256 characterId, uint64 votingWindow);
    event SlotOpened(uint256 indexed seriesId, uint256 indexed episode, uint64 snapshot, uint64 endsAt);
    event Proposed(uint256 indexed seriesId, uint256 indexed episode, uint256 indexed issueId, address proposer);
    event CanonFinalized(
        uint256 indexed seriesId,
        uint256 indexed episode,
        uint256 winnerIssueId,
        bytes32 votesRoot,
        uint256 winnerVotes,
        uint256 totalVotes
    );

    error ZeroAddress();
    error InvalidWindow();
    error SeriesExists(uint256 seriesId);
    error UnknownSeries(uint256 seriesId);
    error InvalidIssue(uint256 issueId);
    error AlreadyProposed(uint256 issueId);
    error NotEligible(address proposer);
    error VotingClosed(uint256 seriesId, uint256 episode);
    error VotingOpen(uint256 seriesId, uint256 episode);
    error SlotNotOpen(uint256 seriesId, uint256 episode);
    error AlreadyFinalized(uint256 seriesId, uint256 episode);
    error NotAProposal(uint256 issueId);
    error InvalidTally();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerSeries(uint256 seriesId, address coin, address characterNft, uint256 characterId, uint64 votingWindow)
        external
        onlyRole(FACTORY_ROLE)
    {
        if (coin == address(0) || characterNft == address(0)) revert ZeroAddress();
        if (votingWindow == 0) revert InvalidWindow();
        if (seriesId == 0 || address(_series[seriesId].coin) != address(0)) revert SeriesExists(seriesId);
        _series[seriesId] = SeriesConfig(IVotes(coin), IERC721(characterNft), characterId, votingWindow, 1);
        emit SeriesRegistered(seriesId, coin, characterNft, characterId, votingWindow);
    }

    /// @notice Proposes `issueId` for the currently open episode, opening its slot on the first proposal.
    ///         Eligible: at least CANON_THRESHOLD votes at the slot snapshot, or owning the Character NFT.
    function propose(uint256 seriesId, uint256 issueId, address proposer)
        external
        onlyRole(RELAYER_ROLE)
        returns (uint256 episode)
    {
        SeriesConfig storage cfg = _config(seriesId);
        if (issueId == 0) revert InvalidIssue(issueId);
        if (_issues[issueId].seriesId != 0) revert AlreadyProposed(issueId);

        episode = cfg.nextEpisode;
        Slot storage s = _slots[seriesId][episode];
        if (s.endsAt == 0) {
            s.snapshot = uint64(block.timestamp - 1);
            s.endsAt = uint64(block.timestamp) + cfg.votingWindow;
            emit SlotOpened(seriesId, episode, s.snapshot, s.endsAt);
        } else if (block.timestamp >= s.endsAt) {
            revert VotingClosed(seriesId, episode);
        }

        if (
            cfg.coin.getPastVotes(proposer, s.snapshot) < C.CANON_THRESHOLD
                && cfg.characterNft.ownerOf(cfg.characterId) != proposer
        ) revert NotEligible(proposer);

        _issues[issueId] = IssueRef(seriesId, episode, proposer);
        s.proposals.push(issueId);
        emit Proposed(seriesId, episode, issueId, proposer);
    }

    function finalize(
        uint256 seriesId,
        uint256 episode,
        uint256 winnerIssueId,
        bytes32 votesRoot,
        uint256 winnerVotes,
        uint256 totalVotes
    ) external onlyRole(RELAYER_ROLE) {
        SeriesConfig storage cfg = _config(seriesId);
        Slot storage s = _slots[seriesId][episode];
        if (s.endsAt == 0) revert SlotNotOpen(seriesId, episode);
        if (s.finalized) revert AlreadyFinalized(seriesId, episode);
        if (block.timestamp < s.endsAt) revert VotingOpen(seriesId, episode);
        IssueRef storage ref = _issues[winnerIssueId];
        if (winnerIssueId == 0 || ref.seriesId != seriesId || ref.episode != episode) revert NotAProposal(winnerIssueId);
        if (winnerVotes > totalVotes) revert InvalidTally();

        s.finalized = true;
        s.winner = winnerIssueId;
        cfg.nextEpisode += 1;
        emit CanonFinalized(seriesId, episode, winnerIssueId, votesRoot, winnerVotes, totalVotes);
    }

    // ------------------------------------------------------------------ views

    function nextEpisode(uint256 seriesId) external view returns (uint256) {
        return _series[seriesId].nextEpisode;
    }

    function slot(uint256 seriesId, uint256 episode)
        external
        view
        returns (uint64 snapshot, uint64 endsAt, bool finalized, uint256 winner, uint256 proposalCount)
    {
        Slot storage s = _slots[seriesId][episode];
        return (s.snapshot, s.endsAt, s.finalized, s.winner, s.proposals.length);
    }

    function proposals(uint256 seriesId, uint256 episode) external view returns (uint256[] memory issueIds) {
        return _slots[seriesId][episode].proposals;
    }

    function canonOf(uint256 seriesId, uint256 episode) external view returns (uint256) {
        return _slots[seriesId][episode].winner;
    }

    function seriesOfIssue(uint256 issueId) external view returns (uint256 seriesId, uint256 episode, address proposer) {
        IssueRef storage r = _issues[issueId];
        return (r.seriesId, r.episode, r.proposer);
    }

    function votingPower(uint256 seriesId, uint256 episode, address voter) external view returns (uint256) {
        Slot storage s = _slots[seriesId][episode];
        if (s.endsAt == 0) return 0;
        return _series[seriesId].coin.getPastVotes(voter, s.snapshot);
    }

    function seriesConfig(uint256 seriesId) external view returns (SeriesConfig memory) {
        return _series[seriesId];
    }

    function _config(uint256 seriesId) private view returns (SeriesConfig storage cfg) {
        cfg = _series[seriesId];
        if (address(cfg.coin) == address(0)) revert UnknownSeries(seriesId);
    }
}
