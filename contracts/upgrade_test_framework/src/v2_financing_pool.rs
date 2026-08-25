//! v2 test-double for the Financing Pool contract.
//!
//! Identical storage layout to v1.  Adds:
//! - `version() -> u32`  returns 2
//! - `upgrade(new_wasm: BytesN<32>)` (admin-only)

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Vec,
};

use access_control::{AccessControl, Role, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS};
use financing_pool_contract::types::{ReentrancyGuard, StorageKey, TokenContract};

// ── Replicate v1 types (identical XDR layout) ────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Funding {
    pub invoice_id: u64,
    pub face_value: i128,
    pub advance: i128,
    pub recipient: Address,
}

#[contracttype]
enum DataKey {
    DiscountBps,
    Available,
    Balance(Address),
    Funding(u64),
}

const BPS_DENOMINATOR: i128 = 10_000;

// ── v2 contract ───────────────────────────────────────────────────────────────

#[contract]
pub struct FinancingPoolContractV2;

#[contractimpl]
impl FinancingPoolContractV2 {
    // ── NEW in v2 ─────────────────────────────────────────────────────────────

    pub fn version(_env: Env) -> u32 {
        2
    }

    pub fn upgrade(env: Env, caller: Address, new_wasm: BytesN<32>) {
        caller.require_auth();
        AccessControl::require_admin(&env, &caller)
            .expect("upgrade: caller is not an admin signer");
        env.deployer().update_current_contract_wasm(new_wasm);
    }

    // ── Carried over from v1 ──────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock_ledgers: u32,
        discount_bps: u32,
    ) -> Result<(), financing_pool_contract::Error> {
        if discount_bps as i128 >= BPS_DENOMINATOR {
            return Err(financing_pool_contract::Error::InvalidDiscount);
        }
        AccessControl::initialize(&env, signers, threshold, timelock_ledgers)
            .map_err(financing_pool_contract::Error::from)?;
        env.storage()
            .instance()
            .set(&DataKey::DiscountBps, &discount_bps);
        env.storage().instance().set(&DataKey::Available, &0i128);
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Unlocked);
        Ok(())
    }

    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), financing_pool_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_not_paused(&env)
            .map_err(financing_pool_contract::Error::from)?;
        from.require_auth();
        if amount <= 0 {
            return Err(financing_pool_contract::Error::InvalidAmount);
        }
        let guard: ReentrancyGuard = env
            .storage()
            .instance()
            .get(&StorageKey::reentrancy_guard())
            .unwrap_or(ReentrancyGuard::Unlocked);
        if guard == ReentrancyGuard::Locked {
            return Err(financing_pool_contract::Error::ReentrancyDetected);
        }
        let balance = Self::balance_inner(&env, &from) + amount;
        Self::set_balance(&env, &from, balance);
        Self::set_available(&env, Self::available_inner(&env) + amount);
        Ok(())
    }

    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), financing_pool_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_not_paused(&env)
            .map_err(financing_pool_contract::Error::from)?;
        to.require_auth();
        if amount <= 0 {
            return Err(financing_pool_contract::Error::InvalidAmount);
        }
        let guard: ReentrancyGuard = env
            .storage()
            .instance()
            .get(&StorageKey::reentrancy_guard())
            .unwrap_or(ReentrancyGuard::Unlocked);
        if guard == ReentrancyGuard::Locked {
            return Err(financing_pool_contract::Error::ReentrancyDetected);
        }
        let balance = Self::balance_inner(&env, &to);
        if balance < amount {
            return Err(financing_pool_contract::Error::InsufficientBalance);
        }
        let available = Self::available_inner(&env);
        if available < amount {
            return Err(financing_pool_contract::Error::InsufficientLiquidity);
        }
        Self::set_balance(&env, &to, balance - amount);
        Self::set_available(&env, available - amount);
        Ok(())
    }

    pub fn fund_invoice(
        env: Env,
        caller: Address,
        invoice_id: u64,
        face_value: i128,
        recipient: Address,
    ) -> Result<i128, financing_pool_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_role(&env, Role::LiquidityManager, &caller)
            .map_err(financing_pool_contract::Error::from)?;
        AccessControl::require_not_paused(&env)
            .map_err(financing_pool_contract::Error::from)?;
        if face_value <= 0 {
            return Err(financing_pool_contract::Error::InvalidAmount);
        }
        if env.storage().persistent().has(&DataKey::Funding(invoice_id)) {
            return Err(financing_pool_contract::Error::AlreadyFunded);
        }
        let advance = Self::advance_for(&env, face_value);
        let available = Self::available_inner(&env);
        if available < advance {
            return Err(financing_pool_contract::Error::InsufficientLiquidity);
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
        Ok(advance)
    }

    // ── Read-only views ───────────────────────────────────────────────────────

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

    pub fn get_funding(env: Env, invoice_id: u64) -> Result<Funding, financing_pool_contract::Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Funding(invoice_id))
            .ok_or(financing_pool_contract::Error::FundingNotFound)
    }

    pub fn is_funded(env: Env, invoice_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Funding(invoice_id))
    }

    pub fn quote(env: Env, face_value: i128) -> Result<i128, financing_pool_contract::Error> {
        if face_value <= 0 {
            return Err(financing_pool_contract::Error::InvalidAmount);
        }
        Ok(Self::advance_for(&env, face_value))
    }

    pub fn is_signer(env: Env, addr: Address) -> bool {
        AccessControl::is_signer(&env, &addr)
    }

    pub fn has_role(env: Env, role: Role, addr: Address) -> bool {
        AccessControl::has_role(&env, role, &addr)
    }

    pub fn is_paused(env: Env) -> bool {
        AccessControl::is_paused(&env)
    }

    pub fn grant_role(
        env: Env,
        caller: Address,
        role: Role,
        grantee: Address,
    ) -> Result<(), financing_pool_contract::Error> {
        Ok(AccessControl::grant_role(&env, &caller, role, grantee)
            .map_err(financing_pool_contract::Error::from)?)
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), financing_pool_contract::Error> {
        Ok(AccessControl::pause(&env, &caller)
            .map_err(financing_pool_contract::Error::from)?)
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), financing_pool_contract::Error> {
        Ok(AccessControl::unpause(&env, &caller)
            .map_err(financing_pool_contract::Error::from)?)
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn advance_for(env: &Env, face_value: i128) -> i128 {
        let bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DiscountBps)
            .unwrap_or(0);
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

    fn require_initialized(env: &Env) -> Result<(), financing_pool_contract::Error> {
        AccessControl::multisig(env)
            .map(|_| ())
            .map_err(financing_pool_contract::Error::from)
    }
}
