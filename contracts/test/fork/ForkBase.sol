// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

interface IFiatToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function authorizationState(address, bytes32) external view returns (bool);
    function name() external view returns (string memory);
}

/// @notice Arbitrum Sepolia fork harness. Fork tests are skipped unless FORK_TESTS=1 so `forge test` stays
///         offline-safe. RPC: FORK_RPC (default: Tenderly's archive gateway, since the public RPC prunes state);
///         optional FORK_BLOCK to pin a block.
abstract contract ForkBase is Test {
    address internal constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address internal constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    address internal constant POSITION_MANAGER = 0xAc631556d3d4019C95769033B5E719dD77124BAc;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address internal constant ACCOUNT_IMPL = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    /// FiatToken v2.2 `balanceAndBlacklistStates` mapping slot.
    uint256 internal constant USDC_BALANCES_SLOT = 9;

    IFiatToken internal usdc = IFiatToken(USDC);

    function _fork() internal {
        if (!vm.envOr("FORK_TESTS", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("FORK_RPC", vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://arbitrum-sepolia.gateway.tenderly.co")));
        uint256 blockNumber = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        assertEq(block.chainid, 421614, "not Arbitrum Sepolia");
    }

    function _dealUsdc(address who, uint256 amount) internal {
        vm.store(USDC, keccak256(abi.encode(who, USDC_BALANCES_SLOT)), bytes32(amount));
        assertEq(usdc.balanceOf(who), amount, "USDC balance slot");
    }

    /// @dev Fresh EOA with no code (default anvil keys carry EIP-7702 delegations on Arbitrum Sepolia).
    function _wallet(string memory label) internal returns (address addr, uint256 pk) {
        (addr, pk) = makeAddrAndKey(string.concat("koma-fork-", label));
        assertEq(addr.code.length, 0, "wallet has code");
    }

    function _signReceive(uint256 pk, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(pk),
                to,
                value,
                uint256(0),
                block.timestamp + 1 hours,
                nonce
            )
        );
        (v, r, s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }
}
