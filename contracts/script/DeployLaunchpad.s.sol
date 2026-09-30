// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KomaIssues} from "../src/KomaIssues.sol";
import {CurveMathReference} from "../src/CurveMathReference.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";
import {CharacterNFT} from "../src/CharacterNFT.sol";
import {CanonRegistry} from "../src/CanonRegistry.sol";
import {Graduator} from "../src/Graduator.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {KomaSwapper} from "../src/KomaSwapper.sol";
import {CurveDeployer} from "../src/deployers/CurveDeployer.sol";
import {CoinDeployer} from "../src/deployers/CoinDeployer.sol";

/// @title Deploy the KOMA launchpad
/// @notice
///   Arbitrum Sepolia (Stylus engine):
///     MATH=0x.. ROUTER=0x.. RELAYER=0x.. TREASURY=0x.. \
///     forge script script/DeployLaunchpad.s.sol --rpc-url arbitrum_sepolia --private-key $DEPLOYER_KEY --broadcast
///     then run the printed `cast send` commands to initialize the Stylus router.
///   Localnet / anvil fork (no Stylus): leave MATH and ROUTER unset; the Solidity references are deployed and wired.
///
///   Env (all optional unless noted): DEPLOYER_KEY (else pass --private-key), USDC, TREASURY, RELAYER,
///   KOMA_ISSUES (existing issues contract; a fresh one is deployed when unset), MATH + ROUTER (Stylus),
///   POOL_MANAGER, POSITION_MANAGER, PERMIT2, ERC6551_REGISTRY, ACCOUNT_PROXY, ACCOUNT_IMPL, BASE_URI,
///   KOMA_BASE_URI, ADDRESSES_OUT (default ../deploy/addresses.<chainId>.json; "none" skips writing).
contract DeployLaunchpad is Script {
    struct Config {
        address deployer;
        address usdc;
        address treasury;
        address relayer;
        address komaIssues;
        address math;
        address router;
        address poolManager;
        address positionManager;
        address permit2;
        address erc6551Registry;
        address accountProxy;
        address accountImpl;
        string baseURI;
        string issuesBaseURI;
    }

    struct Deployment {
        address komaIssues;
        address seriesFactory;
        address characterNft;
        address canonRegistry;
        address graduator;
        address swapper;
        address curveMath;
        address royaltyRouter;
        bool stylus;
        uint256 deployBlock;
    }

    error HalfStylusConfig();

    function run() external returns (Deployment memory d) {
        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0));
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);
        Config memory cfg = _config(deployer);

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        d = _deploy(cfg);
        vm.stopBroadcast();

        d.deployBlock = _chainBlockNumber();
        _log(cfg, d);
        _write(cfg, d);
    }

    function _config(address deployer) internal view returns (Config memory c) {
        c.deployer = deployer;
        c.usdc = vm.envOr("USDC", 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
        c.treasury = vm.envOr("TREASURY", deployer);
        c.relayer = vm.envOr("RELAYER", deployer);
        c.komaIssues = vm.envOr("KOMA_ISSUES", address(0));
        c.math = vm.envOr("MATH", address(0));
        c.router = vm.envOr("ROUTER", address(0));
        if ((c.math == address(0)) != (c.router == address(0))) revert HalfStylusConfig();
        c.poolManager = vm.envOr("POOL_MANAGER", 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317);
        c.positionManager = vm.envOr("POSITION_MANAGER", 0xAc631556d3d4019C95769033B5E719dD77124BAc);
        c.permit2 = vm.envOr("PERMIT2", 0x000000000022D473030F116dDEE9F6B43aC78BA3);
        c.erc6551Registry = vm.envOr("ERC6551_REGISTRY", 0x000000006551c19487814612e58FE06813775758);
        c.accountProxy = vm.envOr("ACCOUNT_PROXY", 0x55266d75D1a14E4572138116aF39863Ed6596E7F);
        c.accountImpl = vm.envOr("ACCOUNT_IMPL", 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC);
        c.baseURI = vm.envOr("BASE_URI", string("http://localhost:4310/api/characters/"));
        c.issuesBaseURI = vm.envOr("KOMA_BASE_URI", string("http://localhost:4310/api/tokens/"));
    }

    function _deploy(Config memory c) internal returns (Deployment memory d) {
        d.stylus = c.math != address(0);
        if (d.stylus) {
            d.curveMath = c.math;
            d.royaltyRouter = c.router;
        } else {
            d.curveMath = address(new CurveMathReference());
            RoyaltyRouterReference router = new RoyaltyRouterReference();
            router.initialize(c.usdc, c.treasury, c.deployer);
            d.royaltyRouter = address(router);
        }

        d.komaIssues = c.komaIssues != address(0)
            ? c.komaIssues
            : address(new KomaIssues(c.deployer, c.relayer, c.issuesBaseURI));

        CharacterNFT nft = new CharacterNFT(c.deployer, c.erc6551Registry, c.accountProxy, c.accountImpl, c.baseURI);
        CanonRegistry canon = new CanonRegistry(c.deployer);
        Graduator graduator =
            new Graduator(c.deployer, c.poolManager, c.positionManager, c.permit2, c.usdc, c.treasury);
        SeriesFactory factory = new SeriesFactory(
            c.deployer,
            c.usdc,
            d.curveMath,
            d.royaltyRouter,
            address(nft),
            address(canon),
            address(graduator),
            c.treasury,
            address(new CurveDeployer()),
            address(new CoinDeployer())
        );
        KomaSwapper swapper = new KomaSwapper(c.poolManager, address(graduator), c.usdc);

        nft.grantRole(nft.MINTER_ROLE(), address(factory));
        canon.grantRole(canon.FACTORY_ROLE(), address(factory));
        canon.grantRole(canon.RELAYER_ROLE(), c.relayer);
        graduator.grantRole(graduator.FACTORY_ROLE(), address(factory));
        factory.grantRole(factory.LAUNCHER_ROLE(), c.relayer);
        if (!d.stylus) RoyaltyRouterReference(d.royaltyRouter).setFactory(address(factory));

        d.seriesFactory = address(factory);
        d.characterNft = address(nft);
        d.canonRegistry = address(canon);
        d.graduator = address(graduator);
        d.swapper = address(swapper);
    }

    /// @dev On Arbitrum `block.number` (and vm.getBlockNumber) is the L1 block number; indexers need the L2
    ///      number the RPC reports, so ask the RPC and fall back to the EVM value when there is none.
    function _chainBlockNumber() internal returns (uint256 n) {
        try vm.rpc("eth_blockNumber", "[]") returns (bytes memory raw) {
            for (uint256 i; i < raw.length; i++) {
                n = (n << 8) | uint8(raw[i]);
            }
        } catch {
            n = vm.getBlockNumber();
        }
    }

    function _log(Config memory c, Deployment memory d) internal view {
        console.log("engine          ", d.stylus ? "stylus" : "solidity-reference");
        console.log("SeriesFactory   ", d.seriesFactory);
        console.log("CharacterNFT    ", d.characterNft);
        console.log("CanonRegistry   ", d.canonRegistry);
        console.log("Graduator       ", d.graduator);
        console.log("KomaSwapper     ", d.swapper);
        console.log("CurveMath       ", d.curveMath);
        console.log("RoyaltyRouter   ", d.royaltyRouter);
        console.log("KomaIssues      ", d.komaIssues);
        if (!d.stylus) return;

        console.log("");
        console.log("Stylus router still needs wiring (launches revert until it is). Run:");
        if (d.royaltyRouter.code.length != 0 && IRoyaltyRouter(d.royaltyRouter).usdc() == address(0)) {
            console.log(
                string.concat(
                    "cast send ",
                    vm.toString(d.royaltyRouter),
                    " \"initialize(address,address,address)\" ",
                    vm.toString(c.usdc),
                    " ",
                    vm.toString(c.treasury),
                    " ",
                    vm.toString(c.deployer),
                    " --rpc-url $RPC_URL --private-key $DEPLOYER_KEY"
                )
            );
        }
        console.log(
            string.concat(
                "cast send ",
                vm.toString(d.royaltyRouter),
                " \"setFactory(address)\" ",
                vm.toString(d.seriesFactory),
                " --rpc-url $RPC_URL --private-key $DEPLOYER_KEY"
            )
        );
    }

    function _write(Config memory c, Deployment memory d) internal {
        string memory out = vm.envOr(
            "ADDRESSES_OUT", string.concat(vm.projectRoot(), "/../deploy/addresses.", vm.toString(block.chainid), ".json")
        );
        if (keccak256(bytes(out)) == keccak256("none")) return;
        string memory k = "launchpad";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "usdc", c.usdc);
        vm.serializeAddress(k, "komaIssues", d.komaIssues);
        vm.serializeAddress(k, "seriesFactory", d.seriesFactory);
        vm.serializeAddress(k, "characterNft", d.characterNft);
        vm.serializeAddress(k, "canonRegistry", d.canonRegistry);
        vm.serializeAddress(k, "graduator", d.graduator);
        vm.serializeAddress(k, "swapper", d.swapper);
        vm.serializeAddress(k, "curveMath", d.curveMath);
        vm.serializeAddress(k, "royaltyRouter", d.royaltyRouter);
        vm.serializeString(k, "engine", d.stylus ? "stylus" : "solidity-reference");
        vm.serializeAddress(k, "poolManager", c.poolManager);
        vm.serializeAddress(k, "positionManager", c.positionManager);
        vm.serializeAddress(k, "permit2", c.permit2);
        vm.serializeAddress(k, "erc6551Registry", c.erc6551Registry);
        vm.serializeAddress(k, "accountProxy", c.accountProxy);
        vm.serializeAddress(k, "accountImpl", c.accountImpl);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "relayer", c.relayer);
        string memory json = vm.serializeUint(k, "deployBlock", d.deployBlock);
        vm.writeJson(json, out);
        console.log("addresses written to", out);
    }
}
