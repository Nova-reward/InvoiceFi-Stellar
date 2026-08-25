use soroban_sdk::{Address, BytesN, Env, Symbol};

use crate::error::InvoiceStatus;

#[derive(Clone, Debug)]
pub struct InvoiceData {
    pub id: Symbol,
    pub invoice_number: u64,
    pub issuer: Address,
    pub payee: Address,
    pub buyer: Address,
    pub amount: i128,
    pub currency_code: Symbol,
    pub memo: Symbol,
    pub due_date: u64,
    pub metadata_hash: Symbol,
    pub payment_line_hash: Symbol,
    pub related_invoice_hash: Symbol,
    pub status: InvoiceStatus,
}

#[derive(Clone, Debug)]
pub struct LeafHashData {
    pub status_hash: Symbol,
    pub due_date_hash: Symbol,
    pub currency_code_hash: Symbol,
    pub memo_hash: Symbol,
    pub payment_line_hash: Symbol,
    pub related_invoice_hash: Symbol,
    pub buyer: Address,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Hash, Eq, PartialEq)]
pub struct StorageKey {
    pub category: Symbol,
    pub id: Symbol,
}

impl StorageKey {
    pub fn new(category: &str, id: &str) -> Self {
        StorageKey {
            category: Symbol::new(&Env::default(), category),
            id: Symbol::new(&Env::default(), id),
        }
    }

    pub fn instance(key: &str) -> Self {
        Self::new("INSTANCE", key)
    }

    pub fn invoice_data(id: &Symbol) -> Self {
        Self::new("INVOICE_DATA", id.as_str())
    }

    pub fn status(id: &Symbol) -> Self {
        Self::new("STATUS", id.as_str())
    }

    pub fn invoice_field(id: &Symbol, field: &str) -> Self {
        Self::new(field, id.as_str())
    }

    pub fn user_tree_root(user: &Address, index: u64) -> Self {
        let part = format!("{}_{}", user.to_string(), index);
        Self::new("USER_TREE", &part)
    }

    pub fn user_count(user: &Address) -> Self {
        Self::new("USER_COUNT", &user.to_string())
    }
}
