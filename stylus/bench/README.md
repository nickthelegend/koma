# Gas benchmark: Stylus vs Solidity

Measured on a local nitro devnode (`offchainlabs/nitro-node:v3.7.1-926f1ab --dev`, L1 price set to 0) with
`./bench/run.sh`. Raw numbers: [`results.json`](results.json). They are `eth_estimateGas` results, or receipt
`gasUsed` where the table says so. Each figure is total transaction gas, including the 21,000 intrinsic and the
calldata. Nothing here is estimated by hand.

- **Solidity**: `contracts/src/CurveMathReference.sol` and `RoyaltyRouterReference.sol`, built with solc 0.8.28,
  optimizer runs 500, `evm_version` cancun (the launchpad's foundry settings).
- **Stylus**: `curve-math` / `royalty-router` from this workspace (stylus-sdk 0.10.9, opt-level 3, 64 KiB stack).
- **"cached"**: after `ArbWasmCache.cacheProgram`, checked with `codehashIsCached == true`. The devnode's
  CacheManager is a stub, so `cargo stylus cache bid` does nothing there. On Arbitrum One and Sepolia you get the
  same effect by winning a CacheManager bid. Each run starts on a fresh node, and the script asserts that the
  code hash was not cached before the uncached pass.

## Curve math: `CurveBench.run(math, n)`

`CurveBench.run` makes n × (`quoteBuy` + `quoteSell`) external calls from one Solidity caller. It walks the
reserves like a real curve. Both implementations return the same accumulator for every n; the script asserts this.

| n (quoteBuy+quoteSell pairs) | Solidity reference | Stylus, not cached | Stylus, cached | cached / Solidity |
|---:|---:|---:|---:|---:|
| 0 | 24,469 | 24,457 | 24,457 | 1.00x |
| 1 | 50,172 | 79,072 | 52,267 | 1.04x |
| 10 | 79,795 | 366,976 | 100,847 | 1.26x |
| 100 | 374,236 | 3,237,195 | 585,717 | 1.57x |

| direct tx | Solidity | Stylus, not cached | Stylus, cached |
|---|---:|---:|---:|
| `quoteBuy(1e9,1e27,1e6)` | 22,940 | 39,327 | 25,992 |
| `quoteSell(1e9+1e6,~1e27,1e21)` | 22,970 | 39,428 | 26,093 |

| `route(4, 1e6)`, 3 ancestors, 5 transfers | Solidity (`RoyaltyRouterReference`) | Stylus |
|---|---:|---:|
| 1st route, cold recipients (gasUsed), Stylus not cached | 303,890 | 318,057 |
| 2nd route, warm recipients (gasUsed), Stylus not cached | 132,890 | 147,057 |
| 3rd route, warm recipients (gasUsed), Stylus cached | 132,890 | 131,802 |

## Reading it

- The math is a handful of U256 mul/div operations per call, so the fixed cost of entering a WASM program dominates.
  Solidity stays cheaper here. Cached Stylus costs about 5.4k gas per buy+sell pair, against about 3.3k for Solidity
  (n = 10 → 100). An uncached program pays its init cost on every call, which comes to about 32k per pair. **Cache
  `curve-math` on any real network.**
- `route` does five ERC-20 transfers, and storage and calls dominate. Once cached, the Stylus router is slightly
  cheaper than the Solidity one (131,802 vs 132,890 gasUsed).
- Setting the stack size mattered more than any code change. rustc's default 1 MiB stack makes every call open 17
  WASM pages. Setting `-zstack-size=65536` in `stylus/.cargo/config.toml` cut a cached `quoteBuy` transaction from
  41,285 to 25,992 gas. Both figures were measured on the same devnode.
