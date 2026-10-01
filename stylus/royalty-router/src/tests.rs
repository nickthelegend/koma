//! Unit tests for `IRoyaltyRouter` (TestVM) and the router test-vector
//! generator (`test-vectors/router.json`).
//!
//! Regenerate vectors: `KOMA_WRITE_VECTORS=1 cargo test -p royalty-router vectors`

use super::*;
use alloy_primitives::{Address, B256, U256, address};
use alloy_sol_types::{SolCall, SolEvent, SolValue};
use stylus_sdk::testing::*;

alloy_sol_types::sol! {
    interface IERC20Abi {
        function transfer(address to, uint256 amount) external returns (bool);
    }
}

const OWNER: Address = address!("00000000000000000000000000000000000000A1");
const FACTORY: Address = address!("00000000000000000000000000000000000000F1");
const USDC: Address = address!("00000000000000000000000000000000000000C0");
const TREASURY: Address = address!("00000000000000000000000000000000000000EE");
const STRANGER: Address = address!("0000000000000000000000000000000000000BAD");

fn u(x: u128) -> U256 { U256::from(x) }
fn curve(id: u64) -> Address { Address::left_padding_from(&(0x1000_0000u64 + id).to_be_bytes()) }
fn account(id: u64) -> Address { Address::left_padding_from(&(0x2000_0000u64 + id).to_be_bytes()) }

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn amount(&mut self) -> U256 {
        // mix of dust, realistic USDC fees and huge values
        match self.next() % 4 {
            0 => u((self.next() % 64) as u128),
            1 => u((self.next() % 100_000_000) as u128),
            2 => u(((self.next() as u128) << 64) | self.next() as u128),
            _ => U256::from_limbs([self.next(), self.next(), self.next(), self.next() >> 13]),
        }
    }
}

const DEPLOYER: Address = address!("00000000000000000000000000000000000000D0");

fn unauth(a: Address) -> Vec<u8> { Unauthorized { caller: a }.abi_encode() }
fn zero_addr() -> Vec<u8> { ZeroAddress {}.abi_encode() }

/// Fresh router as deployed by DEPLOYER (constructor records tx.origin).
fn deployed() -> (TestVM, RoyaltyRouter) {
    let vm = TestVM::default();
    let mut r = RoyaltyRouter::from(&vm);
    vm.set_tx_origin(DEPLOYER);
    vm.set_sender(address!("cEcba2F1DC234f70Dd89F2041029807F8D03A990")); // StylusDeployer
    r.constructor();
    (vm, r)
}

fn setup() -> (TestVM, RoyaltyRouter) {
    let (vm, mut r) = deployed();
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, OWNER).unwrap();
    vm.set_sender(OWNER);
    r.set_factory(FACTORY).unwrap();
    (vm, r)
}

/// Registers series 1..=n where series i's parent is i-1 (series 1 is a root).
fn chain(vm: &TestVM, r: &mut RoyaltyRouter, n: u64) {
    vm.set_sender(FACTORY);
    for id in 1..=n {
        r.register_series(u(id as u128), curve(id), account(id), u((id - 1) as u128)).unwrap();
    }
}

fn transfer_data(to: Address, amount: U256) -> Vec<u8> {
    IERC20Abi::transferCall { to, amount }.abi_encode()
}

fn mock_transfer(vm: &TestVM, to: Address, amount: U256, ok: bool) {
    vm.mock_call(USDC, transfer_data(to, amount), U256::ZERO, Ok(ok.abi_encode()));
}

/// Expected (recipient, amount, kind) legs for routing `amount` on series `id`
/// in a linear chain, in payment order, zero legs dropped.
fn expected_legs(id: u64, amount: U256) -> Vec<(Address, U256, u8)> {
    let depth = (id - 1) as usize;
    let sp = split::split(amount, depth).unwrap();
    let mut legs = Vec::new();
    for (i, a) in sp.ancestors.iter().enumerate() {
        legs.push((account(id - 1 - i as u64), *a, KIND_ANCESTOR));
    }
    legs.push((account(id), sp.character, KIND_CHARACTER));
    legs.push((TREASURY, sp.treasury, KIND_TREASURY));
    legs.retain(|l| !l.1.is_zero());
    legs
}

fn routed_logs(vm: &TestVM) -> Vec<(U256, Address, U256, u8)> {
    vm.get_emitted_logs()
        .into_iter()
        .filter(|(t, _)| t[0] == Routed::SIGNATURE_HASH)
        .map(|(t, d)| {
            let ev = Routed::decode_raw_log(t.iter().copied(), &d).unwrap();
            (ev.seriesId, ev.recipient, ev.amount, ev.kind)
        })
        .collect()
}

// ---------------------------------------------------------------- ABI shape

#[test]
fn event_signatures_match_spec() {
    assert_eq!(Routed::SIGNATURE, "Routed(uint256,address,uint256,uint8)");
    assert_eq!(SeriesRegistered::SIGNATURE, "SeriesRegistered(uint256,address,address,uint256)");
    // indexed layout: Routed(seriesId idx, recipient idx | amount, kind)
    let vm = TestVM::default();
    vm.log(Routed { seriesId: u(7), recipient: account(1), amount: u(9), kind: 2 });
    vm.log(SeriesRegistered { seriesId: u(7), curve: curve(7), characterAccount: account(7), parentSeriesId: u(3) });
    let logs = vm.get_emitted_logs();
    assert_eq!(logs[0].0.len(), 3);
    assert_eq!(logs[0].0[1], B256::from(u(7)));
    assert_eq!(logs[0].0[2], account(1).into_word());
    assert_eq!(logs[0].1, (u(9), u(2)).abi_encode_params());
    assert_eq!(logs[1].0.len(), 2);
    assert_eq!(logs[1].1, (curve(7), account(7), u(3)).abi_encode_params());
}

#[test]
fn hand_encoded_logs_equal_alloy_encoding() {
    let (vm, mut r) = setup();
    vm.set_sender(FACTORY);
    let (id, c, a, p) = (U256::MAX, curve(3), account(3), u(0));
    r.register_series(id, c, a, p).unwrap();
    let reference = TestVM::default();
    reference.log(OwnershipTransferred { previousOwner: Address::ZERO, newOwner: OWNER }); // from initialize
    reference.log(SeriesRegistered { seriesId: id, curve: c, characterAccount: a, parentSeriesId: p });
    assert_eq!(vm.get_emitted_logs(), reference.get_emitted_logs());

    let (vm, mut r) = setup();
    chain(&vm, &mut r, 2);
    let amount = U256::MAX / u(4_000);
    for (to, a, _) in expected_legs(2, amount) {
        mock_transfer(&vm, to, a, true);
    }
    vm.set_sender(curve(2));
    r.route(u(2), amount).unwrap();
    let reference = TestVM::default();
    for (to, a, kind) in expected_legs(2, amount) {
        reference.log(Routed { seriesId: u(2), recipient: to, amount: a, kind });
    }
    let got: Vec<_> = vm.get_emitted_logs().into_iter().filter(|l| l.0[0] == Routed::SIGNATURE_HASH).collect();
    assert_eq!(got, reference.get_emitted_logs());
}

// ---------------------------------------------------------------- initialize / access control

#[test]
fn initialize_once_and_only_by_deployer() {
    let (vm, mut r) = deployed();
    assert_eq!(r.owner(), Address::ZERO);
    // front-running attempt by anyone else, including the StylusDeployer proxy
    for who in [STRANGER, OWNER, address!("cEcba2F1DC234f70Dd89F2041029807F8D03A990")] {
        vm.set_sender(who);
        assert_eq!(r.initialize(USDC, TREASURY, STRANGER).unwrap_err(), unauth(who));
    }
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, OWNER).unwrap();
    assert_eq!((r.usdc(), r.treasury(), r.owner(), r.factory()), (USDC, TREASURY, OWNER, Address::ZERO));
    assert_eq!(r.initialize(USDC, TREASURY, STRANGER).unwrap_err(), AlreadyInitialized {}.abi_encode());
    vm.set_sender(OWNER);
    assert_eq!(r.initialize(USDC, TREASURY, OWNER).unwrap_err(), unauth(OWNER));
    assert_eq!(r.owner(), OWNER);
}

#[test]
fn not_constructed_router_cannot_be_initialized_by_nonzero_sender() {
    let vm = TestVM::default();
    let mut r = RoyaltyRouter::from(&vm);
    vm.set_sender(STRANGER);
    assert_eq!(r.initialize(USDC, TREASURY, OWNER).unwrap_err(), unauth(STRANGER));
}

#[test]
fn initialize_rejects_zero_addresses() {
    let (vm, mut r) = deployed();
    vm.set_sender(DEPLOYER);
    assert_eq!(r.initialize(Address::ZERO, TREASURY, OWNER).unwrap_err(), zero_addr());
    assert_eq!(r.initialize(USDC, Address::ZERO, OWNER).unwrap_err(), zero_addr());
    assert_eq!(r.initialize(USDC, TREASURY, Address::ZERO).unwrap_err(), zero_addr());
    r.initialize(USDC, TREASURY, OWNER).unwrap();
}

#[test]
fn set_factory_owner_only() {
    let (vm, mut r) = deployed();
    // before initialize: nobody (owner is zero, sender zero must not pass)
    vm.set_sender(Address::ZERO);
    assert_eq!(r.set_factory(FACTORY).unwrap_err(), unauth(Address::ZERO));
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, OWNER).unwrap();
    for who in [STRANGER, FACTORY, TREASURY, USDC, DEPLOYER] {
        vm.set_sender(who);
        assert_eq!(r.set_factory(FACTORY).unwrap_err(), unauth(who));
    }
    vm.set_sender(OWNER);
    assert_eq!(r.set_factory(Address::ZERO).unwrap_err(), zero_addr());
    r.set_factory(FACTORY).unwrap();
    assert_eq!(r.factory(), FACTORY);
    r.set_factory(STRANGER).unwrap(); // rotation allowed
    assert_eq!(r.factory(), STRANGER);
}

#[test]
fn register_series_factory_only_and_validation() {
    let (vm, mut r) = setup();
    for who in [OWNER, STRANGER, DEPLOYER, curve(1), Address::ZERO] {
        vm.set_sender(who);
        assert_eq!(r.register_series(u(1), curve(1), account(1), u(0)).unwrap_err(), unauth(who));
    }
    vm.set_sender(FACTORY);
    let exists = |id: u128| SeriesExists { seriesId: u(id) }.abi_encode();
    let unknown = |id: u128| UnknownSeries { seriesId: u(id) }.abi_encode();
    assert_eq!(r.register_series(u(0), curve(1), account(1), u(0)).unwrap_err(), exists(0));
    assert_eq!(r.register_series(u(1), curve(1), account(1), u(1)).unwrap_err(), unknown(1));
    assert_eq!(r.register_series(u(1), Address::ZERO, account(1), u(0)).unwrap_err(), zero_addr());
    assert_eq!(r.register_series(u(1), curve(1), Address::ZERO, u(0)).unwrap_err(), zero_addr());
    assert_eq!(r.register_series(u(2), curve(2), account(2), u(1)).unwrap_err(), unknown(1));
    r.register_series(u(1), curve(1), account(1), u(0)).unwrap();
    assert_eq!(r.register_series(u(1), curve(9), account(9), u(0)).unwrap_err(), exists(1));
    r.register_series(u(2), curve(2), account(2), u(1)).unwrap();
    assert_eq!((r.curve_of(u(2)), r.account_of(u(2)), r.parent_of(u(2))), (curve(2), account(2), u(1)));
    assert_eq!((r.curve_of(u(3)), r.account_of(u(3)), r.parent_of(u(3))), (Address::ZERO, Address::ZERO, u(0)));

    let logs: Vec<_> =
        vm.get_emitted_logs().into_iter().filter(|(t, _)| t[0] == SeriesRegistered::SIGNATURE_HASH).collect();
    assert_eq!(logs.len(), 2);
    let ev = SeriesRegistered::decode_raw_log(logs[1].0.iter().copied(), &logs[1].1).unwrap();
    assert_eq!((ev.seriesId, ev.curve, ev.characterAccount, ev.parentSeriesId), (u(2), curve(2), account(2), u(1)));
}

fn ownership_logs(vm: &TestVM) -> Vec<(Address, Address)> {
    vm.get_emitted_logs()
        .into_iter()
        .filter(|(t, _)| t[0] == OwnershipTransferred::SIGNATURE_HASH)
        .map(|(t, d)| {
            let ev = OwnershipTransferred::decode_raw_log(t.iter().copied(), &d).unwrap();
            (ev.previousOwner, ev.newOwner)
        })
        .collect()
}

#[test]
fn ownership_transferred_event_matches_alloy_encoding() {
    assert_eq!(OwnershipTransferred::SIGNATURE, "OwnershipTransferred(address,address)");
    let (vm, mut r) = deployed();
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, OWNER).unwrap();
    let reference = TestVM::default();
    reference.log(OwnershipTransferred { previousOwner: Address::ZERO, newOwner: OWNER });
    assert_eq!(vm.get_emitted_logs(), reference.get_emitted_logs());
}

#[test]
fn transfer_ownership_owner_only_and_hands_over_set_factory() {
    let (vm, mut r) = deployed();
    // before initialize nobody owns it, not even a zero sender
    vm.set_sender(Address::ZERO);
    assert_eq!(r.transfer_ownership(OWNER).unwrap_err(), unauth(Address::ZERO));
    // deployer initializes with itself as owner, wires the factory, then hands over to the admin
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, DEPLOYER).unwrap();
    r.set_factory(FACTORY).unwrap();
    for who in [STRANGER, FACTORY, TREASURY, OWNER] {
        vm.set_sender(who);
        assert_eq!(r.transfer_ownership(who).unwrap_err(), unauth(who));
    }
    vm.set_sender(DEPLOYER);
    assert_eq!(r.transfer_ownership(Address::ZERO).unwrap_err(), zero_addr());
    r.transfer_ownership(OWNER).unwrap();
    assert_eq!(r.owner(), OWNER);
    assert_eq!(ownership_logs(&vm), vec![(Address::ZERO, DEPLOYER), (DEPLOYER, OWNER)]);
    // the old owner is locked out, the new one has every owner power
    assert_eq!(r.set_factory(STRANGER).unwrap_err(), unauth(DEPLOYER));
    assert_eq!(r.transfer_ownership(DEPLOYER).unwrap_err(), unauth(DEPLOYER));
    vm.set_sender(OWNER);
    r.set_factory(STRANGER).unwrap();
    assert_eq!(r.factory(), STRANGER);
    // usdc / treasury are untouched by ownership changes
    assert_eq!((r.usdc(), r.treasury()), (USDC, TREASURY));
}

#[test]
fn register_before_set_factory_fails() {
    let (vm, mut r) = deployed();
    vm.set_sender(DEPLOYER);
    r.initialize(USDC, TREASURY, OWNER).unwrap();
    vm.set_sender(Address::ZERO); // factory unset (zero) must not match a zero sender
    assert_eq!(r.register_series(u(1), curve(1), account(1), u(0)).unwrap_err(), unauth(Address::ZERO));
}

#[test]
fn route_only_by_that_series_curve() {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 3);
    for who in [OWNER, FACTORY, STRANGER, curve(1), curve(3), account(2), Address::ZERO] {
        vm.set_sender(who);
        assert_eq!(r.route(u(2), u(1_000)).unwrap_err(), unauth(who), "{who}");
    }
    // unknown series, even from address zero
    vm.set_sender(Address::ZERO);
    assert_eq!(r.route(u(99), u(1_000)).unwrap_err(), unauth(Address::ZERO));
    vm.set_sender(curve(2));
    assert_eq!(r.route(u(99), u(1_000)).unwrap_err(), unauth(curve(2)));
    assert!(routed_logs(&vm).is_empty());
}

// ---------------------------------------------------------------- routing

#[test]
fn split_sums_to_amount_every_depth() {
    let mut rng = Rng(7);
    let mut amounts: Vec<U256> = (0..=300u128).map(u).collect();
    amounts.extend([u(9_999), u(10_000), u(10_001), U256::MAX / u(4_000), U256::MAX / u(4_000) - u(1)]);
    for _ in 0..3_000 { amounts.push(rng.amount()); }
    for a in amounts {
        for depth in 0..=10usize {
            let sp = split::split(a, depth).unwrap();
            assert_eq!(sp.ancestors.len(), depth.min(8));
            let total = sp.ancestors.iter().fold(sp.character + sp.treasury, |x, y| x + *y);
            assert_eq!(total, a, "amount {a} depth {depth}");
            // literal spec expressions (ruint on the host)
            let spec_char = a * u(4_000) / u(10_000);
            let spec_tre = a * u(4_000) / u(10_000);
            let spec_pool = a - spec_char - spec_tre;
            assert_eq!(split::base_split(a).unwrap(), (spec_char, spec_tre, spec_pool));
            assert_eq!(sp.treasury, spec_tre);
            assert!(sp.character >= spec_char);
            for (i, s) in sp.ancestors.iter().enumerate() {
                let (_, _, pool) = split::base_split(a).unwrap();
                assert_eq!(*s, pool >> (i + 1));
            }
        }
    }
    assert_eq!(split::MAX_AMOUNT, U256::MAX / u(4_000));
    assert!(split::split(U256::MAX / u(4_000) + u(1), 0).is_none());
    assert!(split::split(U256::MAX, 3).is_none());
    assert_eq!((split::CHARACTER_BPS, split::TREASURY_BPS), (4_000, 4_000));
    // 40/20/40 on a round number
    assert_eq!(split::base_split(u(10_000)).unwrap(), (u(4_000), u(4_000), u(2_000)));
}

fn route_and_check(n_chain: u64, id: u64, amount: U256) {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, n_chain);
    let legs = expected_legs(id, amount);
    for (to, a, _) in &legs {
        mock_transfer(&vm, *to, *a, true);
    }
    let before: Vec<U256> = legs.iter().map(|l| r.earned(l.0)).collect();
    vm.set_sender(curve(id));
    r.route(u(id as u128), amount).unwrap();

    let logs = routed_logs(&vm);
    let want: Vec<_> = legs.iter().map(|(to, a, k)| (u(id as u128), *to, *a, *k)).collect();
    assert_eq!(logs, want, "events for series {id} amount {amount}");
    let total: U256 = logs.iter().fold(U256::ZERO, |s, l| s + l.2);
    assert_eq!(total, amount, "paid exactly amount");
    for (i, (to, a, _)) in legs.iter().enumerate() {
        assert_eq!(r.earned(*to), before[i] + *a);
    }
    // ancestors deeper than 8 get nothing
    if id > 9 {
        for anc in 1..(id - 8) {
            assert_eq!(r.earned(account(anc)), U256::ZERO, "depth > 8 ancestor {anc} paid");
        }
    }
}

#[test]
fn route_every_depth_random_amounts() {
    let mut rng = Rng(11);
    for depth in 0..=10u64 {
        for _ in 0..40 {
            let amt = rng.amount();
            let amt = amt.min(U256::MAX / u(4_000));
            route_and_check(depth + 1, depth + 1, amt);
        }
        for amt in [0u128, 1, 2, 3, 5, 7, 10, 99, 100, 255, 256, 257, 511, 1_000_000] {
            route_and_check(depth + 1, depth + 1, u(amt));
        }
    }
}

#[test]
fn route_root_series_gives_pool_to_character() {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 1);
    mock_transfer(&vm, account(1), u(600_000), true);
    mock_transfer(&vm, TREASURY, u(400_000), true);
    vm.set_sender(curve(1));
    r.route(u(1), u(1_000_000)).unwrap();
    assert_eq!(r.earned(account(1)), u(600_000));
    assert_eq!(r.earned(TREASURY), u(400_000));
}

#[test]
fn route_depth3_numbers() {
    // 1_000_000 -> char 400_000, treasury 400_000, pool 200_000
    // parent 100_000, grandparent 50_000, great-grandparent 25_000, char += 25_000
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 4);
    for (to, a) in [(account(3), 100_000), (account(2), 50_000), (account(1), 25_000), (account(4), 425_000), (TREASURY, 400_000)] {
        mock_transfer(&vm, to, u(a), true);
    }
    vm.set_sender(curve(4));
    r.route(u(4), u(1_000_000)).unwrap();
    assert_eq!(r.earned(account(4)), u(425_000));
    assert_eq!(r.earned(account(3)), u(100_000));
    assert_eq!(r.earned(account(2)), u(50_000));
    assert_eq!(r.earned(account(1)), u(25_000));
    assert_eq!(r.earned(TREASURY), u(400_000));
    // earned accumulates across calls
    vm.set_sender(curve(4));
    r.route(u(4), u(1_000_000)).unwrap();
    assert_eq!(r.earned(account(4)), u(850_000));
    assert_eq!(r.earned(TREASURY), u(800_000));
}

#[test]
fn branching_tree_pays_only_own_lineage() {
    let (vm, mut r) = setup();
    vm.set_sender(FACTORY);
    r.register_series(u(1), curve(1), account(1), u(0)).unwrap();
    r.register_series(u(2), curve(2), account(2), u(1)).unwrap();
    r.register_series(u(3), curve(3), account(3), u(1)).unwrap(); // sibling of 2
    r.register_series(u(4), curve(4), account(4), u(3)).unwrap();
    // 4 -> 3 -> 1: pool 2_000 → 3 gets 1_000, 1 gets 500, 4 gets 4_000 + 500
    for (to, a) in [(account(3), 1_000), (account(1), 500), (account(4), 4_500), (TREASURY, 4_000)] {
        mock_transfer(&vm, to, u(a), true);
    }
    vm.set_sender(curve(4));
    r.route(u(4), u(10_000)).unwrap();
    assert_eq!(r.earned(account(2)), U256::ZERO);
    assert_eq!(r.earned(account(4)), u(4_500));
}

#[test]
fn transfer_returning_false_reverts() {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 1);
    // stylus-test 0.10.9 quirk: TestVM serves the return data of the *last
    // registered* mock for every call, so register only the `false` mock.
    mock_transfer(&vm, account(1), u(6_000), false);
    vm.set_sender(curve(1));
    assert_eq!(r.route(u(1), u(10_000)).unwrap_err(), SafeERC20FailedOperation { token: USDC }.abi_encode());
}

#[test]
fn transfer_reverting_bubbles_revert_data() {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 1);
    vm.mock_call(USDC, transfer_data(account(1), u(6_000)), U256::ZERO, Err(b"nope".to_vec()));
    vm.set_sender(curve(1));
    assert_eq!(r.route(u(1), u(10_000)).unwrap_err(), b"nope".to_vec());
}

#[test]
fn transfer_without_return_data_reverts() {
    // Unmocked call => success with empty return data => cannot decode bool => revert.
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 1);
    vm.set_sender(curve(1));
    assert_eq!(r.route(u(1), u(10_000)).unwrap_err(), SafeERC20FailedOperation { token: USDC }.abi_encode());
}

#[test]
fn route_amount_overflow_panics_like_solidity() {
    let (vm, mut r) = setup();
    chain(&vm, &mut r, 1);
    vm.set_sender(curve(1));
    let panic = alloy_sol_types::Panic { code: u(0x11) }.abi_encode();
    assert_eq!(r.route(u(1), U256::MAX).unwrap_err(), panic);
    assert_eq!(r.route(u(1), split::MAX_AMOUNT + u(1)).unwrap_err(), panic);
}

// ---------------------------------------------------------------- vectors

fn s(x: U256) -> String { format!("\"{x}\"") }

fn generate_router_vectors() -> String {
    let mut rng = Rng(0x4B4F4D41);
    let mut amounts: Vec<U256> = (0..=40u128).map(u).collect();
    amounts.extend([
        u(63), u(64), u(99), u(100), u(101), u(255), u(256), u(257), u(511), u(512), u(1_023), u(1_024),
        u(9_999), u(10_000), u(10_001), u(10_000_000), u(250_000), u(50_000_000), u(1_000_000_000_000),
        U256::MAX / u(4_000) - u(1), U256::MAX / u(4_000),
    ]);
    for _ in 0..120 {
        amounts.push(rng.amount().min(U256::MAX / u(4_000)));
    }
    let mut cases = Vec::new();
    for a in &amounts {
        for depth in 0..=10usize {
            let sp = split::split(*a, depth).unwrap();
            let anc: Vec<String> = sp.ancestors.iter().map(|x| s(*x)).collect();
            cases.push(format!(
                "{{\"amount\":{},\"ancestors\":[{}],\"character\":{},\"depth\":{},\"treasury\":{}}}",
                s(*a), anc.join(","), s(sp.character), depth, s(sp.treasury)
            ));
        }
    }
    format!(
        "{{\n  \"description\": \"KOMA IRoyaltyRouter.route split vectors. All integers are decimal strings except depth. depth = number of registered ancestors above the routed series (0 = root); only the nearest 8 are paid, so ancestors[] has min(depth, 8) entries, ancestors[0] = parent (kind 1). character (kind 0) includes the unpaid remix-pool remainder and dust; treasury is kind 2. character + treasury + sum(ancestors) == amount. On-chain, zero-amount legs are skipped (no transfer, no Routed event). Payment order: ancestors nearest-first, character, treasury. amount > (2^256-1)/4000 reverts (amount*4000 overflows). Split: character 40% / remix pool 20% / treasury 40% (bps 4000/2000/4000).\",\n  \"generator\": \"stylus/royalty-router/src/tests.rs::router_vectors (KOMA_WRITE_VECTORS=1 cargo test -p royalty-router router_vectors)\",\n  \"count\": {},\n  \"overflowAmount\": {},\n  \"cases\": [\n    {}\n  ]\n}}\n",
        cases.len(),
        s(U256::MAX / u(4_000) + u(1)),
        cases.join(",\n    ")
    )
}

#[test]
fn router_vectors() {
    let json = generate_router_vectors();
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../test-vectors/router.json");
    if std::env::var("KOMA_WRITE_VECTORS").is_ok() {
        std::fs::write(path, &json).unwrap();
    } else {
        let committed = std::fs::read_to_string(path)
            .expect("test-vectors/router.json missing: run with KOMA_WRITE_VECTORS=1");
        assert!(committed == json, "router.json is stale: rerun with KOMA_WRITE_VECTORS=1");
    }
}
