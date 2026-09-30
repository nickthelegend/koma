// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {CharacterNFT} from "../../src/CharacterNFT.sol";

interface IAccountV3 {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function owner() external view returns (address);
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

interface IRegistry {
    function account(address, bytes32, uint256, address, uint256) external view returns (address);
}

/// FORK_TESTS=1 forge test --match-path "test/fork/*" -vv
contract CharacterNFTForkTest is ForkBase {
    CharacterNFT nft;
    address minter = makeAddr("minter");

    function setUp() public {
        _fork();
        nft = new CharacterNFT(address(this), ERC6551_REGISTRY, ACCOUNT_PROXY, ACCOUNT_IMPL, "https://koma.test/c/");
        nft.grantRole(nft.MINTER_ROLE(), minter);
    }

    function test_Fork_MintCreatesRealTokenboundAccount() public {
        (address alice,) = _wallet("alice");
        address bob = makeAddr("bob");
        vm.prank(minter);
        (uint256 id, address account) = nft.mint(alice, "Aki", keccak256("sheet"));

        assertEq(account, IRegistry(ERC6551_REGISTRY).account(ACCOUNT_PROXY, bytes32(0), block.chainid, address(nft), id));
        assertGt(account.code.length, 0);
        (uint256 chainId, address tokenContract, uint256 tokenId) = IAccountV3(account).token();
        assertEq(chainId, 421614);
        assertEq(tokenContract, address(nft));
        assertEq(tokenId, id);
        assertEq(IAccountV3(account).owner(), alice);

        // Royalties land in the TBA; only the NFT holder can move them.
        _dealUsdc(account, 7e6);
        bytes memory transferCall = abi.encodeWithSignature("transfer(address,uint256)", bob, 3e6);
        vm.prank(bob);
        vm.expectRevert();
        IAccountV3(account).execute(USDC, 0, transferCall, 0);

        vm.prank(alice);
        IAccountV3(account).execute(USDC, 0, transferCall, 0);
        assertEq(usdc.balanceOf(bob), 3e6);
        assertEq(usdc.balanceOf(account), 4e6);

        // Selling the character sells the earnings.
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        assertEq(IAccountV3(account).owner(), bob);
        vm.prank(bob);
        IAccountV3(account).execute(USDC, 0, abi.encodeWithSignature("transfer(address,uint256)", bob, 4e6), 0);
        assertEq(usdc.balanceOf(bob), 7e6);
    }
}
