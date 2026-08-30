use soroban_sdk::{contracttype, Address, Symbol, Vec};

/// Oracle configuration for a specific asset pair
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleConfig {
    pub asset_pair: Symbol,
    /// Tolerance band in basis points (1/100th of a percent)
    pub tolerance_bps: u32,
    /// Maximum ledger age before price is considered stale
    pub staleness_ledgers: u32,
    /// Authorized price submitters
    pub authorized_submitters: Vec<Address>,
}

/// Individual price submission
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceSubmission {
    pub submitter: Address,
    pub asset_pair: Symbol,
    pub price: i128,
    pub ledger: u64,
}

/// Storage keys for the oracle contract
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum StorageKey {
    Admin,
    AssetConfig(Symbol),
    Submission(Symbol, Address),
}

impl StorageKey {
    pub fn asset_config(asset_pair: &Symbol) -> Self {
        Self::AssetConfig(asset_pair.clone())
    }

    pub fn submission(asset_pair: &Symbol, submitter: &Address) -> Self {
        Self::Submission(asset_pair.clone(), submitter.clone())
    }
}