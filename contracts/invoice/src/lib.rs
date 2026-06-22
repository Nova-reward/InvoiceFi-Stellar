#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
};

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum InvoiceStatus {
    Draft,
    Submitted,
    Funded,
    Repaid,
    Defaulted,
}

#[contracttype]
#[derive(Clone)]
pub struct Invoice {
    pub owner: Address,
    pub amount: i128,
    pub description: String,
    pub status: InvoiceStatus,
}

#[contracttype]
pub enum DataKey {
    Invoice(u64),
    NextId,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum ContractError {
    NotFound = 1,
    Unauthorized = 2,
    InvalidTransition = 3,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct InvoiceContract;

#[contractimpl]
impl InvoiceContract {
    /// Create a new invoice in Draft status. Returns the new invoice ID.
    pub fn create(env: Env, owner: Address, amount: i128, description: String) -> u64 {
        owner.require_auth();

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::Invoice(id),
            &Invoice {
                owner: owner.clone(),
                amount,
                description,
                status: InvoiceStatus::Draft,
            },
        );
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("invoice"), symbol_short!("created")),
            (id, owner),
        );
        id
    }

    /// Draft → Submitted (owner only)
    pub fn submit(env: Env, caller: Address, id: u64) {
        caller.require_auth();
        let mut inv = Self::load(&env, id);
        Self::check_owner(&env, &inv, &caller);
        Self::check_state(&env, &inv, &InvoiceStatus::Draft);

        inv.status = InvoiceStatus::Submitted;
        env.storage().persistent().set(&DataKey::Invoice(id), &inv);
        env.events()
            .publish((symbol_short!("invoice"), symbol_short!("submitted")), id);
    }

    /// Submitted → Funded (any authenticated funder)
    pub fn fund(env: Env, funder: Address, id: u64) {
        funder.require_auth();
        let mut inv = Self::load(&env, id);
        Self::check_state(&env, &inv, &InvoiceStatus::Submitted);

        inv.status = InvoiceStatus::Funded;
        env.storage().persistent().set(&DataKey::Invoice(id), &inv);
        env.events().publish(
            (symbol_short!("invoice"), symbol_short!("funded")),
            (id, funder),
        );
    }

    /// Funded → Repaid (owner only)
    pub fn repay(env: Env, caller: Address, id: u64) {
        caller.require_auth();
        let mut inv = Self::load(&env, id);
        Self::check_owner(&env, &inv, &caller);
        Self::check_state(&env, &inv, &InvoiceStatus::Funded);

        inv.status = InvoiceStatus::Repaid;
        env.storage().persistent().set(&DataKey::Invoice(id), &inv);
        env.events()
            .publish((symbol_short!("invoice"), symbol_short!("repaid")), id);
    }

    /// Funded → Defaulted (owner only)
    pub fn default(env: Env, caller: Address, id: u64) {
        caller.require_auth();
        let mut inv = Self::load(&env, id);
        Self::check_owner(&env, &inv, &caller);
        Self::check_state(&env, &inv, &InvoiceStatus::Funded);

        inv.status = InvoiceStatus::Defaulted;
        env.storage().persistent().set(&DataKey::Invoice(id), &inv);
        env.events()
            .publish((symbol_short!("invoice"), symbol_short!("default")), id);
    }

    /// Return an invoice by ID.
    pub fn get(env: Env, id: u64) -> Invoice {
        Self::load(&env, id)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load(env: &Env, id: u64) -> Invoice {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(id))
            .unwrap_or_else(|| panic_with_error!(env, ContractError::NotFound))
    }

    fn check_owner(env: &Env, inv: &Invoice, caller: &Address) {
        if &inv.owner != caller {
            panic_with_error!(env, ContractError::Unauthorized);
        }
    }

    fn check_state(env: &Env, inv: &Invoice, expected: &InvoiceStatus) {
        if &inv.status != expected {
            panic_with_error!(env, ContractError::InvalidTransition);
        }
    }
}

#[cfg(test)]
mod test;
