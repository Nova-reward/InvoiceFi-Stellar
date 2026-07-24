#![no_std]
//! Shared role-based access control (RBAC) and multisig-admin building block
//! for the InvoiceFi Stellar contracts (`invoice`, `financing-pool`,
//! `settlement`).
//!
//! # Model
//!
//! - **Admin** authority is held by an n-of-m signer set (`MultisigConfig`)
//!   rather than a single key. Any single current signer may authorize an
//!   ordinary admin-gated call (grant/revoke a role, adjust a fee, wire a
//!   contract address, pause/unpause, ...) — this mirrors a committee where
//!   any member can act day-to-day.
//! - **Changing who the signers are** (adding/removing/re-thresholding the
//!   admin set) is the one operation sensitive enough to require the full
//!   n-of-m confirmation flow *and* a minimum time-lock, so a single
//!   compromised or malicious signer cannot unilaterally seize control.
//! - **Operational roles** (`OracleWriter`, `Pauser`, `LiquidityManager`) are
//!   plain single-key role grants managed by the admin set. They exist so
//!   day-to-day operational actions don't need to route through every admin
//!   signer.
//!
//! Consuming contracts store their own domain state; this crate only owns
//! the access-control keys below (namespaced so they cannot collide with a
//! contract's own `DataKey`).

use soroban_sdk::{contracttype, Address, Env, Vec};

/// Minimum enforced time-lock for an admin (signer set) transfer, expressed
/// in ledgers. Stellar ledgers close roughly every 5 seconds, so 720 ledgers
/// approximates one hour and 34_560 approximates the required 48 hours.
pub const MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS: u32 = 34_560;

/// Operational roles that can be granted to individual addresses by the
/// admin signer set. `Admin` itself is intentionally not a grantable role
/// here — admin authority is defined solely by membership in
/// [`MultisigConfig::signers`], changed only via the transfer flow.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Admin,
    OracleWriter,
    Pauser,
    LiquidityManager,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AcError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NotASigner = 4,
    InvalidThreshold = 5,
    DuplicateSigner = 6,
    InvalidTimelock = 7,
    ContractPaused = 8,
    NotPaused = 9,
    NoPendingTransfer = 10,
    AlreadyConfirmed = 11,
    ThresholdNotMet = 12,
    TimelockNotElapsed = 13,
    CannotGrantAdminRole = 14,
    AlreadyPaused = 15,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MultisigConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingAdminTransfer {
    pub new_signers: Vec<Address>,
    pub new_threshold: u32,
    /// Ledger sequence at which the transfer was proposed.
    pub proposed_at: u32,
    pub confirmations: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
enum AcKey {
    Multisig,
    TimelockLedgers,
    Paused,
    PendingTransfer,
    RoleHolder(Role, Address),
}

pub struct AccessControl;

impl AccessControl {
    /// One-time setup. `timelock_ledgers` must be at least
    /// [`MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS`].
    pub fn initialize(
        env: &Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock_ledgers: u32,
    ) -> Result<(), AcError> {
        if env.storage().instance().has(&AcKey::Multisig) {
            return Err(AcError::AlreadyInitialized);
        }
        Self::validate_signer_set(&signers, threshold)?;
        if timelock_ledgers < MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS {
            return Err(AcError::InvalidTimelock);
        }

        env.storage().instance().set(
            &AcKey::Multisig,
            &MultisigConfig {
                signers,
                threshold,
            },
        );
        env.storage()
            .instance()
            .set(&AcKey::TimelockLedgers, &timelock_ledgers);
        env.storage().instance().set(&AcKey::Paused, &false);
        Ok(())
    }

    // ---- queries -----------------------------------------------------

    pub fn is_signer(env: &Env, addr: &Address) -> bool {
        Self::multisig(env)
            .map(|cfg| cfg.signers.contains(addr))
            .unwrap_or(false)
    }

    pub fn has_role(env: &Env, role: Role, addr: &Address) -> bool {
        if let Role::Admin = role {
            return Self::is_signer(env, addr);
        }
        env.storage()
            .instance()
            .has(&AcKey::RoleHolder(role, addr.clone()))
    }

    pub fn is_paused(env: &Env) -> bool {
        env.storage().instance().get(&AcKey::Paused).unwrap_or(false)
    }

    pub fn multisig(env: &Env) -> Result<MultisigConfig, AcError> {
        env.storage()
            .instance()
            .get(&AcKey::Multisig)
            .ok_or(AcError::NotInitialized)
    }

    pub fn timelock_ledgers(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&AcKey::TimelockLedgers)
            .unwrap_or(MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS)
    }

    pub fn pending_admin_transfer(env: &Env) -> Option<PendingAdminTransfer> {
        env.storage().instance().get(&AcKey::PendingTransfer)
    }

    // ---- guards used by consuming contracts --------------------------

    /// Requires `caller` to hold `role` (or be a current admin signer, which
    /// acts as a superuser over every operational role) and to have
    /// authorized this invocation.
    pub fn require_role(env: &Env, role: Role, caller: &Address) -> Result<(), AcError> {
        caller.require_auth();
        if Self::is_signer(env, caller) || Self::has_role(env, role, caller) {
            Ok(())
        } else {
            Err(AcError::Unauthorized)
        }
    }

    /// Requires `caller` to be a current admin signer and to have authorized
    /// this invocation.
    pub fn require_admin(env: &Env, caller: &Address) -> Result<(), AcError> {
        caller.require_auth();
        if Self::is_signer(env, caller) {
            Ok(())
        } else {
            Err(AcError::NotASigner)
        }
    }

    pub fn require_not_paused(env: &Env) -> Result<(), AcError> {
        if Self::is_paused(env) {
            Err(AcError::ContractPaused)
        } else {
            Ok(())
        }
    }

    // ---- role management (any single admin signer) -------------------

    pub fn grant_role(
        env: &Env,
        caller: &Address,
        role: Role,
        grantee: Address,
    ) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;
        if let Role::Admin = role {
            return Err(AcError::CannotGrantAdminRole);
        }
        env.storage()
            .instance()
            .set(&AcKey::RoleHolder(role, grantee), &true);
        Ok(())
    }

    pub fn revoke_role(
        env: &Env,
        caller: &Address,
        role: Role,
        grantee: Address,
    ) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;
        env.storage()
            .instance()
            .remove(&AcKey::RoleHolder(role, grantee));
        Ok(())
    }

    // ---- emergency pause (any single admin signer or Pauser) ---------

    pub fn pause(env: &Env, caller: &Address) -> Result<(), AcError> {
        Self::require_role(env, Role::Pauser, caller)?;
        if Self::is_paused(env) {
            return Err(AcError::AlreadyPaused);
        }
        env.storage().instance().set(&AcKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: &Env, caller: &Address) -> Result<(), AcError> {
        Self::require_role(env, Role::Pauser, caller)?;
        if !Self::is_paused(env) {
            return Err(AcError::NotPaused);
        }
        env.storage().instance().set(&AcKey::Paused, &false);
        Ok(())
    }

    // ---- time-locked n-of-m admin (signer set) transfer ---------------

    /// Propose a new signer set / threshold. Only a current signer may
    /// propose. The proposer's confirmation is recorded automatically.
    /// Replaces any prior, unexecuted proposal.
    pub fn propose_admin_transfer(
        env: &Env,
        caller: &Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;
        Self::validate_signer_set(&new_signers, new_threshold)?;

        let mut confirmations = Vec::new(env);
        confirmations.push_back(caller.clone());

        env.storage().instance().set(
            &AcKey::PendingTransfer,
            &PendingAdminTransfer {
                new_signers,
                new_threshold,
                proposed_at: env.ledger().sequence(),
                confirmations,
            },
        );
        Ok(())
    }

    /// Add `caller`'s confirmation to the pending transfer. Only current
    /// signers may confirm, and each may confirm at most once.
    pub fn confirm_admin_transfer(env: &Env, caller: &Address) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;

        let mut pending = Self::pending_admin_transfer(env).ok_or(AcError::NoPendingTransfer)?;
        if pending.confirmations.contains(caller) {
            return Err(AcError::AlreadyConfirmed);
        }
        pending.confirmations.push_back(caller.clone());
        env.storage()
            .instance()
            .set(&AcKey::PendingTransfer, &pending);
        Ok(())
    }

    /// Execute the pending transfer once it has reached the *current*
    /// threshold's worth of confirmations and the time-lock has elapsed.
    /// Any current signer may trigger execution. Clears the pending
    /// transfer on success.
    pub fn execute_admin_transfer(env: &Env, caller: &Address) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;

        let pending = Self::pending_admin_transfer(env).ok_or(AcError::NoPendingTransfer)?;
        let current = Self::multisig(env)?;
        if pending.confirmations.len() < current.threshold {
            return Err(AcError::ThresholdNotMet);
        }

        let timelock = Self::timelock_ledgers(env);
        let now = env.ledger().sequence();
        if now < pending.proposed_at.saturating_add(timelock) {
            return Err(AcError::TimelockNotElapsed);
        }

        env.storage().instance().set(
            &AcKey::Multisig,
            &MultisigConfig {
                signers: pending.new_signers,
                threshold: pending.new_threshold,
            },
        );
        env.storage().instance().remove(&AcKey::PendingTransfer);
        Ok(())
    }

    /// Withdraw the pending transfer without executing it. Only a current
    /// signer may cancel.
    pub fn cancel_admin_transfer(env: &Env, caller: &Address) -> Result<(), AcError> {
        Self::require_admin(env, caller)?;
        if Self::pending_admin_transfer(env).is_none() {
            return Err(AcError::NoPendingTransfer);
        }
        env.storage().instance().remove(&AcKey::PendingTransfer);
        Ok(())
    }

    // ---- internals -----------------------------------------------------

    fn validate_signer_set(signers: &Vec<Address>, threshold: u32) -> Result<(), AcError> {
        if signers.is_empty() || threshold == 0 || threshold > signers.len() {
            return Err(AcError::InvalidThreshold);
        }
        for i in 0..signers.len() {
            let a = signers.get(i).unwrap();
            for j in (i + 1)..signers.len() {
                if signers.get(j).unwrap() == a {
                    return Err(AcError::DuplicateSigner);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
