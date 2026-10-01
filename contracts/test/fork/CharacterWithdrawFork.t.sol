// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {DeployLaunchpad} from "../../script/DeployLaunchpad.s.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {CharacterNFT} from "../../src/CharacterNFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITokenboundAccountV3 {
    function owner() external view returns (address);
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

/// Character earnings withdrawal on real Arbitrum Sepolia contracts (AUDIT.md section 3): Circle USDC, the
/// ERC-6551 registry + Tokenbound AccountV3, the launchpad deployed by the real DeployLaunchpad script.
/// There is no pooled balance: the router pushes the character's share into the character's Tokenbound
/// account in the trade itself, and only the current Character NFT holder can move it out with `execute`.
///   FORK_TESTS=1 forge test --match-path "test/fork/*" -vv
contract CharacterWithdrawForkTest is ForkBase {
    SeriesFactory factory;
    CharacterNFT nft;
    address relayer = makeAddr("koma-fork-relayer");
    address treasury = makeAddr("koma-fork-treasury");
    address creator;
    address buyer;
    address stranger = makeAddr("koma-fork-stranger");
    address newOwner = makeAddr("koma-fork-new-owner");
    uint256 characterId;
    ITokenboundAccountV3 account;
    BondingCurve curve;

    function setUp() public {
        _fork();
        (address deployer, uint256 deployerPk) = _wallet("deployer");
        vm.deal(deployer, 1 ether);
        vm.setEnv("DEPLOYER_KEY", vm.toString(bytes32(deployerPk)));
        vm.setEnv("RELAYER", vm.toString(relayer));
        vm.setEnv("TREASURY", vm.toString(treasury));
        vm.setEnv("MATH", vm.toString(address(0)));
        vm.setEnv("ROUTER", vm.toString(address(0)));
        vm.setEnv("KOMA_ISSUES", vm.toString(address(0)));
        vm.setEnv("ADDRESSES_OUT", "none");
        DeployLaunchpad.Deployment memory d = new DeployLaunchpad().run();
        factory = SeriesFactory(d.seriesFactory);
        nft = CharacterNFT(d.characterNft);

        (creator,) = _wallet("creator");
        (buyer,) = _wallet("buyer");
        vm.prank(relayer);
        uint256 id = factory.launch(
            SeriesFactory.LaunchParams({
                creator: creator,
                name: "Moon Ronin",
                symbol: "RONIN",
                characterName: "Aki",
                sheetHash: keccak256("sheet"),
                parentSeriesId: 0,
                graduationTarget: 0,
                votingWindow: 0
            })
        );
        SeriesFactory.Series memory s = factory.series(id);
        curve = BondingCurve(s.curve);
        characterId = s.characterId;
        account = ITokenboundAccountV3(s.characterAccount);
        assertGt(address(account).code.length, 0, "real Tokenbound account");
        assertEq(account.owner(), creator);
        vm.warp(block.timestamp + 601); // past the anti-snipe window
    }

    function _buy(uint256 usdcIn) internal {
        _dealUsdc(buyer, usdcIn);
        vm.startPrank(buyer);
        usdc.approve(address(curve), usdcIn);
        curve.buy(usdcIn, 0, buyer);
        vm.stopPrank();
    }

    function _withdrawCall(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeCall(IERC20.transfer, (to, amount));
    }

    function test_Fork_CharacterEarningsWithdrawnOnlyByNftOwner() public {
        // 1. A real curve buy accrues the fee share in the character account.
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        _buy(100e6); // fee = 1.5 USDC: 0.6 character + 0.3 remix pool (no parent: to the character) + 0.6 treasury
        assertEq(usdc.balanceOf(address(account)), 0.9e6, "character share (60% with no parent)");
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 0.6e6, "treasury share");
        assertEq(usdc.balanceOf(address(factory.router())), 0, "the router holds nothing (push payments)");

        // 2. A non-owner cannot move it.
        vm.prank(stranger);
        vm.expectRevert();
        account.execute(USDC, 0, _withdrawCall(stranger, 0.9e6), 0);
        vm.prank(relayer);
        vm.expectRevert();
        account.execute(USDC, 0, _withdrawCall(relayer, 0.9e6), 0);

        // 3. The NFT owner withdraws through `execute`: a real USDC Transfer from the account, exact balances.
        uint256 creatorBefore = usdc.balanceOf(creator);
        vm.expectEmit(true, true, false, true, USDC);
        emit IERC20.Transfer(address(account), creator, 0.4e6);
        vm.prank(creator);
        bytes memory ret = account.execute(USDC, 0, _withdrawCall(creator, 0.4e6), 0);
        assertTrue(abi.decode(ret, (bool)));
        assertEq(usdc.balanceOf(creator) - creatorBefore, 0.4e6);
        assertEq(usdc.balanceOf(address(account)), 0.5e6);

        // 4. After the NFT changes hands, only the new owner can withdraw (earnings travel with the character).
        vm.prank(creator);
        nft.transferFrom(creator, newOwner, characterId);
        assertEq(account.owner(), newOwner);
        _buy(10e6); // +0.09 USDC accrues for the new owner
        assertEq(usdc.balanceOf(address(account)), 0.5e6 + 0.09e6);
        vm.prank(creator);
        vm.expectRevert();
        account.execute(USDC, 0, _withdrawCall(creator, 0.59e6), 0);

        vm.expectEmit(true, true, false, true, USDC);
        emit IERC20.Transfer(address(account), newOwner, 0.59e6);
        vm.prank(newOwner);
        account.execute(USDC, 0, _withdrawCall(newOwner, 0.59e6), 0);
        assertEq(usdc.balanceOf(newOwner), 0.59e6);
        assertEq(usdc.balanceOf(address(account)), 0);
        assertEq(usdc.balanceOf(creator) - creatorBefore, 0.4e6, "old owner got nothing more");
    }
}
