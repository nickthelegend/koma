// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployLaunchpad} from "../script/DeployLaunchpad.s.sol";

contract GuardHarness is DeployLaunchpad {
    function preflight(Config memory c) external view {
        _preflight(c);
    }
}

/// The Arbitrum One guards of script/DeployLaunchpad.s.sol (AUDIT.md M-3), exercised offline: the chain id is
/// set to 42161 and the book addresses get placeholder code.
contract DeployGuardsTest is Test {
    GuardHarness h;
    DeployLaunchpad.Config c;
    bytes constant STYLUS_CODE = hex"eff00000"; // Stylus prefix + payload; EVM code can never start with 0xEF

    function setUp() public {
        h = new GuardHarness();
        vm.chainId(42161);
        DeployLaunchpad.Book memory b = h.book(42161);
        c.mainnet = true;
        c.deployer = makeAddr("deployer");
        c.admin = makeAddr("safe");
        c.treasury = makeAddr("treasury");
        c.relayer = makeAddr("relayer");
        c.usdc = b.usdc;
        c.poolManager = b.poolManager;
        c.positionManager = b.positionManager;
        c.permit2 = b.permit2;
        c.v4Quoter = b.v4Quoter;
        c.erc6551Registry = b.erc6551Registry;
        c.accountProxy = b.accountProxy;
        c.accountImpl = b.accountImpl;
        c.math = makeAddr("stylus-math");
        c.router = makeAddr("stylus-router");
        c.baseURI = "https://koma.example/api/characters/";
        c.issuesBaseURI = "https://koma.example/api/tokens/";
        address[9] memory withCode = [
            b.usdc, b.poolManager, b.positionManager, b.permit2, b.v4Quoter, b.erc6551Registry, b.accountProxy,
            b.accountImpl, c.admin
        ];
        for (uint256 i; i < withCode.length; i++) {
            vm.etch(withCode[i], hex"00");
        }
        vm.etch(CREATE2_FACTORY, hex"00");
        vm.etch(c.math, STYLUS_CODE);
        vm.etch(c.router, STYLUS_CODE);
    }

    function test_MainnetBook() public view {
        DeployLaunchpad.Book memory b = h.book(42161);
        assertEq(b.usdc, 0xaf88d065e77c8cC2239327C5EDb3A432268e5831);
        assertEq(b.poolManager, 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32);
        assertEq(b.positionManager, 0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869);
        assertEq(b.permit2, 0x000000000022D473030F116dDEE9F6B43aC78BA3);
        assertEq(b.v4Quoter, 0x3972C00f7ed4885e145823eb7C655375d275A1C5);
        assertEq(b.erc6551Registry, 0x000000006551c19487814612e58FE06813775758);
        DeployLaunchpad.Book memory s = h.book(421614);
        assertEq(s.v4Quoter, 0x7dE51022d70A725b508085468052E25e22b5c4c9);
        assertTrue(s.usdc != b.usdc && s.poolManager != b.poolManager, "no Sepolia address on mainnet");
        assertEq(h.book(1).usdc, address(0), "unknown chains get no defaults");
    }

    function test_ValidMainnetConfigPasses() public view {
        h.preflight(c);
    }

    function test_RevertWhen_MainnetWithoutStylus() public {
        c.math = address(0);
        c.router = address(0);
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.MainnetRequires.selector, "MATH and ROUTER (Stylus programs)"));
        h.preflight(c);
    }

    function test_RevertWhen_MainnetEngineIsSolidity() public {
        vm.etch(c.router, hex"6080604052"); // any EVM contract, e.g. RoyaltyRouterReference
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.NotStylusProgram.selector, "ROUTER", c.router));
        h.preflight(c);
    }

    function test_RevertWhen_RelayerIsAdmin() public {
        c.relayer = c.admin;
        vm.expectRevert(DeployLaunchpad.RelayerIsAdmin.selector);
        h.preflight(c);
    }

    function test_RevertWhen_AdminIsDeployer() public {
        c.admin = c.deployer;
        vm.etch(c.deployer, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployLaunchpad.MainnetRequires.selector, "ADMIN != deployer (the deployer renounces every role)"
            )
        );
        h.preflight(c);
    }

    function test_RevertWhen_AdminIsEoa() public {
        c.admin = makeAddr("eoa-admin");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployLaunchpad.MainnetRequires.selector,
                "ADMIN with code (a Safe); set ALLOW_EOA_ADMIN=true to override"
            )
        );
        h.preflight(c);
    }

    function test_RevertWhen_LocalhostUri() public {
        c.baseURI = "http://localhost:4310/api/characters/";
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.LocalhostURI.selector, c.baseURI));
        h.preflight(c);
    }

    function test_RevertWhen_BookAddressHasNoCode() public {
        vm.etch(c.poolManager, "");
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.NoCode.selector, "POOL_MANAGER", c.poolManager));
        h.preflight(c);
    }
}
