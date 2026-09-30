// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal cross-contract views, kept separate to avoid import cycles.
interface IBondingCurveView {
    function graduator() external view returns (address);
    function graduated() external view returns (bool);
}

interface IGraduatorView {
    function poolManager() external view returns (address);
}

/// @notice Circle FiatToken v2.2 EIP-3009 entry point used by the curve and the swapper.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice ERC-6551 registry (canonical at 0x000000006551c19487814612e58FE06813775758).
interface IERC6551Registry {
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        returns (address account);
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
}

/// @notice Tokenbound AccountProxy: points the fresh account at a trusted implementation.
interface ITokenboundAccountProxy {
    function initialize(address implementation) external;
}
