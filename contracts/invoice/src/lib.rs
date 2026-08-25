#![no_std]
//! Harvest invoice tokenization contract.
//!
//! Each invoice represents a farmer's future crop yield minted as an on-chain
//! asset. The contract tracks ownership, face value, free-form metadata, and a
//! lifecycle state machine that the financing layer drives as an invoice is
//! funded and eventually settled.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
    Symbol, Vec,
};

use access_control::{
    AcError, AccessControl, MultisigConfig, PendingAdminTransfer, Role,
    MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
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

/// SEP-0041-style metadata for the ownership token minted against an invoice
/// when it is funded. Invoices are non-fungible — each token is unique to one
/// invoice — so this snapshots the economic terms of the repayment claim at
/// funding time.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvoiceToken {
    pub invoice_id: u64,
    /// Face value of the underlying invoice.
    pub face_value: i128,
    /// Discount applied at funding, in basis points.
    pub discount_rate: u32,
    /// Ledger timestamp by which the harvest is expected to settle.
    pub due_date: u64,
}

/// Emitted when an invoice is tokenized (its ownership token is minted on
/// funding).
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenMinted {
    #[topic]
    pub owner: Address,
    #[topic]
    pub invoice_id: u64,
    pub face_value: i128,
    pub discount_rate: u32,
}

/// Emitted when an owner approves a spender to transfer their invoice token.
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Approved {
    #[topic]
    pub owner: Address,
    #[topic]
    pub spender: Address,
    pub invoice_id: u64,
}

#[contracttype]
enum DataKey {
    /// Monotonic counter backing invoice id allocation.
    Counter,
    /// Invoice record keyed by id.
    Invoice(u64),
    /// Ownership token metadata, keyed by invoice id. Presence marks the
    /// invoice as tokenized.
    Token(u64),
    /// Address approved to transfer an invoice token on the owner's behalf,
    /// keyed by invoice id.
    Approval(u64),
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
    NotTokenized = 8,
    InvalidDiscountRate = 9,
    TransferAfterRepayment = 10,
    NotApproved = 11,
    /// Caller does not hold the role (or admin-signer superuser status)
    /// required for this operation.
    Unauthorized = 12,
    /// Caller is not a current member of the admin signer set.
    NotASigner = 13,
    InvalidThreshold = 14,
    DuplicateSigner = 15,
    InvalidTimelock = 16,
    ContractPaused = 17,
    AlreadyPaused = 18,
    NotPaused = 19,
    NoPendingTransfer = 20,
    AlreadyConfirmed = 21,
    ThresholdNotMet = 22,
    TimelockNotElapsed = 23,
    CannotGrantAdminRole = 24,
}

impl From<AcError> for Error {
    fn from(e: AcError) -> Self {
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

const MAX_DISCOUNT_BPS: u32 = 10_000;

const INVOICE_TTL_THRESHOLD: u32 = 17_280; // ~1 day of ledgers
const INVOICE_TTL_EXTEND: u32 = 120_960; // ~7 days of ledgers

#[contract]
pub struct InvoiceContract;

#[contractimpl]
impl InvoiceContract {
    /// One-time initialization. `signers`/`threshold` define the n-of-m admin
    /// signer set that drives status transitions (funding, settlement,
    /// default); `timelock_ledgers` gates how long a signer-set change must
    /// wait before it can execute (minimum
    /// [`access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS`]).
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock_ledgers: u32,
    ) -> Result<(), Error> {
        AccessControl::initialize(&env, signers, threshold, timelock_ledgers)?;
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
        AccessControl::require_not_paused(&env)?;
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

    /// Fund a pending invoice and mint its unique ownership token. Requires
    /// `caller` to hold the `LiquidityManager` role (or be an admin signer).
    ///
    /// This is the canonical `Pending -> Funded` transition: it records the
    /// funding discount and snapshots the token metadata (invoice id, face
    /// value, discount rate, due date). `discount_rate` is in basis points and
    /// must be below 100% (10_000 bps).
    pub fn fund(
        env: Env,
        caller: Address,
        invoice_id: u64,
        discount_rate: u32,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_role(&env, Role::LiquidityManager, &caller)?;
        AccessControl::require_not_paused(&env)?;

        if discount_rate >= MAX_DISCOUNT_BPS {
            return Err(Error::InvalidDiscountRate);
        }

        let mut invoice = Self::load(&env, invoice_id)?;
        if invoice.status != Status::Pending {
            return Err(Error::InvalidTransition);
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

        StatusChanged {
            invoice_id,
            from: Status::Pending,
            to: Status::Funded,
        }
        .publish(&env);
        TokenMinted {
            owner: invoice.owner,
            invoice_id,
            face_value: invoice.amount,
            discount_rate,
        }
        .publish(&env);
        Ok(())
    }

    /// Approve `spender` to transfer the caller's invoice token via
    /// [`transfer_from`]. Requires `owner` authorization and ownership of a
    /// tokenized invoice. A subsequent approval overwrites the previous one.
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        invoice_id: u64,
    ) -> Result<(), Error> {
        AccessControl::require_not_paused(&env)?;
        owner.require_auth();

        let invoice = Self::load(&env, invoice_id)?;
        if !Self::is_tokenized_inner(&env, invoice_id) {
            return Err(Error::NotTokenized);
        }
        if invoice.owner != owner {
            return Err(Error::NotOwner);
        }

        let key = DataKey::Approval(invoice_id);
        env.storage().persistent().set(&key, &spender);
        env.storage()
            .persistent()
            .extend_ttl(&key, INVOICE_TTL_THRESHOLD, INVOICE_TTL_EXTEND);

        Approved {
            owner,
            spender,
            invoice_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Transfer ownership of `invoice_id` from `from` to `to`.
    ///
    /// Requires `from` authorization and that `from` is the current owner.
    /// A repayment-settled invoice can no longer be transferred — the
    /// repayment claim has been discharged.
    pub fn transfer(env: Env, from: Address, to: Address, invoice_id: u64) -> Result<(), Error> {
        AccessControl::require_not_paused(&env)?;
        from.require_auth();

        let invoice = Self::load(&env, invoice_id)?;
        if invoice.owner != from {
            return Err(Error::NotOwner);
        }
        Self::do_transfer(&env, invoice, from, to, invoice_id)
    }

    /// Transfer an invoice token on behalf of its owner. The caller must have
    /// been granted approval via [`approve`]. The approval is consumed on a
    /// successful transfer.
    ///
    /// Requires the invoice to be tokenized and not yet repayment-settled.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        invoice_id: u64,
    ) -> Result<(), Error> {
        AccessControl::require_not_paused(&env)?;
        spender.require_auth();

        let invoice = Self::load(&env, invoice_id)?;
        if !Self::is_tokenized_inner(&env, invoice_id) {
            return Err(Error::NotTokenized);
        }
        if invoice.owner != from {
            return Err(Error::NotOwner);
        }
        let approved: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(invoice_id));
        match approved {
            Some(addr) if addr == spender => {}
            _ => return Err(Error::NotApproved),
        }
        Self::do_transfer(&env, invoice, from, to, invoice_id)
    }

    /// Drive an invoice through its lifecycle. Requires `caller` to be a
    /// current admin signer.
    ///
    /// Rejects any transition not permitted by [`Status`].
    pub fn update_status(
        env: Env,
        caller: Address,
        invoice_id: u64,
        new_status: Status,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        AccessControl::require_admin(&env, &caller)?;
        AccessControl::require_not_paused(&env)?;

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

    /// Token metadata (invoice id, face value, discount rate, due date) for a
    /// tokenized invoice. Errors if the invoice has not been funded/tokenized.
    pub fn get_invoice_token(env: Env, invoice_id: u64) -> Result<InvoiceToken, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Token(invoice_id))
            .ok_or(Error::NotTokenized)
    }

    /// Owner of the ownership token for a tokenized invoice.
    pub fn get_invoice_token_owner(env: Env, invoice_id: u64) -> Result<Address, Error> {
        if !Self::is_tokenized_inner(&env, invoice_id) {
            return Err(Error::NotTokenized);
        }
        Ok(Self::load(&env, invoice_id)?.owner)
    }

    /// Whether an invoice has been tokenized (i.e. funded).
    pub fn is_tokenized(env: Env, invoice_id: u64) -> bool {
        Self::is_tokenized_inner(&env, invoice_id)
    }

    /// Address currently approved to transfer the invoice token, if any.
    pub fn get_approved(env: Env, invoice_id: u64) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Approval(invoice_id))
            .ok_or(Error::NotApproved)
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

    // ---- access control ---------------------------------------------------

    /// The current admin signer set and threshold.
    pub fn multisig(env: Env) -> Result<MultisigConfig, Error> {
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

    /// Grant `role` to `grantee`. Requires an admin signer. `Role::Admin`
    /// cannot be granted this way — admin authority is defined solely by the
    /// signer set (see [`propose_admin_transfer`]).
    pub fn grant_role(env: Env, caller: Address, role: Role, grantee: Address) -> Result<(), Error> {
        Ok(AccessControl::grant_role(&env, &caller, role, grantee)?)
    }

    /// Revoke `role` from `grantee`. Requires an admin signer.
    pub fn revoke_role(env: Env, caller: Address, role: Role, grantee: Address) -> Result<(), Error> {
        Ok(AccessControl::revoke_role(&env, &caller, role, grantee)?)
    }

    /// Pause the contract, blocking mint/fund/transfer/status updates.
    /// Requires the `Pauser` role (or an admin signer).
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
    pub fn pending_admin_transfer(env: Env) -> Option<PendingAdminTransfer> {
        AccessControl::pending_admin_transfer(&env)
    }

    // ---- internals -------------------------------------------------------

    fn transition_allowed(from: Status, to: Status) -> bool {
        // `Pending -> Funded` is intentionally excluded: funding happens via
        // [`fund`], which also mints the ownership token.
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

    /// Shared transfer body for owner-initiated and approved transfers.
    /// Enforces the no-self-transfer and no-transfer-after-repayment rules,
    /// moves ownership, and clears any outstanding approval.
    fn do_transfer(
        env: &Env,
        mut invoice: Invoice,
        from: Address,
        to: Address,
        invoice_id: u64,
    ) -> Result<(), Error> {
        if from == to {
            return Err(Error::SameOwnerTransfer);
        }
        if invoice.status == Status::Settled {
            return Err(Error::TransferAfterRepayment);
        }

        invoice.owner = to.clone();
        Self::save(env, &invoice);
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(invoice_id));

        Transferred {
            from,
            to,
            invoice_id,
        }
        .publish(env);
        Ok(())
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

    fn require_initialized(env: &Env) -> Result<(), Error> {
        AccessControl::multisig(env)?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
