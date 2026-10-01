//! KOMA launchpad `IRoyaltyRouter` on Arbitrum Stylus.
//!
//! Every curve sends its 1.5% trading fee here (`usdc.transfer(router, fee)`
//! then `router.route(seriesId, fee)`). The router pushes it out immediately:
//! 40% to the series' character TBA, 40% to the treasury and a 20% remix pool
//! that walks up the remix tree (parent gets pool/2, grandparent pool/4, ...,
//! at most 8 levels). Whatever the ancestors don't take (plus rounding dust)
//! goes to the character, so exactly `amount` is paid out.
//!
//! Payment order inside `route`: ancestors (nearest first, kind 1), then the
//! character (kind 0), then the treasury (kind 2). Zero-amount legs are
//! skipped (no transfer, no `Routed` event). Behaviour, checks order and
//! revert data mirror `contracts/src/RoyaltyRouterReference.sol`.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![allow(non_snake_case)]
extern crate alloc;

pub mod split;

use alloc::vec::Vec;
use alloy_sol_types::{SolError, SolEvent, sol};
use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
    storage::{StorageAddress, StorageMap, StorageU256},
};

sol_interface! {
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
    }
}

sol! {
    event Routed(uint256 indexed seriesId, address indexed recipient, uint256 amount, uint8 kind);
    event SeriesRegistered(uint256 indexed seriesId, address curve, address characterAccount, uint256 parentSeriesId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Same errors as contracts/src/RoyaltyRouterReference.sol so revert data
    // is byte-identical in differential tests.
    error AlreadyInitialized();
    error Unauthorized(address caller);
    error ZeroAddress();
    error SeriesExists(uint256 seriesId);
    error UnknownSeries(uint256 seriesId);
    // OpenZeppelin SafeERC20's error, used when `transfer` returns false or
    // returns something that is not a bool.
    error SafeERC20FailedOperation(address token);
}

/// `Routed.kind`
pub const KIND_CHARACTER: u8 = 0;
pub const KIND_ANCESTOR: u8 = 1;
pub const KIND_TREASURY: u8 = 2;

// Errors are returned as raw ABI-encoded bytes (not a `SolidityError` enum)
// so they stay out of the exported ABI, which must equal the spec's
// `IRoyaltyRouter`. Hand-encoded to avoid one generic encoder per error type.

#[inline(never)]
fn revert_word(selector: [u8; 4], word: [u8; 32]) -> Vec<u8> {
    let mut v = Vec::with_capacity(36);
    v.extend_from_slice(&selector);
    v.extend_from_slice(&word);
    v
}

fn addr_word(a: Address) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a.as_slice());
    w
}

fn unauthorized(caller: Address) -> Vec<u8> {
    revert_word(Unauthorized::SELECTOR, addr_word(caller))
}

fn transfer_failed(token: Address) -> Vec<u8> {
    revert_word(SafeERC20FailedOperation::SELECTOR, addr_word(token))
}

/// Solidity 0.8 arithmetic-overflow panic, `Panic(0x11)`.
fn panic_overflow() -> Vec<u8> {
    let mut w = [0u8; 32];
    w[31] = 0x11;
    revert_word([0x4e, 0x48, 0x7b, 0x71], w)
}

#[storage]
pub struct SeriesInfo {
    curve: StorageAddress,
    account: StorageAddress,
    parent: StorageU256,
}

#[storage]
#[entrypoint]
pub struct RoyaltyRouter {
    /// Account allowed to call `initialize` (tx.origin of the deployment).
    deployer: StorageAddress,
    usdc_token: StorageAddress,
    treasury_addr: StorageAddress,
    owner_addr: StorageAddress,
    factory_addr: StorageAddress,
    series: StorageMap<U256, SeriesInfo>,
    earned_total: StorageMap<Address, StorageU256>,
}

impl RoyaltyRouter {
    /// `earned[to] += amount; usdc.transfer(to, amount); emit Routed(...)`.
    /// Reverts (bubbling the token's revert data) if the call reverts, and
    /// with `SafeERC20FailedOperation(usdc)` if it returns false / no bool.
    fn pay(&mut self, seriesId: U256, to: Address, amount: U256, kind: u8) -> Result<(), Vec<u8>> {
        if amount.is_zero() {
            return Ok(());
        }
        let mut e = self.earned_total.setter(to);
        let prev = e.get();
        e.set(prev + amount); // bounded by the token's total supply

        let usdc = self.usdc_token.get();
        let token = IERC20::new(usdc);
        let cfg = Call::new_mutating(self);
        match token.transfer(self.vm(), cfg, to, amount) {
            Ok(true) => {}
            Ok(false) | Err(stylus_sdk::stylus_core::calls::errors::Error::AbiDecodingFailed(_)) => return Err(transfer_failed(usdc)),
            Err(stylus_sdk::stylus_core::calls::errors::Error::Revert(data)) => return Err(data),
        }

        // LOG3(Routed, seriesId, recipient | amount, kind). Hand-encoded:
        // `vm().log()` pulls alloy's generic encoder plus a Debug-formatted
        // unwrap into the WASM. Layout is asserted against alloy in tests.
        let mut buf = [0u8; 32 * 5];
        buf[..32].copy_from_slice(Routed::SIGNATURE_HASH.as_slice());
        buf[32..64].copy_from_slice(&seriesId.to_be_bytes::<32>());
        buf[76..96].copy_from_slice(to.as_slice());
        buf[96..128].copy_from_slice(&amount.to_be_bytes::<32>());
        buf[159] = kind;
        self.vm().emit_log(&buf, 3);
        Ok(())
    }

    /// `owner = new_owner; emit OwnershipTransferred(previous, new_owner)` (LOG3, no data).
    fn set_owner(&mut self, previous: Address, new_owner: Address) {
        self.owner_addr.set(new_owner);
        let mut buf = [0u8; 32 * 3];
        buf[..32].copy_from_slice(OwnershipTransferred::SIGNATURE_HASH.as_slice());
        buf[44..64].copy_from_slice(previous.as_slice());
        buf[76..96].copy_from_slice(new_owner.as_slice());
        self.vm().emit_log(&buf, 3);
    }
}

#[public]
impl RoyaltyRouter {
    /// Records the deploying EOA (tx.origin: under `cargo stylus deploy` the
    /// constructor runs inside the StylusDeployer, so msg.sender is that
    /// proxy). Only this account may call `initialize`, so the one-shot setup
    /// cannot be front-run -- same guard as the Solidity reference.
    #[constructor]
    pub fn constructor(&mut self) {
        let origin = self.vm().tx_origin();
        self.deployer.set(origin);
    }

    /// Once, by the deployer.
    pub fn initialize(&mut self, usdc: Address, treasury: Address, owner: Address) -> Result<(), Vec<u8>> {
        let sender = self.vm().msg_sender();
        if sender != self.deployer.get() {
            return Err(unauthorized(sender));
        }
        if !self.usdc_token.get().is_zero() {
            return Err(AlreadyInitialized::SELECTOR.to_vec());
        }
        if usdc.is_zero() || treasury.is_zero() || owner.is_zero() {
            return Err(ZeroAddress::SELECTOR.to_vec());
        }
        self.usdc_token.set(usdc);
        self.treasury_addr.set(treasury);
        self.set_owner(Address::ZERO, owner);
        Ok(())
    }

    /// Owner only, single step (`newOwner` must be able to send transactions,
    /// e.g. the admin Safe). Lets the deployer initialize, wire the factory and
    /// then hand the router to the admin.
    pub fn transfer_ownership(&mut self, newOwner: Address) -> Result<(), Vec<u8>> {
        let sender = self.vm().msg_sender();
        let owner = self.owner_addr.get();
        if sender != owner || owner.is_zero() {
            return Err(unauthorized(sender));
        }
        if newOwner.is_zero() {
            return Err(ZeroAddress::SELECTOR.to_vec());
        }
        self.set_owner(owner, newOwner);
        Ok(())
    }

    /// Owner only. May be called again to rotate the factory.
    pub fn set_factory(&mut self, factory: Address) -> Result<(), Vec<u8>> {
        let sender = self.vm().msg_sender();
        let owner = self.owner_addr.get();
        if sender != owner || owner.is_zero() {
            return Err(unauthorized(sender));
        }
        if factory.is_zero() {
            return Err(ZeroAddress::SELECTOR.to_vec());
        }
        self.factory_addr.set(factory);
        Ok(())
    }

    /// Factory only. `seriesId != 0` and not yet registered; `parentSeriesId`
    /// must be 0 or an already registered series.
    pub fn register_series(
        &mut self,
        seriesId: U256,
        curve: Address,
        characterAccount: Address,
        parentSeriesId: U256,
    ) -> Result<(), Vec<u8>> {
        let sender = self.vm().msg_sender();
        let factory = self.factory_addr.get();
        if sender != factory || factory.is_zero() {
            return Err(unauthorized(sender));
        }
        if curve.is_zero() || characterAccount.is_zero() {
            return Err(ZeroAddress::SELECTOR.to_vec());
        }
        if seriesId.is_zero() || !self.series.get(seriesId).curve.get().is_zero() {
            return Err(revert_word(SeriesExists::SELECTOR, seriesId.to_be_bytes::<32>()));
        }
        if !parentSeriesId.is_zero() && self.series.get(parentSeriesId).curve.get().is_zero() {
            return Err(revert_word(UnknownSeries::SELECTOR, parentSeriesId.to_be_bytes::<32>()));
        }
        let mut s = self.series.setter(seriesId);
        s.curve.set(curve);
        s.account.set(characterAccount);
        s.parent.set(parentSeriesId);
        // LOG2(SeriesRegistered, seriesId | curve, characterAccount, parentSeriesId)
        let mut buf = [0u8; 32 * 5];
        buf[..32].copy_from_slice(SeriesRegistered::SIGNATURE_HASH.as_slice());
        buf[32..64].copy_from_slice(&seriesId.to_be_bytes::<32>());
        buf[76..96].copy_from_slice(curve.as_slice());
        buf[108..128].copy_from_slice(characterAccount.as_slice());
        buf[128..160].copy_from_slice(&parentSeriesId.to_be_bytes::<32>());
        self.vm().emit_log(&buf, 2);
        Ok(())
    }

    /// Only `curveOf(seriesId)`. The curve has already transferred `amount`
    /// USDC to this contract.
    pub fn route(&mut self, seriesId: U256, amount: U256) -> Result<(), Vec<u8>> {
        let (curve, account, mut cursor) = {
            let s = self.series.get(seriesId);
            (s.curve.get(), s.account.get(), s.parent.get())
        };
        let sender = self.vm().msg_sender();
        if sender != curve || curve.is_zero() {
            return Err(unauthorized(sender));
        }
        let (character, treasury_cut, pool) = split::base_split(amount).ok_or_else(panic_overflow)?;

        let mut paid = U256::ZERO;
        let mut depth = 1usize;
        while !cursor.is_zero() && depth <= split::MAX_DEPTH {
            let (ancestor_account, next) = {
                let a = self.series.get(cursor);
                (a.account.get(), a.parent.get())
            };
            let share = split::ancestor_share(pool, depth);
            self.pay(seriesId, ancestor_account, share, KIND_ANCESTOR)?;
            paid += share;
            cursor = next;
            depth += 1;
        }
        self.pay(seriesId, account, character + (pool - paid), KIND_CHARACTER)?;
        let treasury = self.treasury_addr.get();
        self.pay(seriesId, treasury, treasury_cut, KIND_TREASURY)?;
        Ok(())
    }

    pub fn parent_of(&self, seriesId: U256) -> U256 {
        self.series.get(seriesId).parent.get()
    }

    pub fn account_of(&self, seriesId: U256) -> Address {
        self.series.get(seriesId).account.get()
    }

    pub fn curve_of(&self, seriesId: U256) -> Address {
        self.series.get(seriesId).curve.get()
    }

    /// Lifetime USDC routed to `recipient`.
    pub fn earned(&self, recipient: Address) -> U256 {
        self.earned_total.get(recipient)
    }

    pub fn treasury(&self) -> Address {
        self.treasury_addr.get()
    }

    pub fn usdc(&self) -> Address {
        self.usdc_token.get()
    }

    pub fn factory(&self) -> Address {
        self.factory_addr.get()
    }

    pub fn owner(&self) -> Address {
        self.owner_addr.get()
    }
}

#[cfg(test)]
mod tests;
