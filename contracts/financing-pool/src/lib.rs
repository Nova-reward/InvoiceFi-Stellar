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
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

// NOTE: `error.rs` is a pre-existing, unused scaffold left over from an
// earlier iteration of this contract (it doesn't match this API, and its own
// `mod tests;` doesn't resolve) — intentionally not wired in via `mod error;`.
mod types;

use crate::types::{TokenContract, ReentrancyGuard, StorageKey};
use access_control::{AccessControl, Role, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS};

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
    /// Pre-existing bug fix: this variant was referenced by `deposit`/
    /// `withdraw`'s reentrancy guard but was never actually defined.
    ReentrancyDetected = 9,
    /// Caller does not hold the role (or admin-signer superuser status)
    /// required for this operation.
    Unauthorized = 10,
    /// Caller is not a current member of the admin signer set.
    NotASigner = 11,
    InvalidThreshold = 12,
    DuplicateSigner = 13,
    InvalidTimelock = 14,
    ContractPaused = 15,
    AlreadyPaused = 16,
    NotPaused = 17,
    NoPendingTransfer = 18,
    AlreadyConfirmed = 19,
    ThresholdNotMet = 20,
    TimelockNotElapsed = 21,
    CannotGrantAdminRole = 22,
}

impl From<access_control::AcError> for Error {
    fn from(e: access_control::AcError) -> Self {
        use access_control::AcError;
        match e {
            AcError::AlreadyInitialized => Error::AlreadyInitialized,
            AcError::NotInitialized => Error::NotInitialized,
            AcError::Unauthorized => Error::Unauthorized,
            AcError::NotASigner => Error::NotASigner,
            AcError::InvalidThreshold => Error::InvalidThreshold,
            AcError::DuplicateSigner => Error::DuplicateSigner,
            AcError::InvalidTimelock => Error::InvalidTimelock,
            AcError::ContractPaused => Error::ContractPaused,
            AcError::AlreadyPaused => Error::AlreadyPaused,
            AcError::NotPaused => Error::NotPaused,
            AcError::NoPendingTransfer => Error::NoPendingTransfer,
            AcError::AlreadyConfirmed => Error::AlreadyConfirmed,
            AcError::ThresholdNotMet => Error::ThresholdNotMet,
            AcError::TimelockNotElapsed => Error::TimelockNotElapsed,
            AcError::CannotGrantAdminRole => Error::CannotGrantAdminRole,
        }
    }
}

const BPS_DENOMINATOR: i128 = 10_000;

#[contract]
pub struct FinancingPoolContract;

#[contractimpl]
impl FinancingPoolContract {
    /// One-time initialization. `signers`/`threshold` define the n-of-m admin
    /// signer set; `timelock_ledgers` gates signer-set changes (minimum
    /// [`access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS`]).
    ///
    /// `discount_bps` is the funding discount in basis points and must be
    /// strictly less than 10_000 (100%).
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock_ledgers: u32,
        discount_bps: u32,
    ) -> Result<(), Error> {
        if discount_bps as i128 >= BPS_DENOMINATOR {
            return Err(Error::InvalidDiscount);
        }
        AccessControl::initialize(&env, signers, threshold, timelock_ledgers)?;
        env.storage()
            .instance()
            .set(&DataKey::DiscountBps, &discount_bps);
        env.storage().instance().set(&DataKey::Available, &0i128);
        // Initialize reentrancy guard as unlocked
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Unlocked);
        Ok(())
    }

    /// Deposit liquidity into the pool. Requires `from` authorization.
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_not_paused(&env)?;
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // SAFETY: Reentrancy guard check before any state changes
        let guard: ReentrancyGuard = env
            .storage()
            .instance()
            .get(&StorageKey::reentrancy_guard())
            .unwrap_or(ReentrancyGuard::Unlocked);
        if guard == ReentrancyGuard::Locked {
            return Err(Error::ReentrancyDetected);
        }

        // CHECKS-EFFECTS-INTERACTIONS: Update state before external calls
        let balance = Self::balance_inner(&env, &from) + amount;
        Self::set_balance(&env, &from, balance);
        Self::set_available(&env, Self::available_inner(&env) + amount);

        // SAFETY: Set reentrancy guard before token transfer
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);

        // SAFETY: Cross-contract call to token contract (XLM)
        // Risk: Token contract could re-enter this contract
        // Mitigation: Reentrancy guard is active, state already updated
        // Call ordering: State updated before this call (checks-effects-interactions)
        if let Some(token_address) = env.storage().instance().get(&StorageKey::token_address(&TokenContract::XLM)) {
            // Note: In production, this would use soroban_sdk::invoke_contract to transfer tokens
            // For now, we emit an event that the backend can use to orchestrate
            env.events().publish(
                (Symbol::new(&env, "pool"), Symbol::new(&env, "token_transfer_in")),
                (from.clone(), token_address, amount, TokenContract::XLM.to_symbol()),
            );
        } else {
            // Fallback: emit event without actual transfer for now
            env.events().publish(
                (Symbol::new(&env, "pool"), Symbol::new(&env, "deposit_pending_token")),
                (from, amount),
            );
        }

        // SAFETY: Release reentrancy guard after token transfer
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Unlocked);

        Deposited { from, amount }.publish(&env);
        Ok(())
    }

    /// Withdraw a withdrawable claim. Requires `to` authorization.
    ///
    /// Fails if the caller's claim is too small, or if the pool's un-deployed
    /// liquidity is insufficient (capital locked in active fundings).
    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_not_paused(&env)?;
        to.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // SAFETY: Reentrancy guard check before any state changes
        let guard: ReentrancyGuard = env
            .storage()
            .instance()
            .get(&StorageKey::reentrancy_guard())
            .unwrap_or(ReentrancyGuard::Unlocked);
        if guard == ReentrancyGuard::Locked {
            return Err(Error::ReentrancyDetected);
        }

        let balance = Self::balance_inner(&env, &to);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        let available = Self::available_inner(&env);
        if available < amount {
            return Err(Error::InsufficientLiquidity);
        }

        // CHECKS-EFFECTS-INTERACTIONS: Update state before external calls
        Self::set_balance(&env, &to, balance - amount);
        Self::set_available(&env, available - amount);

        // SAFETY: Set reentrancy guard before token transfer
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);

        // SAFETY: Cross-contract call to token contract (XLM)
        // Risk: Token contract could re-enter this contract
        // Mitigation: Reentrancy guard is active, state already updated
        // Call ordering: State updated before this call (checks-effects-interactions)
        if let Some(token_address) = env.storage().instance().get(&StorageKey::token_address(&TokenContract::XLM)) {
            // Note: In production, this would use soroban_sdk::invoke_contract to transfer tokens
            // For now, we emit an event that the backend can use to orchestrate
            env.events().publish(
                (Symbol::new(&env, "pool"), Symbol::new(&env, "token_transfer_out")),
                (to.clone(), token_address, amount, TokenContract::XLM.to_symbol()),
            );
        } else {
            // Fallback: emit event without actual transfer for now
            env.events().publish(
                (Symbol::new(&env, "pool"), Symbol::new(&env, "withdraw_pending_token")),
                (to, amount),
            );
        }

        // SAFETY: Release reentrancy guard after token transfer
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Unlocked);

        Withdrawn { to, amount }.publish(&env);
        Ok(())
    }

    /// Advance discounted capital against an invoice. Requires `caller` to
    /// hold the `LiquidityManager` role (or be an admin signer).
    ///
    /// Credits `recipient` with `face_value - discount` and records the
    /// funding. Rejects zero/negative face values, invoices already funded,
    /// and requests that exceed available liquidity. Returns the advance.
    pub fn fund_invoice(
        env: Env,
        caller: Address,
        invoice_id: u64,
        face_value: i128,
        recipient: Address,
    ) -> Result<i128, Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_role(&env, Role::LiquidityManager, &caller)?;
        AccessControl::require_not_paused(&env)?;

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

    /// Set token contract address for a specific token (XLM, USDC, AQUA).
    /// Requires `caller` to be a current admin signer.
    pub fn set_token_address(
        env: Env,
        caller: Address,
        token: TokenContract,
        address: Address,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&StorageKey::token_address(&token), &address);
        env.events().publish(
            (Symbol::new(&env, "pool"), Symbol::new(&env, "token_address_set")),
            (token.to_symbol(), address),
        );
        Ok(())
    }

    /// Get token contract address for a specific token.
    pub fn get_token_address(env: Env, token: TokenContract) -> Option<Address> {
        env.storage()
            .instance()
            .get(&StorageKey::token_address(&token))
    }

    // ---- access control ---------------------------------------------------

    /// The current admin signer set and threshold.
    pub fn multisig(env: Env) -> Result<access_control::MultisigConfig, Error> {
        Ok(AccessControl::multisig(&env)?)
    }

    /// Whether `addr` is a current admin signer.
    pub fn is_signer(env: Env, addr: Address) -> bool {
        AccessControl::is_signer(&env, &addr)
    }

    /// Whether `addr` holds `role` (admin signers hold every role).
    pub fn has_role(env: Env, role: Role, addr: Address) -> bool {
        AccessControl::has_role(&env, role, &addr)
    }

    /// Whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        AccessControl::is_paused(&env)
    }

    /// Grant `role` to `grantee`. Requires an admin signer.
    pub fn grant_role(env: Env, caller: Address, role: Role, grantee: Address) -> Result<(), Error> {
        Ok(AccessControl::grant_role(&env, &caller, role, grantee)?)
    }

    /// Revoke `role` from `grantee`. Requires an admin signer.
    pub fn revoke_role(env: Env, caller: Address, role: Role, grantee: Address) -> Result<(), Error> {
        Ok(AccessControl::revoke_role(&env, &caller, role, grantee)?)
    }

    /// Pause the contract, blocking deposit/withdraw/fund_invoice. Requires
    /// the `Pauser` role (or an admin signer).
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        Ok(AccessControl::pause(&env, &caller)?)
    }

    /// Unpause the contract. Requires the `Pauser` role (or an admin signer).
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        Ok(AccessControl::unpause(&env, &caller)?)
    }

    /// Propose a new admin signer set / threshold. Only a current signer may
    /// propose; the proposer's confirmation is recorded automatically.
    pub fn propose_admin_transfer(
        env: Env,
        caller: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), Error> {
        Ok(AccessControl::propose_admin_transfer(
            &env,
            &caller,
            new_signers,
            new_threshold,
        )?)
    }

    /// Add `caller`'s confirmation to the pending admin transfer.
    pub fn confirm_admin_transfer(env: Env, caller: Address) -> Result<(), Error> {
        Ok(AccessControl::confirm_admin_transfer(&env, &caller)?)
    }

    /// Execute the pending admin transfer once it has reached threshold and
    /// the time-lock has elapsed.
    pub fn execute_admin_transfer(env: Env, caller: Address) -> Result<(), Error> {
        Ok(AccessControl::execute_admin_transfer(&env, &caller)?)
    }

    /// Withdraw the pending admin transfer without executing it.
    pub fn cancel_admin_transfer(env: Env, caller: Address) -> Result<(), Error> {
        Ok(AccessControl::cancel_admin_transfer(&env, &caller)?)
    }

    /// The pending admin transfer proposal, if any.
    pub fn pending_admin_transfer(env: Env) -> Option<access_control::PendingAdminTransfer> {
        AccessControl::pending_admin_transfer(&env)
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

    fn require_initialized(env: &Env) -> Result<(), Error> {
        AccessControl::multisig(env)?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod reentrancy_tests;
