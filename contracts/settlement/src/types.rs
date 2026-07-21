use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum StorageKey {
    Instance(Symbol),
    InvoiceStatus(Symbol),
    InvoiceAuth0(Symbol),
    InvoiceData(Symbol),
    NonceMeta(Symbol),
}

impl StorageKey {
    pub fn instance(name: &'static str) -> Self {
        StorageKey::Instance(Symbol::new(&Env::default(), name))
    }

    pub fn invoice_status(id: &Symbol) -> Self {
        StorageKey::InvoiceStatus(id.clone())
    }

    pub fn invoice_auth0(id: &Symbol) -> Self {
        StorageKey::InvoiceAuth0(id.clone())
    }

    pub fn invoice_data(id: &Symbol) -> Self {
        StorageKey::InvoiceData(id.clone())
    }

    pub fn nonce_meta(id: &Symbol) -> Self {
        StorageKey::NonceMeta(id.clone())
    }
}