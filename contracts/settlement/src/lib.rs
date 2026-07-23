pub mod nonce;

pub mod error;
pub mod types;

pub use error::{SettlementError, SettlementStatus};
pub use types::{InvoiceRecord, NonceMeta, StorageKey, ReentrancyGuard};

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

use crate::error::SettlementError;
use crate::types::{NonceMeta, StorageKey, ReentrancyGuard};

pub trait SettlementTrait {
    fn init(e: Env, admin: Address);
    fn get_settlement_status(e: Env, invoice_id: Symbol) -> Option<u32>;
    fn get_settlement_auth_info(
        e: Env,
        invoice_id: Symbol,
        auth_count: u32,
    ) -> Option<(Address, bool)>;
    fn get_admin(e: Env) -> Option<Address>;
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
}

#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementTrait for SettlementContract {
    fn init(e: Env, admin: Address) {
        admin.require_auth();
        e.storage()
            .instance()
            .set(&StorageKey::instance("ADMIN"), &admin);
        e.storage()
            .instance()
            .set(&StorageKey::instance("FEE_RATE"), &0u32);
        e.storage()
            .instance()
            .set(&StorageKey::instance("COLLECTED_FEES"), &0i128);
        e.storage()
            .instance()
            .set(&StorageKey::instance("WITHDRAWN_FEES"), &0i128);
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

    fn get_admin(e: Env) -> Option<Address> {
        e.storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
    }

    fn get_fee_rate(e: Env) -> Option<u32> {
        e.storage()
            .instance()
            .get(&StorageKey::instance("FEE_RATE"))
    }

    fn get_collected_fees(e: Env) -> Option<i128> {
        e.storage()
            .instance()
            .get(&StorageKey::instance("COLLECTED_FEES"))
    }

    fn get_withdrawn_fees(e: Env) -> Option<i128> {
        e.storage()
            .instance()
            .get(&StorageKey::instance("WITHDRAWN_FEES"))
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
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

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
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

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
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

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
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

        e.storage()
            .instance()
            .set(&StorageKey::instance("FEE_RATE"), &fee_rate);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "fee_rate_set")),
            (fee_rate,),
        );
    }

    fn set_escrow_pubkey(
        e: Env,
        caller: Address,
        pubkey_bytes: soroban_sdk::BytesN<32>,
    ) {
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

        e.storage()
            .instance()
            .set(&StorageKey::instance("ESCROW_PUBKEY"), &pubkey_bytes);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "escrow_set")),
            (),
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
            .unwrap_or_else(|| {
                panic!("Err: INVOICE_NOT_FOUND");
            });

        if is_buyer && !did_pay {
            record.payer_approved = true;
            record.lender_allowed = true;
        }

        if is_payee && did_pay {
            record.lender_approved = true;
            record.payer_allowed = true;
        }

        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "auth_recorded")),
            (invoice_id, caller, did_pay, is_buyer, is_payee),
        );
    }

    fn request_settlement_auth(e: Env, caller: Address, invoice_id: Symbol) {
        caller.require_auth();

        let mut record: crate::types::InvoiceRecord = e
            .storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
            .unwrap_or_else(|| {
                panic!("Err: INVOICE_NOT_FOUND");
            });

        if caller == record.borrower && !record.payer_approved {
            record.payer_approved = true;
        }

        if caller == record.financier && !record.lender_approved {
            record.lender_approved = true;
        }

        if !record.lender_approved && !record.payer_approved {
            panic!("Err: NOT_AUTHORIZED_TO_REQUEST");
        }

        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "auth_requested")),
            (invoice_id, caller),
        );
    }

    fn withdraw_fees(e: Env, caller: Address, to: Address, amount: i128) {
        caller.require_auth();

        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }

        let collected: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::instance("COLLECTED_FEES"))
            .unwrap_or(0);

        if amount > collected {
            panic!("Err: INSUFFICIENT_FEES");
        }

        let new_collected = collected - amount;
        e.storage()
            .instance()
            .set(&StorageKey::instance("COLLECTED_FEES"), &new_collected);

        let withdrawn: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::instance("WITHDRAWN_FEES"))
            .unwrap_or(0);
        e.storage()
            .instance()
            .set(&StorageKey::instance("WITHDRAWN_FEES"), &(withdrawn + amount));

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "fees_withdrawn")),
            (to, amount),
        );
    }

    fn get_invoice(
        e: Env,
        invoice_id: Symbol,
    ) -> Option<crate::types::InvoiceRecord> {
        e.storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
    }

    fn get_used_nonces(e: Env, invoice_id: Symbol) -> soroban_sdk::Vec<u64> {
        let nm = NonceMeta::load(&e, &invoice_id);
        nm.used_nonces.clone()
    }

    fn set_financing_pool_address(e: Env, caller: Address, pool_address: Address) {
        caller.require_auth();
        let admin: Address = e
            .storage()
            .instance()
            .get(&StorageKey::instance("ADMIN"))
            .expect("not initialized");
        if caller != admin {
            panic!("Err: NOT_ADMIN");
        }
        e.storage()
            .instance()
            .set(&StorageKey::FinancingPoolAddress, &pool_address);
        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "financing_pool_set")),
            (pool_address,),
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
        auth_type: u32,
    ) {
        caller.require_auth();
        
        // SAFETY: Reentrancy guard check before any state changes
        // This prevents reentrant calls from external contracts
        let guard: ReentrancyGuard = e
            .storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
            .unwrap_or(ReentrancyGuard::Unlocked);
        if guard == ReentrancyGuard::Locked {
            panic!("Err: REENTRANCY_DETECTED");
        }
        
        let nm = NonceMeta::load(&e, &invoice_id);
        if !nm.is_valid(&e, nonce) {
            panic!("Err: NONCE_REPLAY");
        }

        let mut nm2 = nm;
        nm2.mark_used(&e, nonce);

        let mut record: crate::types::InvoiceRecord = e
            .storage()
            .persistent()
            .get(&StorageKey::invoice_data(&invoice_id))
            .unwrap_or_else(|| {
                panic!("Err: INVOICE_NOT_FOUND");
            });

        if amount <= 0 || amount > record.amount {
            panic!("Err: INVALID_AMOUNT");
        }

        let fee_rate: u32 = e
            .storage()
            .instance()
            .get(&StorageKey::instance("FEE_RATE"))
            .unwrap_or(0);
        let fee = (amount * fee_rate as i128) / 10000;
        let net = amount - fee;

        // CHECKS-EFFECTS-INTERACTIONS: Update state before external calls
        let collected: i128 = e
            .storage()
            .instance()
            .get(&StorageKey::instance("COLLECTED_FEES"))
            .unwrap_or(0);
        e.storage()
            .instance()
            .set(&StorageKey::instance("COLLECTED_FEES"), &(collected + fee));

        let new_principal = record.principal_paid + net;
        record.principal_paid = new_principal;
        let is_fully_settled = new_principal >= record.amount;
        if is_fully_settled {
            record.status = crate::error::SettlementStatus::Settled as u32;
        }

        e.storage()
            .persistent()
            .set(&StorageKey::invoice_data(&invoice_id), &record);

        let nonce_key = StorageKey::nonce_meta(&invoice_id);
        e.storage().persistent().set(&nonce_key, &nm2);

        // SAFETY: Set reentrancy guard before cross-contract call
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Locked);

        // SAFETY: Cross-contract call to financing pool to notify of settlement
        // Risk: Financing pool could re-enter this contract
        // Mitigation: Reentrancy guard is active, state already updated
        // Call ordering: State updated before this call (checks-effects-interactions)
        if let Some(pool_address) = e.storage().instance().get(&StorageKey::FinancingPoolAddress) {
            // Note: In production, this would use soroban_sdk::invoke_contract
            // For now, we emit an event that the backend can use to orchestrate
            e.events().publish(
                (Symbol::new(&e, "settlement"), Symbol::new(&e, "notify_financing_pool")),
                (invoice_id.clone(), pool_address, amount, net),
            );
        }

        // SAFETY: Release reentrancy guard after cross-contract call
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Unlocked);

        e.events().publish(
            (Symbol::new(&e, "settlement"), Symbol::new(&e, "settled")),
            (invoice_id, caller, amount, nonce, fee, net, new_principal),
        );
    }
}

#[cfg(test)]
pub mod tests;
#[cfg(test)]
mod reentrancy_tests;
