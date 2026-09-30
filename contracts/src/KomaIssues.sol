// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title KOMA issues
/// @notice One token per comic issue. Each token records the hash of the issue's
///         pages and the x402 payment (an Arbitrum USDC transfer) that bought it,
///         so a reader can check the comic they see is the one that was paid for.
contract KomaIssues is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct Issue {
        bytes32 contentHash; // keccak256 of the canonical issue JSON
        bytes32 paymentTx; // tx hash of the x402 settlement
        uint256 remixOf; // 0 when original
        uint64 mintedAt;
        uint16 pages;
    }

    mapping(uint256 tokenId => Issue) private _issues;
    /// @notice A settled payment can mint at most one issue.
    mapping(bytes32 paymentTx => uint256 tokenId) public tokenOfPayment;

    uint256 public totalMinted;
    string private _base;

    event IssueMinted(
        uint256 indexed tokenId,
        address indexed to,
        bytes32 indexed paymentTx,
        bytes32 contentHash,
        uint256 remixOf,
        uint16 pages
    );
    event BaseURIUpdated(string baseURI);

    error PaymentAlreadyUsed(bytes32 paymentTx, uint256 tokenId);
    error UnknownIssue(uint256 tokenId);
    error EmptyIssue();

    constructor(address admin, address minter, string memory baseURI_) ERC721("KOMA Issues", "KOMA") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _base = baseURI_;
    }

    function mint(address to, bytes32 contentHash, bytes32 paymentTx, uint16 pages, uint256 remixOf)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (pages == 0 || contentHash == bytes32(0)) revert EmptyIssue();
        uint256 used = tokenOfPayment[paymentTx];
        if (used != 0) revert PaymentAlreadyUsed(paymentTx, used);
        if (remixOf != 0 && _ownerOf(remixOf) == address(0)) revert UnknownIssue(remixOf);

        tokenId = ++totalMinted;
        tokenOfPayment[paymentTx] = tokenId;
        _issues[tokenId] = Issue(contentHash, paymentTx, remixOf, uint64(block.timestamp), pages);
        _safeMint(to, tokenId);
        emit IssueMinted(tokenId, to, paymentTx, contentHash, remixOf, pages);
    }

    function issue(uint256 tokenId) external view returns (Issue memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownIssue(tokenId);
        return _issues[tokenId];
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _base = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_base, Strings.toString(tokenId));
    }

    function supportsInterface(bytes4 id) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(id);
    }
}
