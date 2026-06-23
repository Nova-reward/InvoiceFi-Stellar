#![no_std]
//! Harvest invoice tokenization contract.
//!
//! Each invoice represents a farmer's future crop yield minted as an on-chain
//! asset. The contract tracks ownership, face value, free-form metadata, and a
//! lifecycle state machine that the financing layer drives as an invoice is
//! funded and eventually settled.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
    Symbol,
};

/// Lifecycle states for an invoice.
///
/// Allowed transitions:
/// - `Pending  -> Funded`   (a financing pool advances working capital)
/// - `Pending  -> Defaulted`
/// - `Funded   -> Settled`  (the harvest yield repays the advance)
/// - `Funded   -> Defaulted`
///
/// `Settled` and `Defaulted` are terminal.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending = 0,
    Funded = 1,
    Settled = 2,
    Defaulted = 3,
}

/// On-chain record for a single tokenized invoice.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub id: u64,
    pub owner: Address,
    /// Face value of the invoice, denominated in the protocol's settlement
    /// token (stroops / smallest unit). Always strictly positive.
    pub amount: i128,
    /// Crop / commodity identifier, e.g. "MAIZE".
    pub crop: Symbol,
    /// Ledger timestamp by which the harvest is expected to settle.
    pub due_date: u64,
    /// Free-form metadata URI or descriptor (valuation docs, grading, etc.).
    pub metadata: String,
    pub status: Status,
}

/// Emitted when a new invoice is minted.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Minted {
    #[topic]
    pub owner: Address,
    pub invoice_id: u64,
    pub amount: i128,
}

/// Emitted when ownership of an invoice changes hands.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transferred {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub invoice_id: u64,
}

/// Emitted on any lifecycle status change.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusChanged {
    #[topic]
    pub invoice_id: u64,
    pub from: Status,
    pub to: Status,
}

#[contracttype]
enum DataKey {
    /// Contract administrator authorized to drive state transitions.
    Admin,
    /// Monotonic counter backing invoice id allocation.
    Counter,
    /// Invoice record keyed by id.
    Invoice(u64),
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvoiceNotFound = 3,
    InvalidAmount = 4,
    NotOwner = 5,
    InvalidTransition = 6,
    SameOwnerTransfer = 7,
}

const INVOICE_TTL_THRESHOLD: u32 = 17_280; // ~1 day of ledgers
const INVOICE_TTL_EXTEND: u32 = 120_960; // ~7 days of ledgers

#[contract]
pub struct InvoiceContract;

#[contractimpl]
impl InvoiceContract {
    /// One-time initialization. `admin` is the only address permitted to drive
    /// status transitions (funding, settlement, default).
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0u64);
        Ok(())
    }

    /// Mint a new invoice owned by `owner`. Returns the freshly allocated id.
    ///
    /// Requires `owner` authorization. `amount` must be strictly positive —
    /// zero-value invoices are rejected.
    pub fn mint(
        env: Env,
        owner: Address,
        amount: i128,
        crop: Symbol,
        due_date: u64,
        metadata: String,
    ) -> Result<u64, Error> {
        Self::require_initialized(&env)?;
        owner.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next = id + 1;
        env.storage().instance().set(&DataKey::Counter, &next);

        let invoice = Invoice {
            id: next,
            owner: owner.clone(),
            amount,
            crop,
            due_date,
            metadata,
            status: Status::Pending,
        };
        Self::save(&env, &invoice);

        Minted {
            owner,
            invoice_id: next,
            amount,
        }
        .publish(&env);
        Ok(next)
    }

    /// Transfer ownership of `invoice_id` from `from` to `to`.
    ///
    /// Requires `from` authorization and that `from` is the current owner.
    pub fn transfer(env: Env, from: Address, to: Address, invoice_id: u64) -> Result<(), Error> {
        from.require_auth();

        let mut invoice = Self::load(&env, invoice_id)?;
        if invoice.owner != from {
            return Err(Error::NotOwner);
        }
        if from == to {
            return Err(Error::SameOwnerTransfer);
        }

        invoice.owner = to.clone();
        Self::save(&env, &invoice);

        Transferred {
            from,
            to,
            invoice_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Drive an invoice through its lifecycle. Admin-only.
    ///
    /// Rejects any transition not permitted by [`Status`].
    pub fn update_status(env: Env, invoice_id: u64, new_status: Status) -> Result<(), Error> {
        let admin = Self::admin_inner(&env)?;
        admin.require_auth();

        let mut invoice = Self::load(&env, invoice_id)?;
        if !Self::transition_allowed(invoice.status, new_status) {
            return Err(Error::InvalidTransition);
        }

        let old = invoice.status;
        invoice.status = new_status;
        Self::save(&env, &invoice);

        StatusChanged {
            invoice_id,
            from: old,
            to: new_status,
        }
        .publish(&env);
        Ok(())
    }

    // ---- read-only views -------------------------------------------------

    /// Retrieve the full invoice record (metadata, owner, status, …).
    pub fn get_invoice(env: Env, invoice_id: u64) -> Result<Invoice, Error> {
        Self::load(&env, invoice_id)
    }

    /// Current owner of an invoice.
    pub fn owner_of(env: Env, invoice_id: u64) -> Result<Address, Error> {
        Ok(Self::load(&env, invoice_id)?.owner)
    }

    /// Current lifecycle status of an invoice.
    pub fn status_of(env: Env, invoice_id: u64) -> Result<Status, Error> {
        Ok(Self::load(&env, invoice_id)?.status)
    }

    /// Total number of invoices ever minted (also the highest allocated id).
    pub fn total_minted(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    /// Whether an invoice with `invoice_id` exists.
    pub fn exists(env: Env, invoice_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Invoice(invoice_id))
    }

    /// The configured administrator.
    pub fn admin(env: Env) -> Result<Address, Error> {
        Self::admin_inner(&env)
    }

    // ---- internals -------------------------------------------------------

    fn transition_allowed(from: Status, to: Status) -> bool {
        matches!(
            (from, to),
            (Status::Pending, Status::Funded)
                | (Status::Pending, Status::Defaulted)
                | (Status::Funded, Status::Settled)
                | (Status::Funded, Status::Defaulted)
        )
    }

    fn save(env: &Env, invoice: &Invoice) {
        let key = DataKey::Invoice(invoice.id);
        env.storage().persistent().set(&key, invoice);
        env.storage()
            .persistent()
            .extend_ttl(&key, INVOICE_TTL_THRESHOLD, INVOICE_TTL_EXTEND);
    }

    fn load(env: &Env, invoice_id: u64) -> Result<Invoice, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .ok_or(Error::InvoiceNotFound)
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
