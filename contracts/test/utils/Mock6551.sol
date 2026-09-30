// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/// @notice Minimal stand-in for a Tokenbound AccountV3 behind its AccountProxy: the account learns its NFT
///         from the registry at creation, `initialize` is one-shot, and only the NFT owner can `execute`.
contract MockTokenboundAccount {
    address public implementation;
    address public immutable tokenContract;
    uint256 public immutable tokenId;

    error AlreadyInitialized();
    error NotOwner();

    constructor(address tokenContract_, uint256 tokenId_) {
        tokenContract = tokenContract_;
        tokenId = tokenId_;
    }

    function initialize(address impl) external {
        if (implementation != address(0)) revert AlreadyInitialized();
        implementation = impl;
    }

    function owner() public view returns (address) {
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (msg.sender != owner() || operation != 0) revert NotOwner();
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

/// @notice ERC-6551-shaped registry: deterministic CREATE2 accounts, idempotent `createAccount`.
contract MockERC6551Registry {
    event ERC6551AccountCreated(address account, address indexed implementation, bytes32 salt, uint256 chainId, address indexed tokenContract, uint256 indexed tokenId);

    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        returns (address acct)
    {
        acct = account(implementation, salt, chainId, tokenContract, tokenId);
        if (acct.code.length != 0) return acct;
        bytes32 s = keccak256(abi.encode(implementation, salt, chainId));
        acct = address(new MockTokenboundAccount{salt: s}(tokenContract, tokenId));
        emit ERC6551AccountCreated(acct, implementation, salt, chainId, tokenContract, tokenId);
    }

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        public
        view
        returns (address)
    {
        bytes32 s = keccak256(abi.encode(implementation, salt, chainId));
        bytes32 initHash =
            keccak256(abi.encodePacked(type(MockTokenboundAccount).creationCode, abi.encode(tokenContract, tokenId)));
        return Create2.computeAddress(s, initHash);
    }
}
