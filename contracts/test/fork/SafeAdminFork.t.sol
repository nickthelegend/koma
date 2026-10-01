// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkBase} from "./ForkBase.sol";
import {DeployLaunchpad} from "../../script/DeployLaunchpad.s.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {CharacterNFT} from "../../src/CharacterNFT.sol";
import {Graduator} from "../../src/Graduator.sol";
import {IRoyaltyRouter} from "../../src/interfaces/IRoyaltyRouter.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address paymentReceiver
    ) external;
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
}

contract SafeDeploy is DeployLaunchpad {
    address immutable safe;

    constructor(address safe_) {
        safe = safe_;
    }

    function _config(address deployer) internal view override returns (Config memory c) {
        c = super._config(deployer);
        c.admin = safe;
        c.treasury = safe;
    }
}

/// AUDIT.md section 2: a Safe multisig (v1.4.1, the canonical deployment on Arbitrum One and Sepolia) as both
/// TREASURY and ADMIN. Fees and the graduation fee arrive as plain USDC transfers, the deploy hands every admin
/// role and the router to the Safe, and the Safe can exercise them with a 2-of-2 transaction.
///   FORK_TESTS=1 forge test --match-path "test/fork/*" -vv
contract SafeAdminForkTest is ForkBase {
    address constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant SAFE_L2_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address constant SAFE_FALLBACK = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    ISafe safe;
    address ownerA;
    uint256 pkA;
    address ownerB;
    uint256 pkB;
    address deployer;
    address relayer = makeAddr("koma-fork-relayer");
    DeployLaunchpad.Deployment d;

    function setUp() public {
        _fork();
        (ownerA, pkA) = _wallet("safe-owner-a");
        (ownerB, pkB) = _wallet("safe-owner-b");
        if (ownerA > ownerB) (ownerA, pkA, ownerB, pkB) = (ownerB, pkB, ownerA, pkA);
        address[] memory owners = new address[](2);
        (owners[0], owners[1]) = (ownerA, ownerB);
        bytes memory init =
            abi.encodeCall(ISafe.setup, (owners, 2, address(0), "", SAFE_FALLBACK, address(0), 0, address(0)));
        safe = ISafe(ISafeProxyFactory(SAFE_FACTORY).createProxyWithNonce(SAFE_L2_SINGLETON, init, 4242));

        uint256 deployerPk;
        (deployer, deployerPk) = _wallet("deployer");
        vm.deal(deployer, 1 ether);
        vm.setEnv("DEPLOYER_KEY", vm.toString(bytes32(deployerPk)));
        // Fork suites run in parallel and share the process env, so the Safe is injected through a script
        // subclass rather than ADMIN/TREASURY env vars; the remaining env values match the other fork suites.
        vm.setEnv("TREASURY", vm.toString(makeAddr("koma-fork-treasury")));
        vm.setEnv("RELAYER", vm.toString(relayer));
        vm.setEnv("MATH", vm.toString(address(0)));
        vm.setEnv("ROUTER", vm.toString(address(0)));
        vm.setEnv("KOMA_ISSUES", vm.toString(address(0)));
        vm.setEnv("ADDRESSES_OUT", "none");
        d = new SafeDeploy(address(safe)).run();
    }

    function test_Fork_SafeIsTreasuryAndAdmin() public {
        // roles: the Safe holds every admin role and the router; the deployer holds nothing
        address[4] memory acs = [d.characterNft, d.canonRegistry, d.graduator, d.seriesFactory];
        for (uint256 i; i < acs.length; i++) {
            assertTrue(IAccessControl(acs[i]).hasRole(0x00, address(safe)), "safe admin");
            assertFalse(IAccessControl(acs[i]).hasRole(0x00, deployer), "deployer renounced");
            assertFalse(IAccessControl(acs[i]).hasRole(0x00, relayer), "relayer not admin");
        }
        assertTrue(IAccessControl(d.komaIssues).hasRole(0x00, address(safe)));
        IRoyaltyRouter router = IRoyaltyRouter(d.royaltyRouter);
        assertEq(router.owner(), address(safe));
        assertEq(router.factory(), d.seriesFactory);
        assertEq(router.treasury(), address(safe));
        assertEq(Graduator(d.graduator).treasury(), address(safe));

        // the Safe receives trading fees and the graduation fee as plain USDC transfers
        vm.prank(relayer);
        uint256 id = SeriesFactory(d.seriesFactory).launch(
            SeriesFactory.LaunchParams({
                creator: makeAddr("koma-fork-creator"),
                name: "Moon Ronin",
                symbol: "RONIN",
                characterName: "Aki",
                sheetHash: keccak256("sheet"),
                parentSeriesId: 0,
                graduationTarget: 25e6,
                votingWindow: 0
            })
        );
        BondingCurve curve = BondingCurve(SeriesFactory(d.seriesFactory).series(id).curve);
        vm.warp(block.timestamp + 601);
        uint256 fees;
        for (uint256 i; !curve.complete(); i++) {
            address b = makeAddr(string.concat("koma-fork-safe-b", vm.toString(i)));
            _dealUsdc(b, 10e6);
            vm.startPrank(b);
            usdc.approve(address(curve), 10e6);
            curve.buy(10e6, 0, b);
            vm.stopPrank();
        }
        fees = usdc.balanceOf(address(safe));
        assertGt(fees, 0, "trading-fee share reached the Safe");
        curve.graduate();
        assertGe(usdc.balanceOf(address(safe)) - fees, 1.25e6, "5% graduation fee reached the Safe");
        assertEq(Graduator(d.graduator).treasuryOwed(), 0);

        // the Safe exercises its admin role (2-of-2): CharacterNFT.setBaseURI
        _safeExec(d.characterNft, abi.encodeCall(CharacterNFT.setBaseURI, ("ipfs://koma/")));
        assertEq(CharacterNFT(d.characterNft).tokenURI(1), "ipfs://koma/1");
        // ...and the router ownership: rotate the factory pointer back and forth
        _safeExec(d.royaltyRouter, abi.encodeCall(IRoyaltyRouter.setFactory, (d.seriesFactory)));
        assertEq(router.factory(), d.seriesFactory);
    }

    function _safeExec(address to, bytes memory data) internal {
        bytes32 h = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        (uint8 va, bytes32 ra, bytes32 sa) = vm.sign(pkA, h);
        (uint8 vb, bytes32 rb, bytes32 sb) = vm.sign(pkB, h);
        bytes memory sigs = abi.encodePacked(ra, sa, va, rb, sb, vb); // ascending owner order
        assertTrue(safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sigs));
    }
}
