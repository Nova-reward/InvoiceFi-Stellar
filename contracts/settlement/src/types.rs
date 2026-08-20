use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

/// Storage keys for contract addresses and reentrancy guard
#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    Instance(Symbol),
    InvoiceData(Symbol),
    InvoiceStatus(Symbol),
    InvoiceAuth0(Symbol),
    NonceMeta(Symbol),
    FinancingPoolAddress,
    ReentrancyGuard,
    Attestation(Symbol),
}

impl StorageKey {
    /// Bug fix: this previously built the `Symbol` from a throwaway
    /// `Env::default()` rather than the live contract `env`. For any string
    /// over 9 characters, Soroban's small-symbol inline encoding doesn't
    /// apply and a real host object is allocated — one that belonged to the
    /// disposable `Env::default()` and was invalid (or already dropped) by
    /// the time it reached the caller's real environment, surfacing at
    /// runtime as a "mis-tagged object reference" host error.
    pub fn instance(env: &Env, name: &str) -> Self {
        StorageKey::Instance(Symbol::new(env, name))
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

    pub fn attestation(asset_pair: &Symbol) -> Self {
        StorageKey::Attestation(asset_pair.clone())
    }
}

#[contracttype]
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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceAttestation {
    pub asset_pair: Symbol,
    pub price: i128,
    pub ledger_sequence: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AttestationRecord {
    pub asset_pair: Symbol,
    pub price: i128,
    pub ledger_sequence: u32,
    pub timestamp: u64,
}

impl NonceMeta {
    /// Same throwaway-`Env` bug as `StorageKey::instance` above: `Vec::new`
    /// allocates a real host `VecObject` (even for an empty vec), so it
    /// must be built from the caller's live `env`.
    pub fn new(env: &Env, invoice_id: Symbol, due_date: u64) -> Self {
        NonceMeta {
            invoice_id,
            used_nonces: Vec::new(env),
            due_date,
        }
    }

    /// Load the stored nonce-replay record for `invoice_id`, or lazily
    /// create one on first use. `fallback_due_date` should be the
    /// invoice's own `due_date` — the nonce-validity window
    /// (`is_valid`) is computed relative to it, so seeding a fresh record
    /// with `due_date: 0` (as this previously did unconditionally) made
    /// every nonce look already-expired for any invoice settled after
    /// ~30 days past the Unix epoch, i.e. always, rejecting every
    /// first-time settlement with a spurious `NONCE_REPLAY`.
    pub fn load(e: &Env, invoice_id: &Symbol, fallback_due_date: u64) -> Self {
        let key = StorageKey::nonce_meta(invoice_id);
        if let Some(meta) = e.storage().persistent().get(&key) {
            return meta;
        }
        NonceMeta::new(e, invoice_id.clone(), fallback_due_date)
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
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReentrancyGuard {
    Unlocked,
    Locked,
}
