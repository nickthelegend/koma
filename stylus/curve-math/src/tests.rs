//! Unit + property tests for `ICurveMath`, and the differential test-vector
//! generator (`test-vectors/curve.json`).
//!
//! Regenerate vectors: `KOMA_WRITE_VECTORS=1 cargo test -p curve-math vectors`
//! Without the env var the test regenerates in memory and asserts the
//! committed file is byte-identical.

use super::*;
use alloy_primitives::{U256, U512};
use math::{MathError, WAD};

// ---------------------------------------------------------------- helpers

/// Deterministic splitmix64 PRNG (no external crates).
pub(crate) struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self { Rng(seed) }
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: u64) -> u64 { if n == 0 { 0 } else { self.next() % n } }
    /// Uniform 256-bit value.
    pub fn u256(&mut self) -> U256 {
        U256::from_limbs([self.next(), self.next(), self.next(), self.next()])
    }
    /// Random value with exactly `bits` significant bits (0 => 0).
    pub fn bits(&mut self, bits: usize) -> U256 {
        if bits == 0 { return U256::ZERO; }
        let v = self.u256() >> (256 - bits);
        v | (U256::from(1u8) << (bits - 1))
    }
    /// Uniform in [lo, hi] (hi - lo must fit in u128).
    pub fn range(&mut self, lo: U256, hi: U256) -> U256 {
        let span = hi - lo;
        let r = U256::from(((self.next() as u128) << 64) | self.next() as u128);
        if span == U256::MAX { r } else { lo + r % (span + U256::from(1u8)) }
    }
    /// Log-uniform-ish in [0, 10^max_exp]: random decimal magnitude, random mantissa.
    pub fn log10(&mut self, max_exp: u32) -> U256 {
        let e = self.below(max_exp as u64 + 1) as u32;
        let top = U256::from(10u8).pow(U256::from(e));
        self.range(U256::ZERO, top)
    }
}

fn u(x: u128) -> U256 { U256::from(x) }
fn pow10(e: u32) -> U256 { U256::from(10u8).pow(U256::from(e)) }
fn w(x: U256) -> U512 {
    let l = x.as_limbs();
    U512::from_limbs([l[0], l[1], l[2], l[3], 0, 0, 0, 0])
}

/// Independent 512-bit reference: out = y - ceil(x*y/(x+dx)).
fn reference_out(x: U256, y: U256, dx: U256) -> Option<U256> {
    if x.is_zero() || y.is_zero() { return None; }
    let k = w(x) * w(y);
    let d = w(x) + w(dx);
    if k > w(U256::MAX) || d > w(U256::MAX) { return None; }
    let q = k / d;
    let c = if q * d == k { q } else { q + U512::from(1u8) };
    let out = w(y) - c;
    Some(U256::from_limbs(out.as_limbs()[..4].try_into().unwrap()))
}

/// Random reserves with vU <= 1e15 and vC <= 1e27 (the ranges the launchpad can reach).
fn realistic(rng: &mut Rng) -> (U256, U256) {
    let v_u = rng.range(u(1), pow10(15));
    let v_c = rng.range(u(1), pow10(27));
    (v_u, v_c)
}

// ---------------------------------------------------------------- unit tests

#[test]
fn launch_state_numbers() {
    // VIRTUAL_USDC_0 = 1_000e6, VIRTUAL_COIN_0 = 1e27.
    let (v_u, v_c) = (u(1_000_000_000), pow10(27));
    // Spot: vU * 1e18 / vC = 1e9 * 1e18 / 1e27 = 1 (raw USDC units per 1e18 coin units).
    assert_eq!(math::spot_price(v_u, v_c).unwrap(), u(1));
    // Buying with 1 USDC (1e6): 1e27 - ceil(1e36 / 1_001_000_000)
    let out = math::quote_buy(v_u, v_c, u(1_000_000)).unwrap();
    assert_eq!(out, reference_out(v_u, v_c, u(1_000_000)).unwrap());
    assert_eq!(out, U256::from_str_radix("999000999000999000999000", 10).unwrap());
    // Graduation target 5_000e6 from launch.
    let out = math::quote_buy(v_u, v_c, u(5_000_000_000)).unwrap();
    assert_eq!(out, pow10(27) - (pow10(36) / u(6_000_000_000) + u(1)));
    assert_eq!(math::usdc_to_reach(v_u, v_c, u(6_000_000_000)).unwrap(), u(5_000_000_000));
}

#[test]
fn zero_input_is_zero_output() {
    let mut rng = Rng::new(1);
    for _ in 0..500 {
        let (v_u, v_c) = realistic(&mut rng);
        assert_eq!(math::quote_buy(v_u, v_c, U256::ZERO).unwrap(), U256::ZERO);
        assert_eq!(math::quote_sell(v_u, v_c, U256::ZERO).unwrap(), U256::ZERO);
        assert_eq!(math::usdc_to_reach(v_u, v_c, v_u).unwrap(), U256::ZERO);
    }
}

#[test]
fn zero_reserves_revert() {
    let one = u(1);
    for (a, b) in [(U256::ZERO, one), (one, U256::ZERO), (U256::ZERO, U256::ZERO)] {
        assert_eq!(math::quote_buy(a, b, one), Err(MathError::ZeroReserve));
        assert_eq!(math::quote_sell(a, b, one), Err(MathError::ZeroReserve));
        assert_eq!(math::usdc_to_reach(a, b, u(5)), Err(MathError::ZeroReserve));
        assert_eq!(math::spot_price(a, b), Err(MathError::ZeroReserve));
        // Also through the public ABI surface: revert data is the custom error.
        assert_eq!(CurveMath::quote_buy(a, b, one).unwrap_err(), ZeroReserve {}.abi_encode());
        assert_eq!(CurveMath::quote_sell(a, b, one).unwrap_err(), ZeroReserve {}.abi_encode());
        assert_eq!(CurveMath::usdc_to_reach(a, b, one).unwrap_err(), ZeroReserve {}.abi_encode());
        assert_eq!(CurveMath::spot_price(a, b).unwrap_err(), ZeroReserve {}.abi_encode());
    }
}

#[test]
fn overflow_reverts() {
    let half = U256::from(1u8) << 128;
    // k = vU * vC overflows
    assert_eq!(math::quote_buy(half, half, u(1)), Err(MathError::Overflow));
    assert_eq!(math::quote_sell(half, half, u(1)), Err(MathError::Overflow));
    // just below: 2^128 * (2^128 - 1) fits
    assert!(math::quote_buy(half, half - u(1), u(1)).is_ok());
    // vU + usdcIn overflows
    assert_eq!(math::quote_buy(u(2), u(3), U256::MAX - u(1)), Err(MathError::Overflow));
    assert!(math::quote_buy(u(2), u(3), U256::MAX - u(2)).is_ok());
    // vC + coinIn overflows
    assert_eq!(math::quote_sell(u(2), u(3), U256::MAX - u(2)), Err(MathError::Overflow));
    assert!(math::quote_sell(u(2), u(3), U256::MAX - u(3)).is_ok());
    // spot: vU * 1e18 overflows
    let lim = U256::MAX / WAD;
    assert!(math::spot_price(lim, u(1)).is_ok());
    assert_eq!(math::spot_price(lim + u(1), u(1)), Err(MathError::Overflow));
    let panic = CurveMath::spot_price(lim + u(1), u(1)).unwrap_err();
    assert_eq!(hex(&panic), "0x4e487b710000000000000000000000000000000000000000000000000000000000000011");
}

#[test]
fn usdc_to_reach_reverts_below() {
    assert_eq!(math::usdc_to_reach(u(10), u(1), u(9)), Err(MathError::TargetBelowReserve(u(10), u(9))));
    assert_eq!(
        CurveMath::usdc_to_reach(u(10), u(1), u(9)).unwrap_err(),
        TargetBelowReserve { vU: u(10), targetVU: u(9) }.abi_encode()
    );
    assert_eq!(math::usdc_to_reach(u(10), u(1), U256::MAX).unwrap(), U256::MAX - u(10));
}

#[test]
fn ceil_div_edges() {
    assert_eq!(math::ceil_div(u(0), u(7)), u(0));
    assert_eq!(math::ceil_div(u(7), u(7)), u(1));
    assert_eq!(math::ceil_div(u(8), u(7)), u(2));
    assert_eq!(math::ceil_div(U256::MAX, u(1)), U256::MAX);
    assert_eq!(math::ceil_div(U256::MAX, u(2)), (U256::MAX >> 1) + u(1));
    assert_eq!(math::ceil_div(U256::MAX, U256::MAX), u(1));
}

// ---------------------------------------------------------------- properties

/// Matches the 512-bit reference and rounds against the trader:
/// out * (x + dx) <= y * dx (never more than the exact real-valued output),
/// and it is at most 1 unit below the exact output.
fn check_rounding(x: U256, y: U256, dx: U256, out: U256) {
    assert_eq!(Some(out), reference_out(x, y, dx), "reference mismatch x={x} y={y} dx={dx}");
    let lhs = w(out) * (w(x) + w(dx));
    let exact_num = w(y) * w(dx);
    assert!(lhs <= exact_num, "rounds in favour of trader x={x} y={y} dx={dx}");
    let lhs1 = (w(out) + U512::from(1u8)) * (w(x) + w(dx));
    assert!(lhs1 > exact_num, "more than 1 unit below exact x={x} y={y} dx={dx}");
}

#[test]
fn rounding_direction_random() {
    let mut rng = Rng::new(0xC0FFEE);
    for i in 0..20_000 {
        let (v_u, v_c) = if i % 2 == 0 {
            realistic(&mut rng)
        } else {
            // arbitrary widths with k < 2^256
            let bu = 1 + rng.below(200) as usize;
            let bc = 1 + rng.below((255 - bu) as u64) as usize;
            (rng.bits(bu), rng.bits(bc))
        };
        let usdc_in = rng.log10(20);
        let coin_in = rng.log10(30);
        let b = math::quote_buy(v_u, v_c, usdc_in).unwrap();
        check_rounding(v_u, v_c, usdc_in, b);
        assert!(b < v_c, "can never drain the coin reserve");
        let s = math::quote_sell(v_u, v_c, coin_in).unwrap();
        check_rounding(v_c, v_u, coin_in, s);
        assert!(s < v_u, "can never drain the USDC reserve");
    }
}

#[test]
fn buy_then_sell_never_profits() {
    let mut rng = Rng::new(42);
    for _ in 0..20_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let usdc_in = rng.log10(15);
        let c = math::quote_buy(v_u, v_c, usdc_in).unwrap();
        let (v_u2, v_c2) = (v_u + usdc_in, v_c - c);
        // k never decreases through a trade
        assert!(w(v_u2) * w(v_c2) >= w(v_u) * w(v_c));
        let back = math::quote_sell(v_u2, v_c2, c).unwrap();
        assert!(back <= usdc_in, "round trip returned more than put in");
    }
}

#[test]
fn sell_then_buy_never_profits() {
    let mut rng = Rng::new(43);
    for _ in 0..20_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let coin_in = rng.log10(27);
        let got = math::quote_sell(v_u, v_c, coin_in).unwrap();
        let (v_u2, v_c2) = (v_u - got, v_c + coin_in);
        assert!(w(v_u2) * w(v_c2) >= w(v_u) * w(v_c));
        let back = math::quote_buy(v_u2, v_c2, got).unwrap();
        assert!(back <= coin_in, "round trip returned more than put in");
    }
}

#[test]
fn splitting_a_buy_never_beats_one_buy() {
    let mut rng = Rng::new(44);
    for _ in 0..5_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let a = rng.log10(12);
        let b = rng.log10(12);
        let one = math::quote_buy(v_u, v_c, a + b).unwrap();
        let c1 = math::quote_buy(v_u, v_c, a).unwrap();
        let c2 = math::quote_buy(v_u + a, v_c - c1, b).unwrap();
        assert!(c1 + c2 <= one + u(1), "split {a}+{b}: {c1}+{c2} vs {one}");
    }
}

#[test]
fn monotonic_in_input() {
    let mut rng = Rng::new(45);
    for _ in 0..5_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let a = rng.log10(15);
        let b = a + rng.log10(10);
        assert!(math::quote_buy(v_u, v_c, a).unwrap() <= math::quote_buy(v_u, v_c, b).unwrap());
        assert!(math::quote_sell(v_u, v_c, a).unwrap() <= math::quote_sell(v_u, v_c, b).unwrap());
    }
}

#[test]
fn large_values() {
    let v_u = pow10(15);
    let v_c = pow10(27);
    for input in [u(1), pow10(6), pow10(15), pow10(27), pow10(40), U256::MAX - v_c] {
        let b = math::quote_buy(v_u, v_c, input.min(U256::MAX - v_u)).unwrap();
        check_rounding(v_u, v_c, input.min(U256::MAX - v_u), b);
        let s = math::quote_sell(v_u, v_c, input).unwrap();
        check_rounding(v_c, v_u, input, s);
    }
    // Absurd input: the whole reserve minus the ceil'ed remainder.
    assert_eq!(math::quote_buy(v_u, v_c, U256::MAX - v_u).unwrap(), v_c - u(1));
    assert_eq!(math::quote_sell(v_u, v_c, U256::MAX - v_c).unwrap(), v_u - u(1));
    assert_eq!(math::spot_price(v_u, v_c).unwrap(), pow10(6));
    assert_eq!(math::spot_price(u(1), pow10(27)).unwrap(), U256::ZERO);
}

#[test]
fn spot_price_matches_reference() {
    let mut rng = Rng::new(46);
    for _ in 0..10_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let p = math::spot_price(v_u, v_c).unwrap();
        assert_eq!(w(p), w(v_u) * w(WAD) / w(v_c));
        assert_eq!(CurveMath::spot_price(v_u, v_c).unwrap(), p);
    }
}

#[test]
fn public_surface_matches_math() {
    let mut rng = Rng::new(47);
    for _ in 0..2_000 {
        let (v_u, v_c) = realistic(&mut rng);
        let x = rng.log10(20);
        assert_eq!(CurveMath::quote_buy(v_u, v_c, x).unwrap(), math::quote_buy(v_u, v_c, x).unwrap());
        assert_eq!(CurveMath::quote_sell(v_u, v_c, x).unwrap(), math::quote_sell(v_u, v_c, x).unwrap());
        assert_eq!(CurveMath::usdc_to_reach(v_u, v_c, v_u + x).unwrap(), x);
    }
}

// ---------------------------------------------------------------- test vectors

fn s(x: U256) -> String { format!("\"{x}\"") }

fn hex(b: &[u8]) -> String {
    let mut out = String::from("0x");
    for x in b { out.push_str(&format!("{x:02x}")); }
    out
}

fn case_json(v_u: U256, v_c: U256, usdc_in: U256, coin_in: U256, target: U256) -> Option<String> {
    let b = math::quote_buy(v_u, v_c, usdc_in).ok()?;
    let sl = math::quote_sell(v_u, v_c, coin_in).ok()?;
    let r = math::usdc_to_reach(v_u, v_c, target).ok()?;
    let p = math::spot_price(v_u, v_c).ok()?;
    // Keys in alphabetical order so Foundry can abi.decode into a struct.
    Some(format!(
        "{{\"coinIn\":{},\"quoteBuy\":{},\"quoteSell\":{},\"spotPrice\":{},\"targetVU\":{},\"usdcIn\":{},\"usdcToReach\":{},\"vC\":{},\"vU\":{}}}",
        s(coin_in), s(b), s(sl), s(p), s(target), s(usdc_in), s(r), s(v_c), s(v_u)
    ))
}

fn err_name(e: MathError) -> &'static str {
    match e {
        MathError::ZeroReserve => "ZeroReserve()",
        MathError::Overflow => "Panic(0x11)",
        MathError::TargetBelowReserve(..) => "TargetBelowReserve(uint256,uint256)",
    }
}

fn revert_json(f: &str, v_u: U256, v_c: U256, x: U256) -> String {
    let r = match f {
        "quoteBuy" => math::quote_buy(v_u, v_c, x),
        "quoteSell" => math::quote_sell(v_u, v_c, x),
        "usdcToReach" => math::usdc_to_reach(v_u, v_c, x),
        "spotPrice" => math::spot_price(v_u, v_c),
        _ => unreachable!(),
    };
    let e = r.expect_err("revert case must revert");
    format!(
        "{{\"error\":\"{}\",\"fn\":\"{f}\",\"revertData\":\"{}\",\"vC\":{},\"vU\":{},\"x\":{}}}",
        err_name(e), hex(&revert(e)), s(v_c), s(v_u), s(x)
    )
}

fn generate_curve_vectors() -> String {
    let mut rng = Rng::new(0x4B4F4D41); // "KOMA"
    let mut cases: Vec<String> = Vec::new();
    let mut push = |c: Option<String>| cases.push(c.expect("vector case must not revert"));

    // 1) Boundaries.
    let v0u = u(1_000_000_000);
    let v0c = pow10(27);
    let k0 = pow10(36);
    let max = U256::MAX;
    let boundary: Vec<(U256, U256, U256, U256)> = vec![
        (u(1), u(1), u(0), u(0)),
        (u(1), u(1), u(1), u(1)),
        (u(1), u(1), max - u(1), max - u(1)),
        (u(1), u(2), u(1), u(1)),
        (u(2), u(1), u(1), u(1)),
        (u(3), u(7), u(5), u(11)),
        (v0u, v0c, u(0), u(0)),
        (v0u, v0c, u(1), u(1)),
        (v0u, v0c, u(1_000_000), pow10(18)),
        (v0u, v0c, u(25_000_000), pow10(24)),
        (v0u, v0c, u(5_000_000_000), u(20_000_000) * pow10(18)),
        (v0u, v0c, u(5_050_505_050), u(950_000_000) * pow10(18)),
        (v0u, v0c, max - v0u, max - v0c),
        (u(6_000_000_000), k0 / u(6_000_000_000), u(1), u(1)),
        (u(6_000_000_000), k0 / u(6_000_000_000) + u(1), u(1_000_000), pow10(18)),
        (pow10(15), pow10(27), pow10(15), pow10(27)),
        (pow10(15), u(1), u(1), u(1)),
        (u(1), pow10(27), pow10(15), pow10(27)),
        (U256::from(1u8) << 128, (U256::from(1u8) << 128) - u(1), u(1), u(1)),
        ((U256::from(1u8) << 128) - u(1), U256::from(1u8) << 128, max - (U256::from(1u8) << 128), u(3)),
        (max / WAD, u(1), u(0), u(0)),
        (u(1), max, u(1), u(0)),
        // exact division: no rounding needed (k divisible by the new reserve)
        (u(100), u(100), u(100), u(100)),
        (u(1_000), u(1_000_000), u(1_000), u(1_000_000)),
    ];
    for (a, b, bi, si) in boundary {
        push(case_json(a, b, bi, si, a));
        push(case_json(a, b, bi, si, a.saturating_add(bi)));
    }

    // 2) Realistic launchpad states: walk real buy/sell sequences from launch.
    for _ in 0..40 {
        let (mut v_u, mut v_c) = (v0u, v0c);
        for _ in 0..25 {
            let usdc_in = rng.range(u(0), u(500_000_000));
            let coin_in = rng.range(u(0), v0c - v_c + pow10(18));
            let target = v_u + rng.range(u(0), u(6_000_000_000));
            push(case_json(v_u, v_c, usdc_in, coin_in, target));
            if rng.below(3) == 0 && v_c < v0c {
                let c = rng.range(u(1), v0c - v_c);
                let got = math::quote_sell(v_u, v_c, c).unwrap();
                v_u -= got;
                v_c += c;
            } else {
                let x = rng.range(u(1), u(300_000_000));
                let c = math::quote_buy(v_u, v_c, x).unwrap();
                v_u += x;
                v_c -= c;
            }
        }
    }

    // 3) Random within the reachable ranges (vU <= 1e15, vC <= 1e27).
    for _ in 0..700 {
        let (v_u, v_c) = realistic(&mut rng);
        let usdc_in = rng.log10(16);
        let coin_in = rng.log10(28);
        let target = v_u + rng.log10(15);
        push(case_json(v_u, v_c, usdc_in, coin_in, target));
    }

    // 4) Log-uniform magnitudes across both scales.
    for _ in 0..500 {
        let v_u = rng.log10(15).max(u(1));
        let v_c = rng.log10(27).max(u(1));
        let usdc_in = rng.log10(30);
        let coin_in = rng.log10(40);
        let target = v_u + rng.log10(20);
        push(case_json(v_u, v_c, usdc_in, coin_in, target));
    }

    // 5) Wide random bit-widths (k < 2^256, vU*1e18 < 2^256).
    for _ in 0..300 {
        let bu = 1 + rng.below(190) as usize;
        let bc = 1 + rng.below((255 - bu) as u64) as usize;
        let v_u = rng.bits(bu);
        let v_c = rng.bits(bc);
        let (n1, n2, n3) = (rng.below(255) as usize, rng.below(255) as usize, rng.below(200) as usize);
        let usdc_in = rng.bits(n1);
        let coin_in = rng.bits(n2);
        let target = v_u.saturating_add(rng.bits(n3));
        push(case_json(v_u, v_c, usdc_in, coin_in, target));
    }

    // Reverts.
    let half = U256::from(1u8) << 128;
    let mut reverts: Vec<String> = Vec::new();
    for f in ["quoteBuy", "quoteSell", "usdcToReach", "spotPrice"] {
        reverts.push(revert_json(f, U256::ZERO, v0c, u(1)));
        reverts.push(revert_json(f, v0u, U256::ZERO, u(1)));
        reverts.push(revert_json(f, U256::ZERO, U256::ZERO, u(0)));
    }
    reverts.push(revert_json("quoteBuy", half, half, u(1)));
    reverts.push(revert_json("quoteSell", half, half, u(1)));
    reverts.push(revert_json("quoteBuy", u(2), u(3), max - u(1)));
    reverts.push(revert_json("quoteSell", u(2), u(3), max - u(2)));
    reverts.push(revert_json("quoteBuy", v0u, v0c, max - v0u + u(1)));
    reverts.push(revert_json("quoteSell", v0u, v0c, max - v0c + u(1)));
    reverts.push(revert_json("spotPrice", max / WAD + u(1), u(1), u(0)));
    reverts.push(revert_json("usdcToReach", v0u, v0c, v0u - u(1)));
    reverts.push(revert_json("usdcToReach", u(10), u(1), u(0)));

    format!(
        "{{\n  \"description\": \"KOMA ICurveMath differential vectors. All integers are decimal strings. cases[]: every function succeeds with the listed output (quoteBuy uses usdcIn, quoteSell uses coinIn, usdcToReach uses targetVU). reverts[]: fn(vU, vC, x) must revert (x is the third argument; ignored for spotPrice). revertData = exact revert bytes (identical to contracts/src/CurveMathReference.sol: ZeroReserve(), TargetBelowReserve(vU,targetVU), Panic(0x11) on overflow).\",\n  \"generator\": \"stylus/curve-math/src/tests.rs::curve_vectors (KOMA_WRITE_VECTORS=1 cargo test -p curve-math curve_vectors)\",\n  \"count\": {},\n  \"cases\": [\n    {}\n  ],\n  \"reverts\": [\n    {}\n  ]\n}}\n",
        cases.len(),
        cases.join(",\n    "),
        reverts.join(",\n    ")
    )
}

#[test]
fn curve_vectors() {
    let json = generate_curve_vectors();
    assert!(json.matches("\"quoteBuy\":").count() >= 2_000, "need >= 2000 cases");
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../test-vectors/curve.json");
    if std::env::var("KOMA_WRITE_VECTORS").is_ok() {
        std::fs::write(path, &json).unwrap();
    } else {
        let committed = std::fs::read_to_string(path)
            .expect("test-vectors/curve.json missing: run with KOMA_WRITE_VECTORS=1");
        assert!(committed == json, "curve.json is stale: rerun with KOMA_WRITE_VECTORS=1");
    }
}
