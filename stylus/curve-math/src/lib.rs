//! KOMA launchpad `ICurveMath` on Arbitrum Stylus.
//!
//! ```solidity
//! interface ICurveMath {
//!     function quoteBuy(uint256 vU, uint256 vC, uint256 usdcIn) external pure returns (uint256 coinOut);
//!     function quoteSell(uint256 vU, uint256 vC, uint256 coinIn) external pure returns (uint256 usdcOut);
//!     function usdcToReach(uint256 vU, uint256 vC, uint256 targetVU) external pure returns (uint256 usdcIn);
//!     function spotPrice(uint256 vU, uint256 vC) external pure returns (uint256 priceX18);
//! }
//! ```
//!
//! Stateless: every method is `pure`. The math lives in [`math`] so it can be
//! unit-tested and used to generate the differential test vectors.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![allow(non_snake_case)]
extern crate alloc;

pub mod math;

use alloc::vec::Vec;
use alloy_sol_types::{SolError, sol};
use stylus_sdk::{alloy_primitives::U256, prelude::*};

use math::MathError;

sol! {
    /// `vU == 0` or `vC == 0`.
    error ZeroReserve();
    /// `usdcToReach` with `targetVU < vU`.
    error TargetBelowReserve(uint256 vU, uint256 targetVU);
}

/// `Panic(uint256)` selector; code 0x11 is Solidity 0.8's arithmetic overflow.
pub const PANIC_SELECTOR: [u8; 4] = [0x4e, 0x48, 0x7b, 0x71];
pub const PANIC_OVERFLOW: u8 = 0x11;

/// ABI-encoded revert data for a [`MathError`], byte-identical to what the
/// Solidity reference (`contracts/src/CurveMathReference.sol`) reverts with:
/// `ZeroReserve()`, `TargetBelowReserve(vU, targetVU)` and, for overflow,
/// the compiler's `Panic(0x11)`. Errors are returned as raw bytes (not a
/// `SolidityError` enum) so they stay out of the exported ABI, which must
/// match the spec's `ICurveMath` exactly.
pub fn revert(e: MathError) -> Vec<u8> {
    match e {
        MathError::ZeroReserve => ZeroReserve::SELECTOR.to_vec(),
        MathError::Overflow => {
            let mut v = Vec::with_capacity(36);
            v.extend_from_slice(&PANIC_SELECTOR);
            v.extend_from_slice(&[0u8; 31]);
            v.push(PANIC_OVERFLOW);
            v
        }
        MathError::TargetBelowReserve(vU, targetVU) => TargetBelowReserve { vU, targetVU }.abi_encode(),
    }
}

#[storage]
#[entrypoint]
pub struct CurveMath {}

#[public]
impl CurveMath {
    /// `vC - ceil(vU*vC / (vU + usdcIn))`
    pub fn quote_buy(vU: U256, vC: U256, usdcIn: U256) -> Result<U256, Vec<u8>> {
        math::quote_buy(vU, vC, usdcIn).map_err(revert)
    }

    /// `vU - ceil(vU*vC / (vC + coinIn))`
    pub fn quote_sell(vU: U256, vC: U256, coinIn: U256) -> Result<U256, Vec<u8>> {
        math::quote_sell(vU, vC, coinIn).map_err(revert)
    }

    /// `targetVU - vU`
    pub fn usdc_to_reach(vU: U256, vC: U256, targetVU: U256) -> Result<U256, Vec<u8>> {
        math::usdc_to_reach(vU, vC, targetVU).map_err(revert)
    }

    /// `vU * 1e18 / vC`
    pub fn spot_price(vU: U256, vC: U256) -> Result<U256, Vec<u8>> {
        math::spot_price(vU, vC).map_err(revert)
    }
}

#[cfg(test)]
mod tests;
