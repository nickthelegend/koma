// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {DeployLaunchpad} from "../../script/DeployLaunchpad.s.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {SeriesCoin} from "../../src/SeriesCoin.sol";
import {KomaSwapper} from "../../src/KomaSwapper.sol";
import {Graduator} from "../../src/Graduator.sol";
import {RoyaltyRouterReference} from "../../src/RoyaltyRouterReference.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// Full lifecycle against real Arbitrum Sepolia contracts: Circle USDC (EIP-3009 signatures), the ERC-6551
/// registry + Tokenbound accounts, and the Uniswap v4 PoolManager / PositionManager / Permit2. The system is
/// deployed by the real DeployLaunchpad script (Solidity reference engine).
///   FORK_TESTS=1 forge test --match-path "test/fork/*" -vv
contract LaunchpadForkTest is ForkBase {
    DeployLaunchpad.Deployment d;
    SeriesFactory factory;
    address relayer = makeAddr("koma-fork-relayer");
    address treasury = makeAddr("koma-fork-treasury");
    address deployer;

    function setUp() public {
        _fork();
        uint256 deployerPk;
        (deployer, deployerPk) = _wallet("deployer");
        vm.deal(deployer, 1 ether);
        vm.setEnv("DEPLOYER_KEY", vm.toString(bytes32(deployerPk)));
        vm.setEnv("RELAYER", vm.toString(relayer));
        vm.setEnv("TREASURY", vm.toString(treasury));
        vm.setEnv("MATH", vm.toString(address(0)));
        vm.setEnv("ROUTER", vm.toString(address(0)));
        vm.setEnv("KOMA_ISSUES", vm.toString(address(0)));
        vm.setEnv("ADDRESSES_OUT", "none");
        d = new DeployLaunchpad().run();
        factory = SeriesFactory(d.seriesFactory);
    }

    function test_Fork_DeployWiring() public view {
        assertFalse(d.stylus);
        assertTrue(factory.hasRole(factory.LAUNCHER_ROLE(), relayer));
        assertTrue(factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), deployer));
        RoyaltyRouterReference router = RoyaltyRouterReference(d.royaltyRouter);
        assertEq(router.factory(), d.seriesFactory);
        assertEq(router.usdc(), USDC);
        assertEq(router.treasury(), treasury);
        assertEq(address(Graduator(d.graduator).poolManager()), POOL_MANAGER);
    }

    uint256 id;
    BondingCurve curve;
    SeriesCoin coin;
    address characterAccount;
    address buyer;
    uint256 buyerPk;

    function test_Fork_LaunchBuyGraduateSwap() public {
        _stageLaunch();
        _stageGaslessBuy();
        _stageGaslessSell();
        _stageFillAndGraduate();
        _stageSwaps();
    }

    function _stageLaunch() internal {
        (address creator,) = _wallet("creator");
        (buyer, buyerPk) = _wallet("buyer");
        vm.prank(relayer);
        id = factory.launch(
            SeriesFactory.LaunchParams({
                creator: creator,
                name: "Moon Ronin",
                symbol: "RONIN",
                characterName: "Aki",
                sheetHash: keccak256("sheet"),
                parentSeriesId: 0,
                graduationTarget: 25e6,
                votingWindow: 300
            })
        );
        SeriesFactory.Series memory s = factory.series(id);
        curve = BondingCurve(s.curve);
        coin = SeriesCoin(s.coin);
        characterAccount = s.characterAccount;
        assertGt(characterAccount.code.length, 0, "real TBA deployed");
    }

    /// Real Circle USDC EIP-3009 signature, submitted by the relayer.
    function _stageGaslessBuy() internal {
        _dealUsdc(buyer, 10e6);
        uint256 deadline = block.timestamp + 600;
        (uint256 quoted,,) = curve.quoteBuy(10e6);
        bytes32 nonce = curve.buyNonce(buyer, 10e6, quoted, deadline, "fork");
        (uint8 v, bytes32 r, bytes32 sig) = _signReceive(buyerPk, address(curve), 10e6, nonce);
        vm.prank(relayer);
        uint256 coins =
            curve.buyWithAuthorization(buyer, 10e6, quoted, deadline, "fork", 0, block.timestamp + 1 hours, v, r, sig);
        assertEq(coins, quoted);
        assertTrue(usdc.authorizationState(buyer, nonce));
        // 1.5% fee = 0.15 USDC; no parent: 40% + the 20% pool to the TBA, 40% to the treasury
        assertEq(usdc.balanceOf(characterAccount), 0.09e6, "60% of the 0.15 USDC fee to the TBA");
        assertEq(usdc.balanceOf(treasury), 0.06e6);
    }

    /// Coin permit + EIP-712 intent.
    function _stageGaslessSell() internal {
        uint256 deadline = block.timestamp + 600;
        uint256 half = coin.balanceOf(buyer) / 2;
        (uint256 q,) = curve.quoteSell(half);
        (uint8 pv, bytes32 pr, bytes32 ps) = _permit(buyerPk, address(curve), half, deadline);
        bytes memory intent = _intent(buyerPk, half, q, deadline);
        vm.prank(relayer);
        uint256 got = curve.sellWithPermit(buyer, half, q, deadline, pv, pr, ps, intent);
        assertEq(got, q);
        assertEq(usdc.balanceOf(buyer), q);
    }

    function _stageFillAndGraduate() internal {
        vm.warp(block.timestamp + 601);
        for (uint256 i; !curve.complete(); i++) {
            address b = makeAddr(string.concat("koma-fork-b", vm.toString(i)));
            _dealUsdc(b, 10e6);
            vm.startPrank(b);
            usdc.approve(address(curve), 10e6);
            curve.buy(10e6, 0, b);
            vm.stopPrank();
        }
        assertEq(curve.raised(), 25e6);

        (uint256 vU, uint256 vC,,,,,) = curve.state();
        uint160 want = address(usdc) < address(coin)
            ? uint160(Math.sqrt(FullMath.mulDiv(vC, 1 << 192, vU)))
            : uint160(Math.sqrt(FullMath.mulDiv(vU, 1 << 192, vC)));
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.expectEmit(true, false, false, true, d.graduator);
        emit Graduator.GraduationFee(id, 1.25e6); // 5% of 25 USDC
        bytes32 poolId = curve.graduate();
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(IPoolManager(POOL_MANAGER), PoolId.wrap(poolId));
        assertEq(sqrtP, want, "pool opens at the curve's final price");
        // coins are the abundant side at $25: the treasury gets the fee plus at most 1 unit of mint dust
        assertGe(usdc.balanceOf(treasury) - treasuryBefore, 1.25e6);
        assertLe(usdc.balanceOf(treasury) - treasuryBefore, 1.25e6 + 1);
        assertGt(StateLibrary.getLiquidity(IPoolManager(POOL_MANAGER), PoolId.wrap(poolId)), 0);
        assertEq(IERC721(POSITION_MANAGER).ownerOf(_lastPositionId()), 0x000000000000000000000000000000000000dEaD);
        assertEq(coin.balanceOf(address(curve)), 0);
        assertEq(usdc.balanceOf(address(curve)), 0);
    }

    function _stageSwaps() internal {
        KomaSwapper swapper = KomaSwapper(d.swapper);
        (address trader,) = _wallet("trader");
        _dealUsdc(trader, 5e6);
        vm.startPrank(trader);
        usdc.approve(address(swapper), 5e6);
        uint256 bought = swapper.swapExactIn(id, true, 5e6, 1, trader);
        assertEq(coin.balanceOf(trader), bought);
        coin.approve(address(swapper), bought);
        uint256 back = swapper.swapExactIn(id, false, bought, 1, trader);
        vm.stopPrank();
        assertGt(back, 4.9e6);
        assertLt(back, 5e6);

        // gasless post-graduation buy with a real USDC signature
        _dealUsdc(buyer, 2e6);
        uint256 deadline = block.timestamp + 600;
        bytes32 nonce = swapper.swapNonce(buyer, id, 2e6, 1, deadline, "fork");
        (uint8 v, bytes32 r, bytes32 sig) = _signReceive(buyerPk, address(swapper), 2e6, nonce);
        uint256 before = coin.balanceOf(buyer);
        vm.prank(relayer);
        uint256 out =
            swapper.swapWithAuthorization(buyer, id, 2e6, 1, deadline, "fork", 0, block.timestamp + 1 hours, v, r, sig);
        assertGt(out, 0);
        assertEq(coin.balanceOf(buyer) - before, out);
    }

    function _lastPositionId() internal view returns (uint256) {
        (bool ok, bytes memory ret) = POSITION_MANAGER.staticcall(abi.encodeWithSignature("nextTokenId()"));
        require(ok);
        return abi.decode(ret, (uint256)) - 1;
    }

    function _permit(uint256 pk, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                vm.addr(pk),
                spender,
                value,
                coin.nonces(vm.addr(pk)),
                deadline
            )
        );
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", coin.DOMAIN_SEPARATOR(), structHash)));
    }

    function _intent(uint256 pk, uint256 coinIn, uint256 minOut, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        address seller = vm.addr(pk);
        bytes32 structHash =
            keccak256(abi.encode(curve.SELL_TYPEHASH(), seller, coinIn, minOut, deadline, curve.sellNonces(seller)));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", curve.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }
}
