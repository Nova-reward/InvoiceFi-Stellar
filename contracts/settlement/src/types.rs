use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

/// Storage keys for contract addresses and reentrancy guard
#[derive(Clone)]
pub enum StorageKey {
    Instance(Symbol),
    InvoiceData(Symbol),
    InvoiceStatus(Symbol),
    InvoiceAuth0(Symbol),
    NonceMeta(Symbol),
    FinancingPoolAddress,
    ReentrancyGuard,
}

impl StorageKey {
    pub fn instance(name: &str) -> Self {
        StorageKey::Instance(Symbol::new(&Env::default(), name))
    }

    pub fn invoice_data(invoice_id: &Symbol) -> Self {
        StorageKey::InvoiceData(invoice_id.clone())
    }

    pub fn invoice_status(invoice_id: &Symbol) -> Self {
        StorageKey::InvoiceStatus(invoice_id.clone())
    }

    pub fn invoice_auth0(invoice_id: &Symbol) -> Self {
        StorageKey::InvoiceAuth0(invoice_id.clone())
    }

    pub fn nonce_meta(invoice_id: &Symbol) -> Self {
        StorageKey::NonceMeta(invoice_id.clone())
    }
}

#[derive(Clone, Debug)]
pub struct InvoiceRecord {
    pub id: Symbol,
    pub borrower: Address,
    pub financier: Address,
    pub amount: i128,
    pub due_date: u64,
    pub principal_paid: i128,
    pub interest_paid: i128,
    pub status: u32,
    pub lender_approved: bool,
    pub payer_approved: bool,
    pub is_funded: bool,
    pub lender_allowed: bool,
    pub payer_allowed: bool,
    pub approval_status: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct NonceMeta {
    pub invoice_id: Symbol,
    pub used_nonces: Vec<u64>,
    pub due_date: u64,
}

impl NonceMeta {
    pub fn new(invoice_id: Symbol, due_date: u64) -> Self {
        NonceMeta {
            invoice_id,
            used_nonces: Vec::new(&Env::default()),
            due_date,
        }
    }

    pub fn load(e: &Env, invoice_id: &Symbol) -> Self {
        let key = StorageKey::nonce_meta(invoice_id);
        if let Some(meta) = e.storage().persistent().get(&key) {
            return meta;
        }
        NonceMeta::new(invoice_id.clone(), 0)
    }

    pub fn mark_used(&mut self, _e: &Env, nonce: u64) {
        self.used_nonces.push_back(nonce);
    }

    pub fn is_valid(&self, e: &Env, nonce: u64) -> bool {
        if self.used_nonces.contains(&nonce) {
            return false;
        }
        let deadline = self.due_date.saturating_add(2592000);
        let now: u64 = e.ledger().timestamp();
        now <= deadline
    }
}

pub type SettlementNonce = NonceMeta;

/// Reentrancy guard state
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReentrancyGuard {
    Unlocked,
    Locked,
}
