//! v2 test-double for the Invoice contract.
//!
//! Identical storage layout to v1.  Adds:
//! - `version() -> u32`  returns 2
//! - `upgrade(new_wasm: BytesN<32>)` (admin-only) — calls
//!   `env.update_current_contract_wasm`
//!
//! This file is compiled as part of the `upgrade_test_framework` crate so it
//! is only ever loaded by tests, never deployed to production.

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, String, Symbol, Vec,
};

use access_control::{AccessControl, Role, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS};

// ── Replicate v1 types (identical XDR layout) ────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending  = 0,
    Funded   = 1,
    Settled  = 2,
    Defaulted = 3,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub id: u64,
    pub owner: Address,
    pub amount: i128,
    pub crop: Symbol,
    pub due_date: u64,
    pub metadata: String,
    pub status: Status,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvoiceToken {
    pub invoice_id: u64,
    pub face_value: i128,
    pub discount_rate: u32,
    pub due_date: u64,
}

#[contracttype]
enum DataKey {
    Counter,
    Invoice(u64),
    Token(u64),
    Approval(u64),
}

const MAX_DISCOUNT_BPS: u32 = 10_000;
const INVOICE_TTL_THRESHOLD: u32 = 17_280;
const INVOICE_TTL_EXTEND: u32 = 120_960;

// ── v2 contract ───────────────────────────────────────────────────────────────

#[contract]
pub struct InvoiceContractV2;

#[contractimpl]
impl InvoiceContractV2 {
    // ── NEW in v2 ─────────────────────────────────────────────────────────────

    /// Returns the contract version. Added in v2.
    pub fn version(_env: Env) -> u32 {
        2
    }

    /// Admin-only entry point that upgrades the running WASM to `new_wasm`.
    /// The caller must be a current admin signer.
    pub fn upgrade(env: Env, caller: Address, new_wasm: BytesN<32>) {
        caller.require_auth();
        AccessControl::require_admin(&env, &caller)
            .expect("upgrade: caller is not an admin signer");
        env.deployer().update_current_contract_wasm(new_wasm);
    }

    // ── Carried over from v1 (identical implementation) ───────────────────────

    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock_ledgers: u32,
    ) -> Result<(), invoice_contract::Error> {
        AccessControl::initialize(&env, signers, threshold, timelock_ledgers)
            .map_err(invoice_contract::Error::from)?;
        env.storage().instance().set(&DataKey::Counter, &0u64);
        Ok(())
    }

    pub fn mint(
        env: Env,
        owner: Address,
        amount: i128,
        crop: Symbol,
        due_date: u64,
        metadata: String,
    ) -> Result<u64, invoice_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        owner.require_auth();
        if amount <= 0 {
            return Err(invoice_contract::Error::InvalidAmount);
        }
        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next = id + 1;
        env.storage().instance().set(&DataKey::Counter, &next);
        let invoice = Invoice {
            id: next,
            owner,
            amount,
            crop,
            due_date,
            metadata,
            status: Status::Pending,
        };
        Self::save(&env, &invoice);
        Ok(next)
    }

    pub fn fund(
        env: Env,
        caller: Address,
        invoice_id: u64,
        discount_rate: u32,
    ) -> Result<(), invoice_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_role(&env, Role::LiquidityManager, &caller)
            .map_err(invoice_contract::Error::from)?;
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        if discount_rate >= MAX_DISCOUNT_BPS {
            return Err(invoice_contract::Error::InvalidDiscountRate);
        }
        let mut invoice = Self::load(&env, invoice_id)?;
        if invoice.status != Status::Pending {
            return Err(invoice_contract::Error::InvalidTransition);
        }
        invoice.status = Status::Funded;
        Self::save(&env, &invoice);
        let token = InvoiceToken {
            invoice_id,
            face_value: invoice.amount,
            discount_rate,
            due_date: invoice.due_date,
        };
        let key = DataKey::Token(invoice_id);
        env.storage().persistent().set(&key, &token);
        env.storage()
            .persistent()
            .extend_ttl(&key, INVOICE_TTL_THRESHOLD, INVOICE_TTL_EXTEND);
        Ok(())
    }

    pub fn update_status(
        env: Env,
        caller: Address,
        invoice_id: u64,
        new_status: Status,
    ) -> Result<(), invoice_contract::Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_admin(&env, &caller)
            .map_err(invoice_contract::Error::from)?;
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        let mut invoice = Self::load(&env, invoice_id)?;
        if !Self::transition_allowed(invoice.status, new_status) {
            return Err(invoice_contract::Error::InvalidTransition);
        }
        invoice.status = new_status;
        Self::save(&env, &invoice);
        Ok(())
    }

    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        invoice_id: u64,
    ) -> Result<(), invoice_contract::Error> {
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        from.require_auth();
        let invoice = Self::load(&env, invoice_id)?;
        if invoice.owner != from {
            return Err(invoice_contract::Error::NotOwner);
        }
        Self::do_transfer(&env, invoice, from, to, invoice_id)
    }

    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        invoice_id: u64,
    ) -> Result<(), invoice_contract::Error> {
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        owner.require_auth();
        let invoice = Self::load(&env, invoice_id)?;
        if !Self::is_tokenized_inner(&env, invoice_id) {
            return Err(invoice_contract::Error::NotTokenized);
        }
        if invoice.owner != owner {
            return Err(invoice_contract::Error::NotOwner);
        }
        let key = DataKey::Approval(invoice_id);
        env.storage().persistent().set(&key, &spender);
        env.storage()
            .persistent()
            .extend_ttl(&key, INVOICE_TTL_THRESHOLD, INVOICE_TTL_EXTEND);
        Ok(())
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        invoice_id: u64,
    ) -> Result<(), invoice_contract::Error> {
        AccessControl::require_not_paused(&env)
            .map_err(invoice_contract::Error::from)?;
        spender.require_auth();
        let invoice = Self::load(&env, invoice_id)?;
        if !Self::is_tokenized_inner(&env, invoice_id) {
            return Err(invoice_contract::Error::NotTokenized);
        }
        if invoice.owner != from {
            return Err(invoice_contract::Error::NotOwner);
        }
        let approved: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(invoice_id));
        match approved {
            Some(addr) if addr == spender => {}
            _ => return Err(invoice_contract::Error::NotApproved),
        }
        Self::do_transfer(&env, invoice, from, to, invoice_id)
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    pub fn get_invoice(env: Env, invoice_id: u64) -> Result<Invoice, invoice_contract::Error> {
        Self::load(&env, invoice_id)
    }

    pub fn owner_of(env: Env, invoice_id: u64) -> Result<Address, invoice_contract::Error> {
        Ok(Self::load(&env, invoice_id)?.owner)
    }

    pub fn status_of(env: Env, invoice_id: u64) -> Result<Status, invoice_contract::Error> {
        Ok(Self::load(&env, invoice_id)?.status)
    }

    pub fn get_invoice_token(env: Env, invoice_id: u64) -> Result<InvoiceToken, invoice_contract::Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Token(invoice_id))
            .ok_or(invoice_contract::Error::NotTokenized)
    }

    pub fn is_tokenized(env: Env, invoice_id: u64) -> bool {
        Self::is_tokenized_inner(&env, invoice_id)
    }

    pub fn get_approved(env: Env, invoice_id: u64) -> Result<Address, invoice_contract::Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Approval(invoice_id))
            .ok_or(invoice_contract::Error::NotApproved)
    }

    pub fn total_minted(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    pub fn exists(env: Env, invoice_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Invoice(invoice_id))
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

    pub fn grant_role(env: Env, caller: Address, role: Role, grantee: Address) -> Result<(), invoice_contract::Error> {
        Ok(AccessControl::grant_role(&env, &caller, role, grantee)
            .map_err(invoice_contract::Error::from)?)
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), invoice_contract::Error> {
        Ok(AccessControl::pause(&env, &caller)
            .map_err(invoice_contract::Error::from)?)
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), invoice_contract::Error> {
        Ok(AccessControl::unpause(&env, &caller)
            .map_err(invoice_contract::Error::from)?)
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn transition_allowed(from: Status, to: Status) -> bool {
        matches!(
            (from, to),
            (Status::Pending, Status::Defaulted)
                | (Status::Funded, Status::Settled)
                | (Status::Funded, Status::Defaulted)
        )
    }

    fn is_tokenized_inner(env: &Env, invoice_id: u64) -> bool {
        env.storage().persistent().has(&DataKey::Token(invoice_id))
    }

    fn do_transfer(
        env: &Env,
        mut invoice: Invoice,
        from: Address,
        to: Address,
        invoice_id: u64,
    ) -> Result<(), invoice_contract::Error> {
        if from == to {
            return Err(invoice_contract::Error::SameOwnerTransfer);
        }
        if invoice.status == Status::Settled {
            return Err(invoice_contract::Error::TransferAfterRepayment);
        }
        invoice.owner = to;
        Self::save(env, &invoice);
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(invoice_id));
        Ok(())
    }

    fn save(env: &Env, invoice: &Invoice) {
        let key = DataKey::Invoice(invoice.id);
        env.storage().persistent().set(&key, invoice);
        env.storage()
            .persistent()
            .extend_ttl(&key, INVOICE_TTL_THRESHOLD, INVOICE_TTL_EXTEND);
    }

    fn load(env: &Env, invoice_id: u64) -> Result<Invoice, invoice_contract::Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .ok_or(invoice_contract::Error::InvoiceNotFound)
    }

    fn require_initialized(env: &Env) -> Result<(), invoice_contract::Error> {
        AccessControl::multisig(env)
            .map(|_| ())
            .map_err(invoice_contract::Error::from)
    }
}
