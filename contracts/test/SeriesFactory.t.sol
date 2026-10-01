// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchpadFixture} from "./utils/LaunchpadFixture.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {SeriesCoin} from "../src/SeriesCoin.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {CurveDeployer} from "../src/deployers/CurveDeployer.sol";
import {CoinDeployer} from "../src/deployers/CoinDeployer.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract SeriesFactoryTest is LaunchpadFixture {
    function test_LaunchWiresEverything() public {
        vm.recordLogs();
        (uint256 id, BondingCurve curve, SeriesCoin coin) = _launch(0, 0, 0);
        assertEq(id, 1);
        assertEq(factory.seriesCount(), 1);
        SeriesFactory.Series memory s = factory.series(id);

        assertEq(s.creator, creator);
        assertEq(s.coin, address(coin));
        assertEq(s.curve, address(curve));
        assertEq(s.graduationTarget, 5_000e6);
        assertEq(s.votingWindow, 86_400);
        assertEq(s.launchedAt, block.timestamp);
        assertEq(s.parentSeriesId, 0);

        // character + TBA
        assertEq(nft.ownerOf(s.characterId), creator);
        assertEq(nft.accountOf(s.characterId), s.characterAccount);
        assertEq(nft.nameOf(s.characterId), "Aki");
        // curve
        assertEq(address(curve.coin()), address(coin));
        assertEq(curve.seriesId(), id);
        assertEq(curve.graduationTarget(), 5_000e6);
        assertEq(address(curve.math()), address(math));
        assertEq(address(curve.router()), address(router));
        assertEq(curve.graduator(), address(graduator));
        // registrations
        assertEq(router.curveOf(id), address(curve));
        assertEq(router.accountOf(id), s.characterAccount);
        assertEq(graduator.curveOf(id), address(curve));
        assertEq(address(canon.seriesConfig(id).coin), address(coin));
        assertEq(canon.seriesConfig(id).characterId, s.characterId);
        // supply
        assertEq(coin.balanceOf(s.vesting), 50_000_000e18);
    }

    function test_LaunchEmits() public {
        vm.expectEmit(true, true, false, false, address(factory));
        emit SeriesFactory.SeriesLaunched(1, creator, address(0), address(0), 1, address(0), 0, 5_000e6, "Moon Ronin", "RONIN");
        _launch(0, 0, 0);
    }

    function test_DemoOverrides() public {
        (uint256 id, BondingCurve curve,) = _launch(0, 25e6, 300);
        assertEq(curve.graduationTarget(), 25e6);
        assertEq(factory.series(id).votingWindow, 300);
        assertEq(canon.seriesConfig(id).votingWindow, 300);
    }

    function test_VestingSchedule() public {
        (uint256 id,, SeriesCoin coin) = _launch(0, 0, 0);
        VestingWallet vesting = VestingWallet(payable(factory.series(id).vesting));
        assertEq(vesting.owner(), creator);
        assertEq(vesting.start(), block.timestamp);
        assertEq(vesting.duration(), 30 days);
        assertEq(vesting.releasable(address(coin)), 0);

        vm.warp(block.timestamp + 15 days);
        assertEq(vesting.releasable(address(coin)), 25_000_000e18);
        vesting.release(address(coin));
        assertEq(coin.balanceOf(creator), 25_000_000e18);
        assertEq(coin.delegates(creator), creator); // released coins vote immediately

        vm.warp(block.timestamp + 15 days);
        vesting.release(address(coin));
        assertEq(coin.balanceOf(creator), 50_000_000e18);
        vm.warp(block.timestamp + 365 days);
        assertEq(vesting.releasable(address(coin)), 0);
    }

    function test_RemixFeesReachParentCharacter() public {
        (uint256 parent,,) = _launch(0, 0, 0);
        (uint256 child, BondingCurve childCurve,) = _launch(parent, 0, 0);
        assertEq(router.parentOf(child), parent);
        address parentAccount = factory.series(parent).characterAccount;
        address childAccount = factory.series(child).characterAccount;
        _buy(childCurve, makeAddr("reader"), 10e6); // fee 0.15 USDC -> char 0.06, pool 0.03 -> parent 0.015
        assertEq(usdc.balanceOf(parentAccount), 0.015e6);
        assertEq(usdc.balanceOf(childAccount), 0.06e6 + 0.015e6);
        assertEq(router.earned(parentAccount), 0.015e6);
    }

    function test_RevertWhen_NotLauncher() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, creator, factory.LAUNCHER_ROLE())
        );
        vm.prank(creator);
        factory.launch(_params(creator, 0, 0, 0));
    }

    function test_RevertWhen_UnknownParent() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.UnknownParent.selector, 1));
        factory.launch(_params(creator, 1, 0, 0));
    }

    function test_RevertWhen_BadParams() public {
        vm.startPrank(relayer);
        vm.expectRevert(SeriesFactory.ZeroAddress.selector);
        factory.launch(_params(address(0), 0, 0, 0));
        SeriesFactory.LaunchParams memory p = _params(creator, 0, 0, 0);
        p.symbol = "";
        vm.expectRevert(SeriesFactory.EmptyName.selector);
        factory.launch(p);
        vm.expectRevert(abi.encodeWithSelector(BondingCurve.InvalidTarget.selector, 50_000e6));
        factory.launch(_params(creator, 0, 50_000e6, 0));
        vm.stopPrank();
    }

    /// AUDIT.md L-2: launch floors (set per chain at deploy) and the voting-window ceiling.
    function test_RevertWhen_LaunchOutsideBounds() public {
        assertEq(factory.minGraduationTarget(), MIN_TARGET);
        assertEq(factory.minVotingWindow(), MIN_WINDOW);
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.TargetTooLow.selector, MIN_TARGET - 1, MIN_TARGET));
        factory.launch(_params(creator, 0, MIN_TARGET - 1, 0));
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.InvalidVotingWindow.selector, MIN_WINDOW - 1));
        factory.launch(_params(creator, 0, 0, MIN_WINDOW - 1));
        uint64 tooLong = factory.MAX_VOTING_WINDOW() + 1;
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.InvalidVotingWindow.selector, tooLong));
        factory.launch(_params(creator, 0, 0, tooLong));
        factory.launch(_params(creator, 0, MIN_TARGET, MIN_WINDOW)); // the floors themselves are allowed
        factory.launch(_params(creator, 0, 0, factory.MAX_VOTING_WINDOW()));
        vm.stopPrank();
    }

    /// Mainnet-style floors (1,000 USDC / 1 h) refuse the testnet demo values (25 USDC / 300 s) and keep defaults.
    function test_MainnetFloorsRejectDemoValues() public {
        SeriesFactory mainnetLike = new SeriesFactory(
            admin, address(usdc), address(math), address(router), address(nft), address(canon), address(graduator),
            treasury, address(new CurveDeployer()), address(new CoinDeployer()), 1_000e6, 3_600
        );
        bytes32 launcher = mainnetLike.LAUNCHER_ROLE();
        vm.prank(admin);
        mainnetLike.grantRole(launcher, relayer);
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.TargetTooLow.selector, 25e6, 1_000e6));
        mainnetLike.launch(_params(creator, 0, 25e6, 0));
        vm.expectRevert(abi.encodeWithSelector(SeriesFactory.InvalidVotingWindow.selector, 300));
        mainnetLike.launch(_params(creator, 0, 0, 300));
        vm.stopPrank();
    }

    function test_RevertWhen_FloorsAboveDefaults() public {
        address cd = address(new CurveDeployer());
        address kd = address(new CoinDeployer());
        vm.expectRevert(SeriesFactory.InvalidBounds.selector);
        new SeriesFactory(admin, address(usdc), address(math), address(router), address(nft), address(canon), address(graduator), treasury, cd, kd, 5_000e6 + 1, 60);
        vm.expectRevert(SeriesFactory.InvalidBounds.selector);
        new SeriesFactory(admin, address(usdc), address(math), address(router), address(nft), address(canon), address(graduator), treasury, cd, kd, 1e6, 86_401);
    }
}
