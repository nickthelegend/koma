// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICurveMathBench {
    function quoteBuy(uint256 vU, uint256 vC, uint256 usdcIn) external pure returns (uint256);
    function quoteSell(uint256 vU, uint256 vC, uint256 coinIn) external pure returns (uint256);
}

/// Calls quoteBuy + quoteSell `n` times against `math` (Stylus curve-math or
/// the Solidity CurveMathReference), walking the reserves like a real curve
/// so every iteration sees different inputs. Same caller, same call pattern
/// for both implementations: the only variable is the math contract.
contract CurveBench {
    uint256 public sink;

    function run(address math, uint256 n) external returns (uint256 acc) {
        uint256 vU = 1_000e6;
        uint256 vC = 1e27;
        for (uint256 i; i < n; ++i) {
            uint256 u = 1e6 + i * 1e5;
            uint256 c = ICurveMathBench(math).quoteBuy(vU, vC, u);
            vU += u;
            vC -= c;
            acc += ICurveMathBench(math).quoteSell(vU, vC, c / 2);
        }
        sink = acc;
    }
}
