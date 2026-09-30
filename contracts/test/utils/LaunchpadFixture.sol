// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {CurveMathReference} from "../../src/CurveMathReference.sol";
import {RoyaltyRouterReference} from "../../src/RoyaltyRouterReference.sol";
import {CharacterNFT} from "../../src/CharacterNFT.sol";
import {CanonRegistry} from "../../src/CanonRegistry.sol";
import {Graduator} from "../../src/Graduator.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";
import {KomaSwapper} from "../../src/KomaSwapper.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {SeriesCoin} from "../../src/SeriesCoin.sol";
import {CurveDeployer} from "../../src/deployers/CurveDeployer.sol";
import {CoinDeployer} from "../../src/deployers/CoinDeployer.sol";
import {TestUSDC} from "./TestUSDC.sol";
import {MockERC6551Registry} from "./Mock6551.sol";

/// @notice Full launchpad on a local chain: TestUSDC (EIP-3009), mock ERC-6551 registry, and the real
///         Uniswap v4 PoolManager / PositionManager / Permit2 deployed from their published artifacts.
abstract contract LaunchpadFixture is Test, DeployPermit2 {
    string internal constant POOL_MANAGER_ARTIFACT =
        "../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json";
    string internal constant POSITION_MANAGER_ARTIFACT =
        "../node_modules/@uniswap/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json";
    address internal constant ACCOUNT_PROXY = address(0xAC0);
    address internal constant ACCOUNT_IMPL = address(0x1A1);
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal creator = makeAddr("creator");

    TestUSDC internal usdc;
    IPoolManager internal poolManager;
    IPositionManager internal positionManager;
    address internal permit2;
    MockERC6551Registry internal registry;
    CurveMathReference internal math;
    RoyaltyRouterReference internal router;
    CharacterNFT internal nft;
    CanonRegistry internal canon;
    Graduator internal graduator;
    SeriesFactory internal factory;
    KomaSwapper internal swapper;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        usdc = new TestUSDC();
        permit2 = deployPermit2();
        poolManager = IPoolManager(deployCode(POOL_MANAGER_ARTIFACT, abi.encode(admin)));
        positionManager = IPositionManager(
            deployCode(POSITION_MANAGER_ARTIFACT, abi.encode(poolManager, permit2, 300_000, address(0), address(0)))
        );
        registry = new MockERC6551Registry();

        math = new CurveMathReference();
        router = new RoyaltyRouterReference();
        router.initialize(address(usdc), treasury, admin);
        nft = new CharacterNFT(admin, address(registry), ACCOUNT_PROXY, ACCOUNT_IMPL, "https://koma.test/api/characters/");
        canon = new CanonRegistry(admin);
        graduator = new Graduator(admin, address(poolManager), address(positionManager), permit2, address(usdc), treasury);
        factory = new SeriesFactory(
            admin,
            address(usdc),
            address(math),
            address(router),
            address(nft),
            address(canon),
            address(graduator),
            treasury,
            address(new CurveDeployer()),
            address(new CoinDeployer())
        );
        swapper = new KomaSwapper(address(poolManager), address(graduator), address(usdc));

        vm.startPrank(admin);
        router.setFactory(address(factory));
        nft.grantRole(nft.MINTER_ROLE(), address(factory));
        canon.grantRole(canon.FACTORY_ROLE(), address(factory));
        canon.grantRole(canon.RELAYER_ROLE(), relayer);
        graduator.grantRole(graduator.FACTORY_ROLE(), address(factory));
        factory.grantRole(factory.LAUNCHER_ROLE(), relayer);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _params(address who, uint256 parent, uint256 target, uint64 window)
        internal
        pure
        returns (SeriesFactory.LaunchParams memory)
    {
        return SeriesFactory.LaunchParams({
            creator: who,
            name: "Moon Ronin",
            symbol: "RONIN",
            characterName: "Aki",
            sheetHash: keccak256("sheet"),
            parentSeriesId: parent,
            graduationTarget: target,
            votingWindow: window
        });
    }

    function _launch(uint256 parent, uint256 target, uint64 window)
        internal
        returns (uint256 id, BondingCurve curve, SeriesCoin coin)
    {
        vm.prank(relayer);
        id = factory.launch(_params(creator, parent, target, window));
        SeriesFactory.Series memory s = factory.series(id);
        curve = BondingCurve(s.curve);
        coin = SeriesCoin(s.coin);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
    }

    function _buy(BondingCurve curve, address who, uint256 usdcIn) internal returns (uint256 out) {
        _fund(who, usdcIn);
        vm.startPrank(who);
        usdc.approve(address(curve), usdcIn);
        out = curve.buy(usdcIn, 0, who);
        vm.stopPrank();
    }

    function _pastSnipe() internal {
        vm.warp(block.timestamp + 601);
    }

    /// @dev Buys with fresh wallets until the curve completes (each buyer stays well under the snipe cap).
    function _complete(BondingCurve curve) internal {
        uint256 i;
        while (!curve.complete()) {
            (,, uint256 raised, uint256 target,,,) = curve.state();
            uint256 chunk = (target - raised) * 102 / 100 + 1;
            if (chunk > 200e6) chunk = 200e6;
            _buy(curve, address(uint160(0xB000 + i++)), chunk);
        }
    }

    function _signReceive(
        uint256 pk,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(pk), to, value, validAfter, validBefore, nonce
            )
        );
        (v, r, s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }
}
