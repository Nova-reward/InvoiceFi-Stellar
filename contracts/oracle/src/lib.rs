#![no_std]
//! Soroban Oracle Aggregator Contract
//!
//! Aggregates price data from multiple independent off-chain submitters,
//! computes a median, rejects outliers beyond a configurable tolerance band,
//! and exposes a `get_price(asset_pair)` interface for downstream contracts.
//!
//! Features:
//! - Median aggregation with outlier rejection
//! - Configurable tolerance band (percentage-based)
//! - Staleness check (configurable ledger threshold)
//! - Authorized submitter whitelist
//! - Per-asset-pair configuration

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

mod types;
use crate::types::{OracleConfig, PriceSubmission, StorageKey};

/// Price update event
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceUpdated {
    #[topic]
    pub asset_pair: Symbol,
    pub median_price: i128,
    pub submitter_count: u32,
    pub ledger: u64,
}

/// Configuration updated event
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigUpdated {
    #[topic]
    pub asset_pair: Symbol,
    pub tolerance_bps: u32,
    pub staleness_ledgers: u32,
}

/// Submitter authorized event
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmitterAuthorized {
    #[topic]
    pub submitter: Address,
}

/// Submitter revoked event
#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmitterRevoked {
    #[topic]
    pub submitter: Address,
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidPrice = 4,
    NoSubmissions = 5,
    StalePrice = 6,
    InvalidTolerance = 7,
    InvalidStaleness = 8,
    DuplicateSubmitter = 9,
    SubmitterNotFound = 10,
    AssetPairNotFound = 11,
    InsufficientSubmissions = 12,
}

#[contract]
pub struct OracleAggregator;

#[contractimpl]
impl OracleAggregator {
    /// Initialize the oracle contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&StorageKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&StorageKey::Admin, &admin);
        Ok(())
    }

    /// Configure an asset pair with tolerance and staleness parameters.
    /// Requires admin authorization.
    pub fn configure_asset_pair(
        env: Env,
        caller: Address,
        asset_pair: Symbol,
        tolerance_bps: u32,
        staleness_ledgers: u32,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;
        if tolerance_bps > 10_000 {
            return Err(Error::InvalidTolerance);
        }
        if staleness_ledgers == 0 {
            return Err(Error::InvalidStaleness);
        }

        let config = OracleConfig {
            asset_pair: asset_pair.clone(),
            tolerance_bps,
            staleness_ledgers,
            authorized_submitters: Vec::new(&env),
        };

        env.storage()
            .instance()
            .set(&StorageKey::AssetConfig(asset_pair.clone()), &config);

        ConfigUpdated {
            asset_pair,
            tolerance_bps,
            staleness_ledgers,
        }
        .publish(&env);

        Ok(())
    }

    /// Add an authorized price submitter for an asset pair.
    /// Requires admin authorization.
    pub fn authorize_submitter(
        env: Env,
        caller: Address,
        asset_pair: Symbol,
        submitter: Address,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut config: OracleConfig = env
            .storage()
            .instance()
            .get(&StorageKey::AssetConfig(asset_pair.clone()))
            .ok_or(Error::AssetPairNotFound)?;

        // Check for duplicates
        for i in 0..config.authorized_submitters.len() {
            if config.authorized_submitters.get_unchecked(i) == submitter {
                return Err(Error::DuplicateSubmitter);
            }
        }

        config.authorized_submitters.push_back(submitter.clone());
        env.storage()
            .instance()
            .set(&StorageKey::AssetConfig(asset_pair.clone()), &config);

        SubmitterAuthorized { submitter }.publish(&env);
        Ok(())
    }

    /// Revoke an authorized price submitter.
    /// Requires admin authorization.
    pub fn revoke_submitter(
        env: Env,
        caller: Address,
        asset_pair: Symbol,
        submitter: Address,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut config: OracleConfig = env
            .storage()
            .instance()
            .get(&StorageKey::AssetConfig(asset_pair.clone()))
            .ok_or(Error::AssetPairNotFound)?;

        let mut found = false;
        let mut new_submitters = Vec::new(&env);
        for i in 0..config.authorized_submitters.len() {
            let addr = config.authorized_submitters.get_unchecked(i);
            if addr == submitter {
                found = true;
            } else {
                new_submitters.push_back(addr);
            }
        }

        if !found {
            return Err(Error::SubmitterNotFound);
        }

        config.authorized_submitters = new_submitters;
        env.storage()
            .instance()
            .set(&StorageKey::AssetConfig(asset_pair.clone()), &config);

        SubmitterRevoked { submitter }.publish(&env);
        Ok(())
    }

    /// Submit a price update for an asset pair.
    /// Requires the submitter to be authorized.
    pub fn submit_price(
        env: Env,
        submitter: Address,
        asset_pair: Symbol,
        price: i128,
    ) -> Result<(), Error> {
        submitter.require_auth();
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }

        let config: OracleConfig = env
            .storage()
            .instance()
            .get(&StorageKey::AssetConfig(asset_pair.clone()))
            .ok_or(Error::AssetPairNotFound)?;

        // Verify submitter is authorized
        let mut is_authorized = false;
        for i in 0..config.authorized_submitters.len() {
            if config.authorized_submitters.get_unchecked(i) == submitter {
                is_authorized = true;
                break;
            }
        }
        if !is_authorized {
            return Err(Error::Unauthorized);
        }

        let ledger = env.ledger().sequence() as u64;
        let submission = PriceSubmission {
            submitter: submitter.clone(),
            asset_pair: asset_pair.clone(),
            price,
            ledger,
        };

        // Store submission
        let key = StorageKey::Submission(asset_pair.clone(), submitter);
        env.storage().persistent().set(&key, &submission);

        Ok(())
    }

    /// Get the aggregated median price for an asset pair.
    /// Returns None if the price is stale or insufficient submissions.
    /// Returns (price, ledger) on success.
    pub fn get_price(env: Env, asset_pair: Symbol) -> Result<Option<(i128, u64)>, Error> {
        let config: OracleConfig = env
            .storage()
            .instance()
            .get(&StorageKey::AssetConfig(asset_pair.clone()))
            .ok_or(Error::AssetPairNotFound)?;

        // Collect all valid submissions
        let mut prices = Vec::new(&env);
        let mut latest_ledger = 0u64;

        for i in 0..config.authorized_submitters.len() {
            let submitter = config.authorized_submitters.get_unchecked(i);
            let key = StorageKey::Submission(asset_pair.clone(), submitter);
            if let Some(submission) = env.storage().persistent().get(&key) {
                if submission.price > 0 {
                    prices.push_back(submission.price);
                    if submission.ledger > latest_ledger {
                        latest_ledger = submission.ledger;
                    }
                }
            }
        }

        if prices.len() < 2 {
            return Ok(None);
        }

        // Check staleness
        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger - latest_ledger > config.staleness_ledgers as u64 {
            return Ok(None);
        }

        // Sort prices for median calculation
        let mut sorted_prices = Vec::new(&env);
        for i in 0..prices.len() {
            sorted_prices.push_back(prices.get_unchecked(i));
        }
        
        // Simple bubble sort for small arrays
        for i in 0..sorted_prices.len() {
            for j in 0..sorted_prices.len() - 1 - i {
                let a = sorted_prices.get_unchecked(j);
                let b = sorted_prices.get_unchecked(j + 1);
                if a > b {
                    sorted_prices.set(j, b);
                    sorted_prices.set(j + 1, a);
                }
            }
        }

        // Compute median
        let median_idx = sorted_prices.len() / 2;
        let median_price = sorted_prices.get_unchecked(median_idx);

        // Outlier rejection: filter prices within tolerance band around median
        let tolerance = median_price * config.tolerance_bps as i128 / 10_000;
        let lower_bound = median_price - tolerance;
        let upper_bound = median_price + tolerance;

        let mut filtered_prices = Vec::new(&env);
        for i in 0..sorted_prices.len() {
            let p = sorted_prices.get_unchecked(i);
            if p >= lower_bound && p <= upper_bound {
                filtered_prices.push_back(p);
            }
        }

        if filtered_prices.len() < 2 {
            return Ok(None);
        }

        // Recompute median from filtered set
        let final_median_idx = filtered_prices.len() / 2;
        let final_median = filtered_prices.get_unchecked(final_median_idx);

        Ok(Some((final_median, latest_ledger)))
    }

    /// Get the current configuration for an asset pair.
    pub fn get_config(env: Env, asset_pair: Symbol) -> Result<OracleConfig, Error> {
        env.storage()
            .instance()
            .get(&StorageKey::AssetConfig(asset_pair))
            .ok_or(Error::AssetPairNotFound)
    }

    /// Get the admin address.
    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&StorageKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ---- internals -------------------------------------------------------

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&StorageKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod test;