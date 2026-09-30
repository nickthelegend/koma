// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CharacterNFT} from "../src/CharacterNFT.sol";
import {MockERC6551Registry, MockTokenboundAccount} from "./utils/Mock6551.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";

contract CharacterNFTTest is Test {
    CharacterNFT nft;
    MockERC6551Registry registry;
    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address constant PROXY = address(0xAC0);
    address constant IMPL = address(0x1A1);

    function setUp() public {
        registry = new MockERC6551Registry();
        nft = new CharacterNFT(admin, address(registry), PROXY, IMPL, "https://koma.test/c/");
        vm.startPrank(admin);
        nft.grantRole(nft.MINTER_ROLE(), minter);
        vm.stopPrank();
    }

    function test_MintCreatesInitializedAccount() public {
        address expected = registry.account(PROXY, bytes32(0), block.chainid, address(nft), 1);
        vm.expectEmit(address(nft));
        emit CharacterNFT.CharacterMinted(1, alice, expected, keccak256("sheet"), "Aki");
        vm.prank(minter);
        (uint256 id, address account) = nft.mint(alice, "Aki", keccak256("sheet"));
        assertEq(id, 1);
        assertEq(account, expected);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.accountOf(1), account);
        assertEq(nft.sheetHash(1), keccak256("sheet"));
        assertEq(nft.nameOf(1), "Aki");
        assertEq(MockTokenboundAccount(payable(account)).implementation(), IMPL);
        assertEq(MockTokenboundAccount(payable(account)).owner(), alice);
        assertEq(nft.tokenURI(1), "https://koma.test/c/1");
    }

    function test_MintToleratesPrecreatedAccount() public {
        // Anyone can call the permissionless registry (and initialize) before the mint lands.
        address pre = registry.createAccount(PROXY, bytes32(0), block.chainid, address(nft), 1);
        MockTokenboundAccount(payable(pre)).initialize(IMPL);
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        assertEq(account, pre);
    }

    function test_AccountFollowsNftOwner() public {
        TestUSDC usdc = new TestUSDC();
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        usdc.mint(account, 5e6);

        vm.prank(bob);
        vm.expectRevert(MockTokenboundAccount.NotOwner.selector);
        MockTokenboundAccount(payable(account)).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 1e6)), 0);

        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(bob);
        MockTokenboundAccount(payable(account)).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 5e6)), 0);
        assertEq(usdc.balanceOf(bob), 5e6);
    }

    function test_RevertWhen_NotMinter() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, nft.MINTER_ROLE())
        );
        vm.prank(alice);
        nft.mint(alice, "Aki", bytes32(0));
    }

    function test_RevertWhen_UnknownCharacter() public {
        vm.expectRevert(abi.encodeWithSelector(CharacterNFT.UnknownCharacter.selector, 9));
        nft.accountOf(9);
        vm.expectRevert(abi.encodeWithSelector(CharacterNFT.UnknownCharacter.selector, 9));
        nft.sheetHash(9);
        vm.expectRevert(abi.encodeWithSelector(CharacterNFT.UnknownCharacter.selector, 9));
        nft.nameOf(9);
    }

    function test_AdminSetsBaseURI() public {
        vm.prank(minter);
        nft.mint(alice, "Aki", bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, bytes32(0))
        );
        vm.prank(alice);
        nft.setBaseURI("ipfs://x/");
        vm.prank(admin);
        nft.setBaseURI("ipfs://x/");
        assertEq(nft.tokenURI(1), "ipfs://x/1");
    }

    function test_SupportsInterfaces() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(nft.supportsInterface(type(IAccessControl).interfaceId));
    }
}
