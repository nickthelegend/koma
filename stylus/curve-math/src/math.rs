//! Pure curve math shared by the contract entrypoints, the unit tests and the
//! test-vector generator. No host access, no allocation.
//!
//! Spec (`contracts/LAUNCHPAD_SPEC.md`, "Curve math"):
//! - `k = vU * vC`
//! - buy  `u` USDC  -> `coinOut = vC - ceil(k / (vU + u))`   (rounds against the buyer)
//! - sell `c` coins -> `usdcOut = vU - ceil(k / (vC + c))`   (rounds against the seller)
//! - `usdcToReach = targetVU - vU` (reverts if `targetVU < vU`)
//! - `spotPrice = vU * 1e18 / vC` (floor)
//!
//! Every function reverts on `vU == 0` or `vC == 0` and on any U256 overflow.

use alloy_primitives::U256;

/// 1e18 scaling factor for `spot_price`.
pub const WAD: U256 = U256::from_limbs([1_000_000_000_000_000_000u64, 0, 0, 0]);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// `vU == 0` or `vC == 0`.
    ZeroReserve,
    /// An intermediate value does not fit in 256 bits.
    Overflow,
    /// `usdcToReach` called with `targetVU < vU` (carries `vU`, `targetVU`).
    TargetBelowReserve(U256, U256),
}

#[inline]
fn check_reserves(v_u: U256, v_c: U256) -> Result<(), MathError> {
    if v_u.is_zero() || v_c.is_zero() {
        Err(MathError::ZeroReserve)
    } else {
        Ok(())
    }
}

/// `ceil(a / b)` for `b > 0`. Never overflows: if the remainder is non-zero
/// then `b >= 2` and the quotient is at most `MAX / 2`.
#[inline]
pub fn ceil_div(a: U256, b: U256) -> U256 {
    let (q, r) = a.div_rem(b);
    if r.is_zero() { q } else { q + U256::from(1u8) }
}

/// `x - ceil(x * y / (x + dx))` where `(x, y)` are the reserves and `dx` the
/// amount added to reserve `x`. Returns the amount taken out of reserve `y`.
#[inline]
fn out_given_in(x: U256, y: U256, dx: U256) -> Result<U256, MathError> {
    check_reserves(x, y)?;
    let k = x.checked_mul(y).ok_or(MathError::Overflow)?;
    let denom = x.checked_add(dx).ok_or(MathError::Overflow)?;
    // denom >= x > 0 so ceil(k / denom) <= ceil(k / x) = y: the subtraction
    // cannot underflow. checked_sub keeps the invariant explicit anyway.
    y.checked_sub(ceil_div(k, denom)).ok_or(MathError::Overflow)
}

/// Coins out for `usdc_in` USDC in (fee-free).
pub fn quote_buy(v_u: U256, v_c: U256, usdc_in: U256) -> Result<U256, MathError> {
    out_given_in(v_u, v_c, usdc_in)
}

/// Gross USDC out for `coin_in` coins in (fee-free).
pub fn quote_sell(v_u: U256, v_c: U256, coin_in: U256) -> Result<U256, MathError> {
    // Same shape with the reserves swapped: vU - ceil(vU*vC / (vC + c)).
    out_given_in(v_c, v_u, coin_in)
}

/// USDC needed to move the virtual USDC reserve from `v_u` to `target_v_u`.
pub fn usdc_to_reach(v_u: U256, v_c: U256, target_v_u: U256) -> Result<U256, MathError> {
    check_reserves(v_u, v_c)?;
    target_v_u.checked_sub(v_u).ok_or(MathError::TargetBelowReserve(v_u, target_v_u))
}

/// `vU * 1e18 / vC`, floored.
pub fn spot_price(v_u: U256, v_c: U256) -> Result<U256, MathError> {
    check_reserves(v_u, v_c)?;
    Ok(v_u.checked_mul(WAD).ok_or(MathError::Overflow)? / v_c)
}
