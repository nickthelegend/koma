// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KomaIssues} from "../src/KomaIssues.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract KomaIssuesTest is Test {
    KomaIssues koma;
    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address reader = makeAddr("reader");
    bytes32 constant HASH = keccak256("issue");
    bytes32 constant PAY = keccak256("pay");

    function setUp() public {
        koma = new KomaIssues(admin, minter, "https://koma.art/api/tokens/");
    }

    function test_MintRecordsIssue() public {
        vm.prank(minter);
        uint256 id = koma.mint(reader, HASH, PAY, 2, 0);
        assertEq(id, 1);
        assertEq(koma.ownerOf(1), reader);
        KomaIssues.Issue memory i = koma.issue(1);
        assertEq(i.contentHash, HASH);
        assertEq(i.paymentTx, PAY);
        assertEq(i.pages, 2);
        assertEq(koma.tokenOfPayment(PAY), 1);
        assertEq(koma.tokenURI(1), "https://koma.art/api/tokens/1");
    }

    function test_RevertWhen_PaymentReused() public {
        vm.startPrank(minter);
        koma.mint(reader, HASH, PAY, 2, 0);
        vm.expectRevert(abi.encodeWithSelector(KomaIssues.PaymentAlreadyUsed.selector, PAY, 1));
        koma.mint(reader, HASH, PAY, 2, 0);
    }

    function test_RevertWhen_NotMinter() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, reader, koma.MINTER_ROLE())
        );
        vm.prank(reader);
        koma.mint(reader, HASH, PAY, 2, 0);
    }

    function test_RemixMustPointAtExistingIssue() public {
        vm.startPrank(minter);
        vm.expectRevert(abi.encodeWithSelector(KomaIssues.UnknownIssue.selector, 7));
        koma.mint(reader, HASH, PAY, 1, 7);
        koma.mint(reader, HASH, PAY, 1, 0);
        uint256 remix = koma.mint(reader, keccak256("remix"), keccak256("pay2"), 1, 1);
        assertEq(koma.issue(remix).remixOf, 1);
    }

    function test_RevertWhen_Empty() public {
        vm.prank(minter);
        vm.expectRevert(KomaIssues.EmptyIssue.selector);
        koma.mint(reader, HASH, PAY, 0, 0);
    }

    function test_AdminCanMoveBaseURI() public {
        vm.prank(minter);
        koma.mint(reader, HASH, PAY, 1, 0);
        vm.prank(admin);
        koma.setBaseURI("ipfs://x/");
        assertEq(koma.tokenURI(1), "ipfs://x/1");
    }
}
