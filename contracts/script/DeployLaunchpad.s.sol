// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
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
/// @notice Runbook for Arbitrum One: deploy/MAINNET.md. Summary:
///
///   Arbitrum One (42161) — Stylus engine only, keystore signer only, admin handed to a Safe:
///     MATH=0x.. ROUTER=0x.. ADMIN=<Safe> TREASURY=<Safe/treasury> RELAYER=<server key> \
///     BASE_URI=https://.../api/characters/ KOMA_BASE_URI=https://.../api/tokens/ \
///     forge script script/DeployLaunchpad.s.sol --rpc-url arbitrum --account <keystore> --sender <addr> --broadcast
///   Arbitrum Sepolia (421614) / KOMA localnet (Sepolia fork): same, or leave MATH/ROUTER unset to deploy the
///   Solidity reference engine (anvil cannot run Stylus). DEPLOYER_KEY works off-mainnet only.
///
///   Addresses come from a per-chain book (42161 and 421614; the hosted localnet 4216141 is a Sepolia fork).
///   On 42161 an env override that differs from the book is refused. Other chains need every address in env.
///
///   Env: MATH + ROUTER (Stylus programs; both or neither), ADMIN (default: deployer, off-mainnet only), TREASURY,
///   RELAYER, KOMA_ISSUES (existing issues contract; else a fresh one), BASE_URI, KOMA_BASE_URI,
///   MIN_GRADUATION_TARGET / MIN_VOTING_WINDOW (launch floors; default 1,000 USDC / 1 h on 42161, 1 USDC / 60 s
///   elsewhere), ALLOW_EOA_ADMIN (42161: accept an ADMIN without code), USDC, POOL_MANAGER, POSITION_MANAGER,
///   PERMIT2, V4_QUOTER, ERC6551_REGISTRY, ACCOUNT_PROXY, ACCOUNT_IMPL, ADDRESSES_OUT (default
///   ../deploy/addresses.<chainId>.json; "none" skips writing).
///
///   At the end the deployer holds no role anywhere (when ADMIN != deployer): ADMIN gets DEFAULT_ADMIN_ROLE on
///   every AccessControl contract and the router's ownership, RELAYER only the operational roles.
contract DeployLaunchpad is Script {
    uint256 internal constant ARBITRUM_ONE = 42161;
    uint256 internal constant ARBITRUM_SEPOLIA = 421614;
    uint256 internal constant KOMA_HOSTED_LOCALNET = 4216141; // anvil fork of Arbitrum Sepolia
    // CREATE2_FACTORY (forge-std CommonBase): the Arachnid deterministic-deployment proxy, present on Arbitrum One,
    // Arbitrum Sepolia and anvil.
    uint160 internal constant GRADUATOR_HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG;

    struct Book {
        address usdc;
        address poolManager;
        address positionManager;
        address permit2;
        address v4Quoter;
        address erc6551Registry;
        address accountProxy;
        address accountImpl;
    }

    struct Config {
        bool mainnet;
        address deployer;
        address admin;
        address usdc;
        address treasury;
        address relayer;
        address komaIssues;
        address math;
        address router;
        address poolManager;
        address positionManager;
        address permit2;
        address v4Quoter;
        address erc6551Registry;
        address accountProxy;
        address accountImpl;
        string baseURI;
        string issuesBaseURI;
        uint256 minGraduationTarget;
        uint64 minVotingWindow;
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
        /// router.factory() == seriesFactory and router.owner() == admin after this run
        bool routerWired;
        uint256 deployBlock;
    }

    error HalfStylusConfig();
    error NoSigner();
    error MainnetRequires(string what);
    error MainnetOverride(string name, address book, address given);
    error MissingAddress(string name);
    error NoCode(string name, address at);
    error NotStylusProgram(string name, address at);
    error RelayerIsAdmin();
    error LocalhostURI(string uri);
    error RouterMisconfigured(string what);
    error RouterOwnedByStranger(address owner);
    error GraduatorDeployFailed();
    error PostCheck(string what);

    function run() public virtual returns (Deployment memory d) {
        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0));
        // Mainnet signs with a keystore / hardware wallet (`--account`, `--ledger`), never a raw env key.
        if (pk != 0 && block.chainid == ARBITRUM_ONE) revert MainnetRequires("--account keystore signer, not DEPLOYER_KEY");
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);
        if (deployer == DEFAULT_SENDER) revert NoSigner(); // forgot --account/--sender: never deploy as forge's default
        Config memory cfg = _config(deployer);
        _preflight(cfg);

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        d = _deploy(cfg);
        vm.stopBroadcast();

        _postCheck(cfg, d);
        d.deployBlock = _chainBlockNumber();
        _log(cfg, d);
        _write(cfg, d);
    }

    // ------------------------------------------------------------------ configuration

    /// @notice Canonical addresses per chain. Arbitrum One values are checked to have code in `_preflight`.
    function book(uint256 chainId) public pure returns (Book memory b) {
        if (chainId == ARBITRUM_ONE) {
            b.usdc = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
            b.poolManager = 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32;
            b.positionManager = 0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869;
            b.permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
            b.v4Quoter = 0x3972C00f7ed4885e145823eb7C655375d275A1C5;
        } else if (chainId == ARBITRUM_SEPOLIA || chainId == KOMA_HOSTED_LOCALNET) {
            b.usdc = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
            b.poolManager = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
            b.positionManager = 0xAc631556d3d4019C95769033B5E719dD77124BAc;
            b.permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
            b.v4Quoter = 0x7dE51022d70A725b508085468052E25e22b5c4c9;
        } else {
            return b; // unknown chain: everything must come from env
        }
        // Tokenbound v0.3 (same addresses and code on both chains)
        b.erc6551Registry = 0x000000006551c19487814612e58FE06813775758;
        b.accountProxy = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
        b.accountImpl = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    }

    function _config(address deployer) internal view virtual returns (Config memory c) {
        c.mainnet = block.chainid == ARBITRUM_ONE;
        c.deployer = deployer;
        Book memory b = book(block.chainid);
        c.usdc = _addr("USDC", b.usdc, c.mainnet);
        c.poolManager = _addr("POOL_MANAGER", b.poolManager, c.mainnet);
        c.positionManager = _addr("POSITION_MANAGER", b.positionManager, c.mainnet);
        c.permit2 = _addr("PERMIT2", b.permit2, c.mainnet);
        c.v4Quoter = _addr("V4_QUOTER", b.v4Quoter, c.mainnet);
        c.erc6551Registry = _addr("ERC6551_REGISTRY", b.erc6551Registry, c.mainnet);
        c.accountProxy = _addr("ACCOUNT_PROXY", b.accountProxy, c.mainnet);
        c.accountImpl = _addr("ACCOUNT_IMPL", b.accountImpl, c.mainnet);

        c.math = vm.envOr("MATH", address(0));
        c.router = vm.envOr("ROUTER", address(0));
        if ((c.math == address(0)) != (c.router == address(0))) revert HalfStylusConfig();
        c.komaIssues = vm.envOr("KOMA_ISSUES", address(0));

        if (c.mainnet) {
            // No silent defaults on mainnet: every role holder is explicit.
            c.admin = _required("ADMIN");
            c.treasury = _required("TREASURY");
            c.relayer = _required("RELAYER");
            c.baseURI = _requiredString("BASE_URI");
            c.issuesBaseURI = c.komaIssues == address(0) ? _requiredString("KOMA_BASE_URI") : "";
            c.minGraduationTarget = vm.envOr("MIN_GRADUATION_TARGET", uint256(1_000e6));
            c.minVotingWindow = uint64(vm.envOr("MIN_VOTING_WINDOW", uint256(3_600)));
        } else {
            c.admin = vm.envOr("ADMIN", deployer);
            c.treasury = vm.envOr("TREASURY", deployer);
            c.relayer = vm.envOr("RELAYER", deployer);
            c.baseURI = vm.envOr("BASE_URI", string("http://localhost:4310/api/characters/"));
            c.issuesBaseURI = vm.envOr("KOMA_BASE_URI", string("http://localhost:4310/api/tokens/"));
            c.minGraduationTarget = vm.envOr("MIN_GRADUATION_TARGET", uint256(1e6));
            c.minVotingWindow = uint64(vm.envOr("MIN_VOTING_WINDOW", uint256(60)));
        }
    }

    function _preflight(Config memory c) internal view {
        _requireCode("USDC", c.usdc);
        _requireCode("POOL_MANAGER", c.poolManager);
        _requireCode("POSITION_MANAGER", c.positionManager);
        _requireCode("PERMIT2", c.permit2);
        _requireCode("ERC6551_REGISTRY", c.erc6551Registry);
        _requireCode("ACCOUNT_PROXY", c.accountProxy);
        _requireCode("ACCOUNT_IMPL", c.accountImpl);
        _requireCode("CREATE2_FACTORY", CREATE2_FACTORY);
        if (c.math != address(0)) {
            _requireCode("MATH", c.math);
            _requireCode("ROUTER", c.router);
        }
        if (c.komaIssues != address(0)) _requireCode("KOMA_ISSUES", c.komaIssues);
        if (!c.mainnet) return;

        _requireCode("V4_QUOTER", c.v4Quoter);
        // Engine: the Stylus programs, never the Solidity reference.
        if (c.math == address(0)) revert MainnetRequires("MATH and ROUTER (Stylus programs)");
        _checkEngine(c);
        if (c.relayer == c.admin) revert RelayerIsAdmin();
        if (c.admin == c.deployer) revert MainnetRequires("ADMIN != deployer (the deployer renounces every role)");
        if (c.admin.code.length == 0 && !vm.envOr("ALLOW_EOA_ADMIN", false)) {
            revert MainnetRequires("ADMIN with code (a Safe); set ALLOW_EOA_ADMIN=true to override");
        }
        _noLocalhost(c.baseURI);
        _noLocalhost(c.issuesBaseURI);
    }

    /// @dev Mainnet engine check: MATH/ROUTER must be Stylus programs (code starts with the 0xEFF000 Stylus
    ///      prefix, which EVM bytecode can never carry under EIP-3541). Only the local measurement script
    ///      (script/MeasureMainnetDeploy.s.sol, anvil-only) overrides this to use Solidity stand-ins.
    function _checkEngine(Config memory c) internal view virtual {
        if (!_isStylus(c.math)) revert NotStylusProgram("MATH", c.math);
        if (!_isStylus(c.router)) revert NotStylusProgram("ROUTER", c.router);
    }

    // ------------------------------------------------------------------ deployment

    function _deploy(Config memory c) internal returns (Deployment memory d) {
        d.stylus = c.math != address(0);
        if (d.stylus) {
            // Foundry's EVM can't execute Stylus (WASM) programs, so this script never calls them: the
            // router is initialized by scripts/stylus-deploy.sh and wired with the printed `cast` commands.
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
            : address(new KomaIssues(c.admin, c.relayer, c.issuesBaseURI));

        d.characterNft =
            address(new CharacterNFT(c.deployer, c.erc6551Registry, c.accountProxy, c.accountImpl, c.baseURI));
        d.canonRegistry = address(new CanonRegistry(c.deployer));
        d.graduator = address(_deployGraduator(c));
        d.seriesFactory = address(_newFactory(c, d));
        d.swapper = address(new KomaSwapper(c.poolManager, d.graduator, c.usdc));

        // Operational roles: the factory mints/registers, the relayer launches and runs canon.
        CharacterNFT nft = CharacterNFT(d.characterNft);
        CanonRegistry canon = CanonRegistry(d.canonRegistry);
        Graduator graduator = Graduator(d.graduator);
        SeriesFactory factory = SeriesFactory(d.seriesFactory);
        nft.grantRole(nft.MINTER_ROLE(), address(factory));
        canon.grantRole(canon.FACTORY_ROLE(), address(factory));
        canon.grantRole(canon.RELAYER_ROLE(), c.relayer);
        graduator.grantRole(graduator.FACTORY_ROLE(), address(factory));
        factory.grantRole(factory.LAUNCHER_ROLE(), c.relayer);

        // Stylus router: wired afterwards with `cast` (see the checklist printed below).
        d.routerWired = d.stylus ? false : _wireRouter(c, d.royaltyRouter, d.seriesFactory);

        // Hand every admin role to ADMIN and drop the deployer's.
        if (c.admin != c.deployer) {
            _handOver(IAccessControl(address(nft)), c);
            _handOver(IAccessControl(address(canon)), c);
            _handOver(IAccessControl(address(graduator)), c);
            _handOver(IAccessControl(address(factory)), c);
        }
    }

    function _newFactory(Config memory c, Deployment memory d) internal returns (SeriesFactory) {
        return new SeriesFactory(
            c.deployer,
            c.usdc,
            d.curveMath,
            d.royaltyRouter,
            d.characterNft,
            d.canonRegistry,
            d.graduator,
            c.treasury,
            address(new CurveDeployer()),
            address(new CoinDeployer()),
            c.minGraduationTarget,
            c.minVotingWindow
        );
    }

    /// @dev Front-run safe ordering: only the owner can point the router at a factory, and the owner hands the
    ///      router to ADMIN last. Returns false when ADMIN already owns it (ADMIN must send setFactory itself).
    function _wireRouter(Config memory c, address routerAddr, address factory) internal returns (bool) {
        IRoyaltyRouter r = IRoyaltyRouter(routerAddr);
        address owner = r.owner();
        if (owner == c.deployer) {
            if (r.factory() != factory) r.setFactory(factory);
            if (c.admin != c.deployer) r.transferOwnership(c.admin);
            return true;
        }
        if (owner == c.admin) return r.factory() == factory;
        revert RouterOwnedByStranger(owner);
    }

    function _handOver(IAccessControl ac, Config memory c) internal {
        bytes32 adminRole = 0x00; // DEFAULT_ADMIN_ROLE
        ac.grantRole(adminRole, c.admin);
        ac.renounceRole(adminRole, c.deployer);
    }

    /// @dev The Graduator is the v4 hook of every series pool (initialize gating, AUDIT.md H-1), so its address
    ///      must carry exactly the BEFORE_INITIALIZE flag: CREATE2 through the deterministic deployer with a
    ///      mined salt. The init code binds the admin (deployer) and the chain's addresses, so a front-runner
    ///      replaying the salt deploys the identical contract.
    function _deployGraduator(Config memory c) internal returns (Graduator g) {
        bytes memory initCode = abi.encodePacked(
            type(Graduator).creationCode,
            abi.encode(c.deployer, c.poolManager, c.positionManager, c.permit2, c.usdc, c.treasury)
        );
        (bytes32 salt, address predicted) = mineGraduatorSalt(keccak256(initCode));
        (bool ok, bytes memory ret) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        if (!ok || ret.length != 20 || address(bytes20(ret)) != predicted) revert GraduatorDeployFailed();
        g = Graduator(predicted);
    }

    function mineGraduatorSalt(bytes32 initCodeHash) public view returns (bytes32 salt, address predicted) {
        uint160 mask = Hooks.ALL_HOOK_MASK;
        for (uint256 i;; i++) {
            salt = bytes32(i);
            predicted = vm.computeCreate2Address(salt, initCodeHash, CREATE2_FACTORY);
            if (uint160(predicted) & mask == GRADUATOR_HOOK_FLAGS && predicted.code.length == 0) return (salt, predicted);
        }
    }

    // ------------------------------------------------------------------ post-deploy checks

    function _postCheck(Config memory c, Deployment memory d) internal view {
        bytes32 adminRole = 0x00;
        address[4] memory acs = [d.characterNft, d.canonRegistry, d.graduator, d.seriesFactory];
        for (uint256 i; i < acs.length; i++) {
            IAccessControl ac = IAccessControl(acs[i]);
            if (!ac.hasRole(adminRole, c.admin)) revert PostCheck("admin missing DEFAULT_ADMIN_ROLE");
            if (c.admin != c.deployer && ac.hasRole(adminRole, c.deployer)) revert PostCheck("deployer kept admin");
            if (c.relayer != c.admin && ac.hasRole(adminRole, c.relayer)) revert PostCheck("relayer is admin");
        }
        if (c.komaIssues == address(0)) {
            KomaIssues issues = KomaIssues(d.komaIssues);
            if (!issues.hasRole(adminRole, c.admin)) revert PostCheck("issues admin");
            if (c.relayer != c.admin && issues.hasRole(adminRole, c.relayer)) revert PostCheck("issues: relayer is admin");
            if (!issues.hasRole(issues.MINTER_ROLE(), c.relayer)) revert PostCheck("issues minter");
        }
        SeriesFactory f = SeriesFactory(d.seriesFactory);
        if (!f.hasRole(f.LAUNCHER_ROLE(), c.relayer)) revert PostCheck("launcher");
        CanonRegistry canon = CanonRegistry(d.canonRegistry);
        if (!canon.hasRole(canon.RELAYER_ROLE(), c.relayer)) revert PostCheck("canon relayer");
        if (!canon.hasRole(canon.FACTORY_ROLE(), d.seriesFactory)) revert PostCheck("canon factory");
        Graduator g = Graduator(d.graduator);
        if (!g.hasRole(g.FACTORY_ROLE(), d.seriesFactory)) revert PostCheck("graduator factory");
        if (g.treasury() != c.treasury || address(g.poolManager()) != c.poolManager) revert PostCheck("graduator config");
        if (uint160(d.graduator) & Hooks.ALL_HOOK_MASK != GRADUATOR_HOOK_FLAGS) revert PostCheck("graduator hook flags");
        CharacterNFT nft = CharacterNFT(d.characterNft);
        if (!nft.hasRole(nft.MINTER_ROLE(), d.seriesFactory)) revert PostCheck("nft minter");
        if (!d.stylus) {
            IRoyaltyRouter r = IRoyaltyRouter(d.royaltyRouter);
            if (r.usdc() != c.usdc || r.treasury() != c.treasury) revert PostCheck("router config");
            if (d.routerWired && (r.factory() != d.seriesFactory || r.owner() != c.admin)) revert PostCheck("router wiring");
        }
    }

    // ------------------------------------------------------------------ helpers

    function _addr(string memory name, address bookValue, bool mainnet) internal view returns (address v) {
        v = vm.envOr(name, bookValue);
        if (mainnet && v != bookValue) revert MainnetOverride(name, bookValue, v);
        if (v == address(0)) revert MissingAddress(name);
    }

    function _required(string memory name) internal view returns (address v) {
        v = vm.envOr(name, address(0));
        if (v == address(0)) revert MainnetRequires(name);
    }

    function _requiredString(string memory name) internal view returns (string memory v) {
        v = vm.envOr(name, string(""));
        if (bytes(v).length == 0) revert MainnetRequires(name);
    }

    function _requireCode(string memory name, address a) internal view {
        if (a.code.length == 0) revert NoCode(name, a);
    }

    function _isStylus(address a) internal view returns (bool) {
        bytes memory code = a.code;
        return code.length > 3 && code[0] == 0xEF && code[1] == 0xF0 && code[2] == 0x00;
    }

    function _noLocalhost(string memory uri) internal pure {
        bytes memory u = bytes(uri);
        if (_contains(u, "localhost") || _contains(u, "127.0.0.1") || _contains(u, ".test/")) revert LocalhostURI(uri);
    }

    function _contains(bytes memory h, bytes memory n) internal pure returns (bool) {
        if (n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length && hit; j++) {
                hit = h[i + j] == n[j];
            }
            if (hit) return true;
        }
        return false;
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
        console.log("chain           ", block.chainid);
        console.log("engine          ", d.stylus ? "stylus" : "solidity-reference");
        console.log("SeriesFactory   ", d.seriesFactory);
        console.log("CharacterNFT    ", d.characterNft);
        console.log("CanonRegistry   ", d.canonRegistry);
        console.log("Graduator (hook)", d.graduator);
        console.log("KomaSwapper     ", d.swapper);
        console.log("CurveMath       ", d.curveMath);
        console.log("RoyaltyRouter   ", d.royaltyRouter);
        console.log("KomaIssues      ", d.komaIssues);
        console.log("admin           ", c.admin);
        console.log("treasury        ", c.treasury);
        console.log("relayer         ", c.relayer);
        if (c.relayer == c.deployer) console.log("WARNING: the relayer is the deployer key");

        console.log("");
        console.log("POST-DEPLOY CHECKLIST (deploy/MAINNET.md has the full runbook)");
        if (d.stylus) {
            console.log("[ ] Stylus router - send now, as the deployer, in this order (launches revert until done):");
            console.log(string.concat("    cast send ", vm.toString(d.royaltyRouter), " 'setFactory(address)' ", vm.toString(d.seriesFactory)));
            if (c.admin != c.deployer) {
                console.log(string.concat("    cast send ", vm.toString(d.royaltyRouter), " 'transferOwnership(address)' ", vm.toString(c.admin)));
            }
            console.log("    then check: cast call <router> 'factory()(address)' / 'owner()(address)' / 'usdc()(address)' / 'treasury()(address)'");
        } else if (!d.routerWired) {
            console.log("[ ] ADMIN (Safe) must send on the router - launches revert until it does:");
            console.log(string.concat("    ", vm.toString(d.royaltyRouter), " setFactory(address) ", vm.toString(d.seriesFactory)));
        } else {
            console.log("[x] router: factory set, ownership transferred to ADMIN");
        }
        console.log("[ ] verify sources on Arbiscan (forge verify-contract / cargo stylus verify)");
        console.log("[ ] check roles with cast call hasRole (deployer must hold none)");
        if (d.stylus) console.log("[ ] Stylus: CacheManager bids placed; programTimeLeft monitored (365-day expiry)");
        console.log("[ ] smoke test with the smallest amounts (MAINNET.md section 6)");
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
        vm.serializeAddress(k, "v4Quoter", c.v4Quoter);
        vm.serializeAddress(k, "erc6551Registry", c.erc6551Registry);
        vm.serializeAddress(k, "accountProxy", c.accountProxy);
        vm.serializeAddress(k, "accountImpl", c.accountImpl);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "relayer", c.relayer);
        vm.serializeAddress(k, "admin", c.admin);
        vm.serializeBool(k, "routerWired", d.routerWired);
        vm.serializeUint(k, "minGraduationTarget", c.minGraduationTarget);
        vm.serializeUint(k, "minVotingWindow", c.minVotingWindow);
        string memory json = vm.serializeUint(k, "deployBlock", d.deployBlock);
        vm.writeJson(json, out);
        console.log("addresses written to", out);
    }
}
