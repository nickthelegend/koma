// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @notice Tokenbound AccountV3 surface used by the tests.
interface IAccountV3 {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function owner() external view returns (address);
    function state() external view returns (uint256);
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4);
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
    function lock(uint256 lockedUntil) external;
    function isLocked() external view returns (bool);
}

interface IERC6551RegistryFull {
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        returns (address);
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
}

interface ITokenboundProxy {
    function initialize(address implementation) external;
}

interface IAccountGuardian {
    function owner() external view returns (address);
    function isTrustedImplementation(address implementation) external view returns (bool);
}

/// @title Real Tokenbound ERC-6551 stack for unit tests
/// @notice Etches the runtime code deployed on Arbitrum One (fetched with `cast code` from
///         https://arb1.arbitrum.io/rpc at block 510,584,332 into `test/utils/bytecode/`; the same code is deployed
///         at the same addresses on Arbitrum Sepolia) at the canonical addresses:
///         - ERC-6551 registry   0x000000006551c19487814612e58FE06813775758
///         - AccountProxy        0x55266d75D1a14E4572138116aF39863Ed6596E7F (immutables: guardian, initial impl)
///         - AccountV3 impl      0x41C8f39463A868d3A88af00cd0fe7102F30E44eC (immutables: EntryPoint, forwarder,
///                               registry, guardian)
///         - AccountGuardian     0x2FE5ccb0d7Ea195FEb87987d3573F9fcCE2b5D57 (owner in slot 0; like on Arbitrum
///                               One and Sepolia it trusts no implementation, so `AccountProxy.initialize` reverts
///                               and accounts run the proxy's immutable initial implementation, AccountV3)
///         - ERC-4337 EntryPoint v0.6 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 and Tokenbound's
///           MulticallForwarder 0xcA1167915584462449EE5b4Ea51c37fE81eCDCCD, which AccountV3 trusts as callers.
library Tokenbound {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address internal constant ACCOUNT_IMPL = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    address internal constant GUARDIAN = 0x2FE5ccb0d7Ea195FEb87987d3573F9fcCE2b5D57;
    address internal constant GUARDIAN_OWNER = 0x781b6A527482828bB04F33563797d4b696ddF328;
    address internal constant ENTRY_POINT = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;
    address internal constant MULTICALL_FORWARDER = 0xcA1167915584462449EE5b4Ea51c37fE81eCDCCD;

    function etch() internal {
        if (REGISTRY.code.length != 0) return;
        _etch(REGISTRY, "ERC6551Registry");
        _etch(ACCOUNT_PROXY, "AccountProxy");
        _etch(ACCOUNT_IMPL, "AccountV3");
        _etch(GUARDIAN, "AccountGuardian");
        vm.store(GUARDIAN, bytes32(0), bytes32(uint256(uint160(GUARDIAN_OWNER))));
        _etch(ENTRY_POINT, "EntryPointV06");
        _etch(MULTICALL_FORWARDER, "MulticallForwarder");
    }

    function _etch(address where, string memory name) private {
        vm.etch(where, vm.parseBytes(vm.readFile(string.concat(vm.projectRoot(), "/test/utils/bytecode/", name, ".hex"))));
        vm.label(where, name);
    }
}
