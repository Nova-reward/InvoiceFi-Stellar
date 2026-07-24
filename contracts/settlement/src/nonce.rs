use soroban_sdk::{Env, Symbol};
use crate::types::{NonceMeta, StorageKey};

// NonceManager provides static helper methods for nonce bookkeeping.
// NonceMeta IS the contract-side type alias for SettlementNonce.

pub struct NonceManager;

impl NonceManager {
    pub fn record(
        e: &Env,
        invoice_id: &Symbol,
        nonce: u64,
        due_date: u64,
    ) {
        let key = StorageKey::nonce_meta(invoice_id);
        let mut nm = if let Some(meta) = e.storage().persistent().get(&key) {
            meta
        } else {
            NonceMeta::new(invoice_id.clone(), due_date)
        };
        nm.mark_used(e, nonce);
        e.storage().persistent().set(&key, &nm);
    }

    pub fn is_valid(e: &Env, invoice_id: &Symbol, nonce: u64) -> bool {
        let nm = NonceMeta::load(e, invoice_id);
        nm.is_valid(e, nonce)
    }
}
