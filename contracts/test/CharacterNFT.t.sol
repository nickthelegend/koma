// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CharacterNFT} from "../src/CharacterNFT.sol";
import {Tokenbound, IAccountV3, IERC6551RegistryFull, ITokenboundProxy, IAccountGuardian} from "./utils/Tokenbound.sol";
import {CircleUSDC, IFiatToken} from "./utils/CircleUSDC.sol";

/// Runs against the real Tokenbound registry / AccountProxy / AccountV3 code (etched from Arbitrum One).
contract CharacterNFTTest is Test {
    CharacterNFT nft;
    IERC6551RegistryFull registry = IERC6551RegistryFull(Tokenbound.REGISTRY);
    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address constant PROXY = Tokenbound.ACCOUNT_PROXY;
    address constant IMPL = Tokenbound.ACCOUNT_IMPL;

    function setUp() public {
        Tokenbound.etch();
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
        assertGt(account.code.length, 0, "account deployed by the real registry");
        (uint256 chainId, address tokenContract, uint256 tokenId) = IAccountV3(account).token();
        assertEq(chainId, block.chainid);
        assertEq(tokenContract, address(nft));
        assertEq(tokenId, 1);
        assertEq(IAccountV3(account).owner(), alice);
        assertEq(nft.tokenURI(1), "https://koma.test/c/1");
    }

    function test_MintToleratesPrecreatedAccount() public {
        // Anyone can call the permissionless registry before the mint lands.
        address pre = registry.createAccount(PROXY, bytes32(0), block.chainid, address(nft), 1);
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        assertEq(account, pre);
        assertEq(IAccountV3(account).owner(), alice);
    }

    /// AUDIT.md I-4: the Tokenbound guardian trusts no implementation (as on Arbitrum One and Sepolia), so the
    /// proxy's `initialize` always reverts. The mint swallows that and the account runs the proxy's immutable
    /// initial implementation (AccountV3); nobody can re-point it either.
    function test_ProxyInitializeIsRejectedAndAccountStillWorks() public {
        assertFalse(IAccountGuardian(Tokenbound.GUARDIAN).isTrustedImplementation(IMPL));
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        vm.expectRevert();
        ITokenboundProxy(account).initialize(IMPL);
        vm.prank(alice);
        IAccountV3(account).execute(bob, 0, "", 0); // a call from the account works
    }

    function test_AccountFollowsNftOwner() public {
        IFiatToken usdc = CircleUSDC.deploy();
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        CircleUSDC.mint(account, 5e6);

        vm.prank(bob);
        vm.expectRevert();
        IAccountV3(account).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 1e6)), 0);

        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert();
        IAccountV3(account).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (alice, 1e6)), 0);
        vm.prank(bob);
        IAccountV3(account).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 5e6)), 0);
        assertEq(usdc.balanceOf(bob), 5e6);
    }

    /// AUDIT.md I-3: AccountV3 lets the holder lock the account; a buyer of a locked character must wait.
    function test_LockedAccountBlocksWithdrawUntilExpiry() public {
        IFiatToken usdc = CircleUSDC.deploy();
        vm.prank(minter);
        (, address account) = nft.mint(alice, "Aki", bytes32(0));
        CircleUSDC.mint(account, 5e6);
        vm.prank(alice);
        IAccountV3(account).lock(block.timestamp + 1 days);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(bob);
        vm.expectRevert();
        IAccountV3(account).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 5e6)), 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        IAccountV3(account).execute(address(usdc), 0, abi.encodeCall(usdc.transfer, (bob, 5e6)), 0);
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
