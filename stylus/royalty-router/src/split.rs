//! Pure fee-split arithmetic shared by `route`, the unit tests and the
//! test-vector generator.
//!
//! Spec (`contracts/LAUNCHPAD_SPEC.md`, `IRoyaltyRouter`):
//! - `char     = amount * 5000 / 10000`
//! - `treasury = amount * 3000 / 10000`
//! - `pool     = amount - char - treasury`
//! - ancestor at depth `i` (1 = parent) gets `pool >> i`, for i = 1..=depth, depth <= 8
//! - the character gets `char + (pool - sum(ancestors))`, so the total paid is exactly `amount`.

use alloy_primitives::U256;

pub const BPS: u64 = 10_000;
pub const CHARACTER_BPS: u64 = 5_000;
pub const TREASURY_BPS: u64 = 3_000;
pub const MAX_DEPTH: usize = 8;

/// Largest `amount` for which `amount * 5000` fits in 256 bits:
/// `(2^256 - 1) / 5000`. Larger amounts revert, exactly like the Solidity
/// 0.8 expression `amount * 5000 / 10000` would.
pub const MAX_AMOUNT: U256 = U256::from_limbs([
    10684354167492572295,
    5371691874264221430,
    5961987684622927082,
    3689348814741910,
]);

/// `x / d` for a small divisor (`d < 2^32`), by schoolbook long division over
/// 32-bit digits so every step is a native 64-bit `div`. Used instead of
/// ruint's generic `div_rem` (~4.5 KB of WASM) since the only divisor is 10.
#[inline]
fn div_small(x: U256, d: u32) -> U256 {
    let limbs = x.as_limbs();
    let d = d as u64;
    let mut out = [0u64; 4];
    let mut rem: u64 = 0;
    for i in (0..4).rev() {
        let hi = (rem << 32) | (limbs[i] >> 32);
        let q_hi = hi / d;
        rem = hi % d;
        let lo = (rem << 32) | (limbs[i] & 0xFFFF_FFFF);
        let q_lo = lo / d;
        rem = lo % d;
        out[i] = (q_hi << 32) | q_lo;
    }
    U256::from_limbs(out)
}

/// `(char, treasury, pool)` with `char = amount*5000/10000` and
/// `treasury = amount*3000/10000` (floor). `None` if `amount > MAX_AMOUNT`.
///
/// For every amount <= MAX_AMOUNT: `amount*5000/10000 == amount >> 1` and
/// `amount*3000/10000 == (amount*3)/10`; both identities are asserted against
/// the literal spec expression in the unit tests.
#[inline]
pub fn base_split(amount: U256) -> Option<(U256, U256, U256)> {
    if amount > MAX_AMOUNT {
        return None;
    }
    let character = amount >> 1;
    let treasury = div_small(amount * U256::from(3u8), 10);
    Some((character, treasury, amount - character - treasury))
}

/// Share of the remix pool for the ancestor at `depth` (1 = parent).
#[inline]
pub fn ancestor_share(pool: U256, depth: usize) -> U256 {
    pool >> depth
}

/// Full split for a chain with `depth` ancestors (clamped to [`MAX_DEPTH`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Split {
    pub character: U256,
    pub ancestors: alloc::vec::Vec<U256>,
    pub treasury: U256,
}

pub fn split(amount: U256, depth: usize) -> Option<Split> {
    let (character, treasury, pool) = base_split(amount)?;
    let depth = depth.min(MAX_DEPTH);
    let ancestors: alloc::vec::Vec<U256> = (1..=depth).map(|i| ancestor_share(pool, i)).collect();
    let paid = ancestors.iter().fold(U256::ZERO, |a, b| a + *b);
    Some(Split { character: character + (pool - paid), ancestors, treasury })
}
