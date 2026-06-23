#![no_std]
//! Liquidity / financing pool contract.
//!
//! Investors (liquidity providers) deposit settlement tokens into the pool.
//! The pool advances discounted working capital against harvest invoices: a
//! farmer is credited `face_value - discount` up front, and the pool keeps the
//! discount as yield once the invoice settles.
//!
//! Balances are tracked as internal ledger claims rather than moving an
//! external token, keeping the financing logic self-contained and unit
//! testable. A production deployment would settle these claims through a
//! SEP-41 token contract in the settlement layer.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env,
};

/// Record of capital advanced against a single invoice.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Funding {
    pub invoice_id: u64,
    /// Full invoice face value.
    pub face_value: i128,
    /// Amount actually advanced to the recipient (face value minus discount).
    pub advance: i128,
    /// Address credited with the advance (typically the invoice owner).
    pub recipient: Address,
}

/// Emitted when an LP deposits liquidity.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deposited {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// Emitted when a claim is withdrawn.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawn {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// Emitted when an invoice is funded.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Funded {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub invoice_id: u64,
    pub face_value: i128,
    pub advance: i128,
}

#[contracttype]
enum DataKey {
    Admin,
    /// Discount applied on funding, in basis points (1/100th of a percent).
    DiscountBps,
    /// Un-deployed liquidity currently held by the pool.
    Available,
    /// Withdrawable claim for an address (LP capital + advanced funds).
    Balance(Address),
    /// Funding record keyed by invoice id.
    Funding(u64),
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidDiscount = 4,
    InsufficientBalance = 5,
    InsufficientLiquidity = 6,
    AlreadyFunded = 7,
    FundingNotFound = 8,
}

const BPS_DENOMINATOR: i128 = 10_000;

#[contract]
pub struct FinancingPoolContract;

#[contractimpl]
impl FinancingPoolContract {
    /// One-time initialization.
    ///
    /// `discount_bps` is the funding discount in basis points and must be
    /// strictly less than 10_000 (100%).
    pub fn initialize(env: Env, admin: Address, discount_bps: u32) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if discount_bps as i128 >= BPS_DENOMINATOR {
            return Err(Error::InvalidDiscount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::DiscountBps, &discount_bps);
        env.storage().instance().set(&DataKey::Available, &0i128);
        Ok(())
    }

    /// Deposit liquidity into the pool. Requires `from` authorization.
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance = Self::balance_inner(&env, &from) + amount;
        Self::set_balance(&env, &from, balance);
        Self::set_available(&env, Self::available_inner(&env) + amount);

        Deposited { from, amount }.publish(&env);
        Ok(())
    }

    /// Withdraw a withdrawable claim. Requires `to` authorization.
    ///
    /// Fails if the caller's claim is too small, or if the pool's un-deployed
    /// liquidity is insufficient (capital locked in active fundings).
    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        to.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance = Self::balance_inner(&env, &to);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        let available = Self::available_inner(&env);
        if available < amount {
            return Err(Error::InsufficientLiquidity);
        }

        Self::set_balance(&env, &to, balance - amount);
        Self::set_available(&env, available - amount);

        Withdrawn { to, amount }.publish(&env);
        Ok(())
    }

    /// Advance discounted capital against an invoice. Admin-only.
    ///
    /// Credits `recipient` with `face_value - discount` and records the
    /// funding. Rejects zero/negative face values, invoices already funded,
    /// and requests that exceed available liquidity. Returns the advance.
    pub fn fund_invoice(
        env: Env,
        invoice_id: u64,
        face_value: i128,
        recipient: Address,
    ) -> Result<i128, Error> {
        let admin = Self::admin_inner(&env)?;
        admin.require_auth();

        if face_value <= 0 {
            return Err(Error::InvalidAmount);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Funding(invoice_id))
        {
            return Err(Error::AlreadyFunded);
        }

        let advance = Self::advance_for(&env, face_value);
        let available = Self::available_inner(&env);
        if available < advance {
            return Err(Error::InsufficientLiquidity);
        }

        Self::set_available(&env, available - advance);
        let recipient_balance = Self::balance_inner(&env, &recipient) + advance;
        Self::set_balance(&env, &recipient, recipient_balance);

        let funding = Funding {
            invoice_id,
            face_value,
            advance,
            recipient: recipient.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Funding(invoice_id), &funding);

        Funded {
            recipient,
            invoice_id,
            face_value,
            advance,
        }
        .publish(&env);
        Ok(advance)
    }

    // ---- read-only views -------------------------------------------------

    /// Quote the advance payable for a given face value at the current
    /// discount, without funding anything.
    pub fn quote(env: Env, face_value: i128) -> Result<i128, Error> {
        if face_value <= 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(Self::advance_for(&env, face_value))
    }

    /// Discount (in tokens) that would be retained on a given face value.
    pub fn discount_amount(env: Env, face_value: i128) -> Result<i128, Error> {
        if face_value <= 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(face_value - Self::advance_for(&env, face_value))
    }

    pub fn balance_of(env: Env, addr: Address) -> i128 {
        Self::balance_inner(&env, &addr)
    }

    pub fn available_liquidity(env: Env) -> i128 {
        Self::available_inner(&env)
    }

    pub fn discount_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DiscountBps)
            .unwrap_or(0)
    }

    pub fn get_funding(env: Env, invoice_id: u64) -> Result<Funding, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Funding(invoice_id))
            .ok_or(Error::FundingNotFound)
    }

    pub fn is_funded(env: Env, invoice_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Funding(invoice_id))
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        Self::admin_inner(&env)
    }

    // ---- internals -------------------------------------------------------

    fn advance_for(env: &Env, face_value: i128) -> i128 {
        let bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DiscountBps)
            .unwrap_or(0);
        // Floor division: any rounding loss is retained by the pool as extra
        // discount, never over-advanced to the recipient.
        face_value * (BPS_DENOMINATOR - bps as i128) / BPS_DENOMINATOR
    }

    fn balance_inner(env: &Env, addr: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr.clone()))
            .unwrap_or(0)
    }

    fn set_balance(env: &Env, addr: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(addr.clone()), &amount);
    }

    fn available_inner(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Available)
            .unwrap_or(0)
    }

    fn set_available(env: &Env, amount: i128) {
        env.storage().instance().set(&DataKey::Available, &amount);
    }

    fn admin_inner(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn require_initialized(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            Ok(())
        } else {
            Err(Error::NotInitialized)
        }
    }
}

#[cfg(test)]
mod test;
