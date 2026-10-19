pub mod nonce;
pub mod error;
pub mod types;

pub use error::{SettlementError, SettlementStatus};
pub use types::{InvoiceRecord, NonceMeta, StorageKey, ReentrancyGuard};

use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, Symbol, Vec};

use access_control::{AcError, AccessControl, MultisigConfig, PendingAdminTransfer, Role};

/// Unwrap an [`access_control`] result, translating any [`AcError`] into the
/// contract's own typed [`SettlementError`] via a host trap. Every entry
/// point here returns `()`/`Option<T>` rather than `Result`, so this is how
/// role/multisig failures still surface as a specific, decodable error code
/// to callers instead of an opaque string panic.
fn unwrap_ac<T>(e: &Env, result: Result<T, AcError>) -> T {
    match result {
        Ok(v) => v,
        Err(err) => panic_with_error!(e, SettlementError::from(err)),
    }
}

fn unwrap_math<T>(e: &Env, result: Result<T, common::CheckedMathError>) -> T {
    match result {
        Ok(v) => v,
        Err(err) => panic_with_error!(e, SettlementError::from(err)),
    }
}

/// Basis-point denominator used by every fee calculation in this contract.
const BPS_DENOMINATOR: i128 = 10_000;

/// Compute `amount * bps / 10_000` using checked arithmetic.
///
/// The intermediate `amount * bps` product can overflow `i128` for
/// near-maximum `amount` values even though the final quotient would fit.
/// Returning a typed error here prevents a silent wrap/panic and keeps the
/// fee path consistent with the financing-pool BPS guard (issue #154).
fn checked_bps_mul(
    e: &Env,
    amount: i128,
    bps: u32,
) -> Result<i128, common::CheckedMathError> {
    let product = amount
        .checked_mul(bps as i128)
        .ok_or(common::CheckedMathError::Overflow)?;
    product
        .checked_div(BPS_DENOMINATOR)
        .ok_or(common::CheckedMathError::Overflow)
}

pub trait SettlementTrait {
    fn init(e: Env, signers: Vec<Address>, threshold: u32, timelock_ledgers: u32);
    fn get_settlement_status(e: Env, invoice_id: Symbol) -> Option<u32>;
    fn get_settlement_auth_info(
        e: Env,
        invoice_id: Symbol,
        auth_count: u32,
    ) -> Option<(Address, bool)>;
    fn get_fee_rate(e: Env) -> Option<u32>;
    fn get_collected_fees(e: Env) -> Option<i128>;
    fn get_withdrawn_fees(e: Env) -> Option<i128>;
    fn list_authorized_payers(e: Env) -> soroban_sdk::Vec<Address>;
    fn list_financiers(e: Env) -> soroban_sdk::Vec<Address>;
    fn list_invoices(e: Env) -> soroban_sdk::Vec<Symbol>;

    fn set_authorized_payers(e: Env, caller: Address, payers: soroban_sdk::Vec<Address>);
    fn set_financiers(e: Env, caller: Address, financiers: soroban_sdk::Vec<Address>);
    fn set_invoice_data(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        borrower: Address,
        financier: Address,
        amount: i128,
        due_date: u64,
        interest_rate: u32,
    );
    fn set_fee_rate(e: Env, caller: Address, fee_rate: u32);
    fn set_escrow_pubkey(e: Env, caller: Address, pubkey_bytes: soroban_sdk::BytesN<32>);
    fn submit_attestation(
        e: Env,
        caller: Address,
        payload_bytes: soroban_sdk::Bytes,
        sig_bytes: soroban_sdk::BytesN<64>,
    );
    fn settlement_auth(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        did_pay: bool,
        is_buyer: bool,
        is_payee: bool,
    );
    fn request_settlement_auth(e: Env, caller: Address, invoice_id: Symbol);
    fn withdraw_fees(e: Env, caller: Address, to: Address, amount: i128);
    fn get_invoice(e: Env, invoice_id: Symbol) -> Option<crate::types::InvoiceRecord>;
    fn get_used_nonces(e: Env, invoice_id: Symbol) -> soroban_sdk::Vec<u64>;
    fn set_financing_pool_address(e: Env, caller: Address, pool_address: Address);
    fn get_financing_pool_address(e: Env) -> Option<Address>;

    fn settle_invoice(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        nonce: u64,
        amount: i128,
        auth_type: u32,
    );

    // ---- access control ---------------------------------------------------

    fn multisig(e: Env) -> MultisigConfig;
    fn is_signer(e: Env, addr: Address) -> bool;
    fn has_role(e: Env, role: Role, addr: Address) -> bool;
    fn is_paused(e: Env) -> bool;
    fn grant_role(e: Env, caller: Address, role: Role, grantee: Address);
    fn revoke_role(e: Env, caller: Address, role: Role, grantee: Address);
    fn pause(e: Env, caller: Address);
    fn unpause(e: Env, caller: Address);
    fn propose_admin_transfer(e: Env, caller: Address, new_signers: Vec<Address>, new_threshold: u32);
    fn confirm_admin_transfer(e: Env, caller: Address);
    fn execute_admin_transfer(e: Env, caller: Address);
    fn cancel_admin_transfer(e: Env, caller: Address);
    fn pending_admin_transfer(e: Env) -> Option<PendingAdminTransfer>;
}

#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementTrait for SettlementContract {
    fn init(e: Env, signers: Vec<Address>, threshold: u32, timelock_ledgers: u32) {
        unwrap_ac(&e, AccessControl::initialize(&e, signers, threshold, timelock_ledgers));
        e.storage()
            .instance()
            .set(&StorageKey::FeeRate, &0u32);
        e.storage()
            .instance()
            .set(&StorageKey::CollectedFees, &0i128);
        e.storage()
            .instance()
            .set(&StorageKey::WithdrawnFees, &0i128);
        // Initialize reentrancy guard as unlocked
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Unlocked);
    }

    fn get_settlement_status(e: Env, invoice_id: Symbol) -> Option<u32> {
        e.storage()
            .persistent()
            .get(&StorageKey::invoice_status(&invoice_id))
    }

    fn get_settlement_auth_info(
        e: Env,
        invoice_id: Symbol,
        _auth_count: u32,
    ) -> Option<(Address, bool)> {
        e.storage()
            .persistent()
            .get(&StorageKey::invoice_auth0(&invoice_id))
    }

    fn get_fee_rate(e: Env) -> Option<u32> {
        e.storage()
            .instance()
            .get(&StorageKey::FeeRate)
    }

    fn get_collected_fees(e: Env) -> Option<i128> {
        e.storage()
            .instance()
            .get(&StorageKey::CollectedFees)
    }

    fn get_withdrawn_fees(e: Env) -> Option<i128> {
        e.storage()
            .instance()
            .get(&StorageKey::WithdrawnFees)
    }

    fn list_authorized_payers(e: Env) -> soroban_sdk::Vec<Address> {
        soroban_sdk::Vec::new(&e)
    }

    fn list_financiers(e: Env) -> soroban_sdk::Vec<Address> {
        soroban_sdk::Vec::new(&e)
    }

    fn list_invoices(e: Env) -> soroban_sdk::Vec<Symbol> {
        soroban_sdk::Vec::new(&e)
    }

    fn set_authorized_payers(
        e: Env,
        caller: Address,
        _payers: soroban_sdk::Vec<Address>,
    ) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "payers_set")),
            (),
        );
    }

    fn set_financiers(
        e: Env,
        caller: Address,
        _financiers: soroban_sdk::Vec<Address>,
    ) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "financiers_set")),
            (),
        );
    }

    fn set_invoice_data(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        borrower: Address,
        financier: Address,
        amount: i128,
        due_date: u64,
        _interest_rate: u32,
    ) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        let record = crate::types::InvoiceRecord {
            id: invoice_id.clone(),
            borrower: borrower.clone(),
            financier: financier.clone(),
            amount,
            due_date,
            principal_paid: 0,
            interest_paid: 0,
            status: crate::error::SettlementStatus::ApprovedForSettlement as u32,
            lender_approved: false,
            payer_approved: false,
            is_funded: false,
            lender_allowed: true,
            payer_allowed: false,
            approval_status: 0,
        };

        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "invoice_set")),
            (invoice_id, borrower, financier, amount, due_date),
        );
    }

    fn set_fee_rate(e: Env, caller: Address, fee_rate: u32) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        e.storage()
            .instance()
            .set(&StorageKey::FeeRate, &fee_rate);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "fee_rate_set")),
            fee_rate,
        );
    }

    fn set_escrow_pubkey(e: Env, caller: Address, pubkey_bytes: soroban_sdk::BytesN<32>) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        e.storage()
            .instance()
            .set(&StorageKey::EscrowPubkey, &pubkey_bytes);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "escrow_pubkey_set")),
            pubkey_bytes,
        );
    }

    fn submit_attestation(
        e: Env,
        caller: Address,
        payload_bytes: soroban_sdk::Bytes,
        sig_bytes: soroban_sdk::BytesN<64>,
    ) {
        caller.require_auth();

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "attestation")),
            (caller, payload_bytes, sig_bytes),
        );
    }

    fn settlement_auth(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        did_pay: bool,
        is_buyer: bool,
        is_payee: bool,
    ) {
        caller.require_auth();

        let mut record: crate::types::InvoiceRecord = e
            .storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
            .unwrap_or_else(|| panic_with_error!(&e, SettlementError::InvoiceNotFound));

        if is_buyer {
            record.payer_approved = did_pay;
        }
        if is_payee {
            record.lender_approved = did_pay;
        }

        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "auth")),
            (invoice_id, caller, did_pay),
        );
    }

    fn request_settlement_auth(e: Env, caller: Address, invoice_id: Symbol) {
        caller.require_auth();

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "auth_requested")),
            (invoice_id, caller),
        );
    }

    fn withdraw_fees(e: Env, caller: Address, to: Address, amount: i128) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        let collected: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::CollectedFees)
            .unwrap_or(0);
        let withdrawn: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::WithdrawnFees)
            .unwrap_or(0);

        let available = unwrap_math(
            &e,
            collected
                .checked_sub(withdrawn)
                .ok_or(common::CheckedMathError::Overflow),
        );
        if amount > available {
            panic_with_error!(&e, SettlementError::InsufficientFees);
        }

        let new_withdrawn = unwrap_math(
            &e,
            withdrawn
                .checked_add(amount)
                .ok_or(common::CheckedMathError::Overflow),
        );
        e.storage()
            .instance()
            .set(&StorageKey::WithdrawnFees, &new_withdrawn);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "fees_withdrawn")),
            (to, amount),
        );
    }

    fn get_invoice(e: Env, invoice_id: Symbol) -> Option<crate::types::InvoiceRecord> {
        e.storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
    }

    fn get_used_nonces(e: Env, invoice_id: Symbol) -> soroban_sdk::Vec<u64> {
        e.storage()
            .persistent()
            .get(&StorageKey::used_nonces(&invoice_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&e))
    }

    fn set_financing_pool_address(e: Env, caller: Address, pool_address: Address) {
        unwrap_ac(&e, AccessControl::require_admin(&e, &caller));

        e.storage()
            .instance()
            .set(&StorageKey::FinancingPoolAddress, &pool_address);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "pool_set")),
            pool_address,
        );
    }

    fn get_financing_pool_address(e: Env) -> Option<Address> {
        e.storage()
            .instance()
            .get(&StorageKey::FinancingPoolAddress)
    }

    fn settle_invoice(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        nonce: u64,
        amount: i128,
        _auth_type: u32,
    ) {
        caller.require_auth();

        // Reentrancy guard: reject if already locked.
        let guard: ReentrancyGuard = e
            .storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
            .unwrap_or(ReentrancyGuard::Unlocked);
        if matches!(guard, ReentrancyGuard::Locked) {
            panic_with_error!(&e, SettlementError::Reentrancy);
        }
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Locked);

        let mut record: crate::types::InvoiceRecord = e
            .storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
            .unwrap_or_else(|| panic_with_error!(&e, SettlementError::InvoiceNotFound));

        // Replay protection: reject reused nonces.
        let mut used: soroban_sdk::Vec<u64> = e
            .storage()
            .persistent()
            .get(&StorageKey::used_nonces(&invoice_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&e));
        if used.contains(nonce) {
            panic_with_error!(&e, SettlementError::NonceAlreadyUsed);
        }
        used.push_back(nonce);
        e.storage()
            .persistent()
            .set(&StorageKey::used_nonces(&invoice_id), &used);

        // Fee calculation: fee = amount * fee_rate / 10_000, using checked
        // arithmetic so near-max i128 amounts cannot wrap the intermediate
        // product (issue #154).
        let fee_rate: u32 = e
            .storage()
            .instance()
            .get(&StorageKey::FeeRate)
            .unwrap_or(0);
        let fee = unwrap_math(&e, checked_bps_mul(&e, amount, fee_rate));

        let collected: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::CollectedFees)
            .unwrap_or(0);
        let new_collected = unwrap_math(
            &e,
            collected
                .checked_add(fee)
                .ok_or(common::CheckedMathError::Overflow),
        );
        e.storage()
            .instance()
            .set(&StorageKey::CollectedFees, &new_collected);

        record.principal_paid = unwrap_math(
            &e,
            record
                .principal_paid
                .checked_add(amount)
                .ok_or(common::CheckedMathError::Overflow),
        );
        record.status = crate::error::SettlementStatus::Settled as u32;
        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        // Release the reentrancy guard.
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Unlocked);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "settled")),
            (invoice_id, caller, amount, fee),
        );
    }

    // ---- access control ---------------------------------------------------

    fn multisig(e: Env) -> MultisigConfig {
        AccessControl::multisig(&e)
    }

    fn is_signer(e: Env, addr: Address) -> bool {
        AccessControl::is_signer(&e, &addr)
    }

    fn has_role(e: Env, role: Role, addr: Address) -> bool {
        AccessControl::has_role(&e, role, &addr)
    }

    fn is_paused(e: Env) -> bool {
        AccessControl::is_paused(&e)
    }

    fn grant_role(e: Env, caller: Address, role: Role, grantee: Address) {
        unwrap_ac(&e, AccessControl::grant_role(&e, &caller, role, &grantee));
    }

    fn revoke_role(e: Env, caller: Address, role: Role, grantee: Address) {
        unwrap_ac(&e, AccessControl::revoke_role(&e, &caller, role, &grantee));
    }

    fn pause(e: Env, caller: Address) {
        unwrap_ac(&e, AccessControl::pause(&e, &caller));
    }

    fn unpause(e: Env, caller: Address) {
        unwrap_ac(&e, AccessControl::unpause(&e, &caller));
    }

    fn propose_admin_transfer(
        e: Env,
        caller: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) {
        unwrap_ac(
            &e,
            AccessControl::propose_admin_transfer(&e, &caller, new_signers, new_threshold),
        );
    }

    fn confirm_admin_transfer(e: Env, caller: Address) {
        unwrap_ac(&e, AccessControl::confirm_admin_transfer(&e, &caller));
    }

    fn execute_admin_transfer(e: Env, caller: Address) {
        unwrap_ac(&e, AccessControl::execute_admin_transfer(&e, &caller));
    }

    fn cancel_admin_transfer(e: Env, caller: Address) {
        unwrap_ac(&e, AccessControl::cancel_admin_transfer(&e, &caller));
    }

    fn pending_admin_transfer(e: Env) -> Option<PendingAdminTransfer> {
        AccessControl::pending_admin_transfer(&e)
    }
}
