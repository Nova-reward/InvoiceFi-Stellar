#![cfg(test)]
//! Tests exercise [`AccessControl`] through a minimal harness contract rather
//! than calling it directly, since it is a library (no `#[contract]` of its
//! own) and its storage/auth calls must run inside a real contract
//! invocation context — exactly how `invoice`, `financing-pool`, and
//! `settlement` will consume it.

use super::*;
use soroban_sdk::{
    contract, contracterror, contractimpl,
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestError {
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

impl From<AcError> for TestError {
    fn from(e: AcError) -> Self {
        match e {
            AcError::AlreadyInitialized => TestError::AlreadyInitialized,
            AcError::NotInitialized => TestError::NotInitialized,
            AcError::Unauthorized => TestError::Unauthorized,
            AcError::NotASigner => TestError::NotASigner,
            AcError::InvalidThreshold => TestError::InvalidThreshold,
            AcError::DuplicateSigner => TestError::DuplicateSigner,
            AcError::InvalidTimelock => TestError::InvalidTimelock,
            AcError::ContractPaused => TestError::ContractPaused,
            AcError::NotPaused => TestError::NotPaused,
            AcError::NoPendingTransfer => TestError::NoPendingTransfer,
            AcError::AlreadyConfirmed => TestError::AlreadyConfirmed,
            AcError::ThresholdNotMet => TestError::ThresholdNotMet,
            AcError::TimelockNotElapsed => TestError::TimelockNotElapsed,
            AcError::CannotGrantAdminRole => TestError::CannotGrantAdminRole,
            AcError::AlreadyPaused => TestError::AlreadyPaused,
        }
    }
}

#[contract]
struct Harness;

#[contractimpl]
impl Harness {
    pub fn init(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        timelock: u32,
    ) -> Result<(), TestError> {
        AccessControl::initialize(&env, signers, threshold, timelock).map_err(Into::into)
    }

    pub fn is_signer(env: Env, addr: Address) -> bool {
        AccessControl::is_signer(&env, &addr)
    }

    pub fn has_role(env: Env, role: Role, addr: Address) -> bool {
        AccessControl::has_role(&env, role, &addr)
    }

    pub fn is_paused(env: Env) -> bool {
        AccessControl::is_paused(&env)
    }

    pub fn multisig(env: Env) -> Result<MultisigConfig, TestError> {
        AccessControl::multisig(&env).map_err(Into::into)
    }

    pub fn timelock_ledgers(env: Env) -> u32 {
        AccessControl::timelock_ledgers(&env)
    }

    pub fn pending_transfer(env: Env) -> Option<PendingAdminTransfer> {
        AccessControl::pending_admin_transfer(&env)
    }

    pub fn require_role_op(env: Env, role: Role, caller: Address) -> Result<(), TestError> {
        AccessControl::require_role(&env, role, &caller).map_err(Into::into)
    }

    pub fn require_admin_op(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::require_admin(&env, &caller).map_err(Into::into)
    }

    pub fn grant_role(
        env: Env,
        caller: Address,
        role: Role,
        grantee: Address,
    ) -> Result<(), TestError> {
        AccessControl::grant_role(&env, &caller, role, grantee).map_err(Into::into)
    }

    pub fn revoke_role(
        env: Env,
        caller: Address,
        role: Role,
        grantee: Address,
    ) -> Result<(), TestError> {
        AccessControl::revoke_role(&env, &caller, role, grantee).map_err(Into::into)
    }

    pub fn pause(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::pause(&env, &caller).map_err(Into::into)
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::unpause(&env, &caller).map_err(Into::into)
    }

    pub fn propose(
        env: Env,
        caller: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), TestError> {
        AccessControl::propose_admin_transfer(&env, &caller, new_signers, new_threshold)
            .map_err(Into::into)
    }

    pub fn confirm(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::confirm_admin_transfer(&env, &caller).map_err(Into::into)
    }

    pub fn execute(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::execute_admin_transfer(&env, &caller).map_err(Into::into)
    }

    pub fn cancel(env: Env, caller: Address) -> Result<(), TestError> {
        AccessControl::cancel_admin_transfer(&env, &caller).map_err(Into::into)
    }
}

struct Setup {
    env: Env,
    client: HarnessClient<'static>,
    signers: Vec<Address>,
}

fn addr_vec(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// 3 signers, 2-of-3 threshold, minimum allowed time-lock.
fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &contract_id);

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let signers = addr_vec(&env, &[s1, s2, s3]);

    client.init(&signers, &2u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    Setup {
        env,
        client,
        signers,
    }
}

fn signer(setup: &Setup, i: u32) -> Address {
    setup.signers.get(i).unwrap()
}

// ---- initialization ---------------------------------------------------

#[test]
fn initialize_sets_multisig_and_unpauses() {
    let s = setup();
    let cfg = s.client.multisig();
    assert_eq!(cfg.threshold, 2);
    assert_eq!(cfg.signers, s.signers);
    assert!(!s.client.is_paused());
    assert_eq!(s.client.timelock_ledgers(), MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
}

#[test]
fn initialize_twice_fails() {
    let s = setup();
    let extra = addr_vec(&s.env, &[signer(&s, 0)]);
    assert_eq!(
        s.client.try_init(&extra, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
        Err(Ok(TestError::AlreadyInitialized))
    );
}

#[test]
fn initialize_rejects_zero_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &contract_id);
    let signers = addr_vec(&env, &[Address::generate(&env)]);
    assert_eq!(
        client.try_init(&signers, &0u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
        Err(Ok(TestError::InvalidThreshold))
    );
}

#[test]
fn initialize_rejects_threshold_above_signer_count() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &contract_id);
    let signers = addr_vec(&env, &[Address::generate(&env)]);
    assert_eq!(
        client.try_init(&signers, &2u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
        Err(Ok(TestError::InvalidThreshold))
    );
}

#[test]
fn initialize_rejects_duplicate_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let signers = addr_vec(&env, &[a.clone(), a]);
    assert_eq!(
        client.try_init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
        Err(Ok(TestError::DuplicateSigner))
    );
}

#[test]
fn initialize_rejects_timelock_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &contract_id);
    let signers = addr_vec(&env, &[Address::generate(&env)]);
    assert_eq!(
        client.try_init(&signers, &1u32, &(MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS - 1)),
        Err(Ok(TestError::InvalidTimelock))
    );
}

// ---- role management ----------------------------------------------------

#[test]
fn admin_signer_can_grant_and_revoke_operational_role() {
    let s = setup();
    let oracle = Address::generate(&s.env);

    assert!(!s.client.has_role(&Role::OracleWriter, &oracle));
    s.client.grant_role(&signer(&s, 0), &Role::OracleWriter, &oracle);
    assert!(s.client.has_role(&Role::OracleWriter, &oracle));

    s.client.revoke_role(&signer(&s, 0), &Role::OracleWriter, &oracle);
    assert!(!s.client.has_role(&Role::OracleWriter, &oracle));
}

#[test]
fn non_signer_cannot_grant_role() {
    let s = setup();
    let outsider = Address::generate(&s.env);
    let grantee = Address::generate(&s.env);
    assert_eq!(
        s.client
            .try_grant_role(&outsider, &Role::OracleWriter, &grantee),
        Err(Ok(TestError::NotASigner))
    );
}

#[test]
fn admin_role_cannot_be_granted_directly() {
    let s = setup();
    let grantee = Address::generate(&s.env);
    assert_eq!(
        s.client.try_grant_role(&signer(&s, 0), &Role::Admin, &grantee),
        Err(Ok(TestError::CannotGrantAdminRole))
    );
}

#[test]
fn signer_holds_admin_role_and_every_operational_role_as_superuser() {
    let s = setup();
    let admin = signer(&s, 0);
    assert!(s.client.has_role(&Role::Admin, &admin));
    // A signer is never granted `Pauser`/`OracleWriter`/etc. explicitly, but
    // `has_role`/`require_role` treat any current signer as a superuser over
    // every operational role.
    assert!(s.client.has_role(&Role::Pauser, &admin));
    assert!(s.client.has_role(&Role::OracleWriter, &admin));
    assert!(s.client.has_role(&Role::LiquidityManager, &admin));
    // Does not panic: a signer passes `require_role` for any operational role.
    s.client.require_role_op(&Role::LiquidityManager, &admin);
}

#[test]
fn require_admin_op_rejects_non_signer() {
    let s = setup();
    let outsider = Address::generate(&s.env);
    // Does not panic: a current signer passes `require_admin`.
    s.client.require_admin_op(&signer(&s, 0));
    assert_eq!(
        s.client.try_require_admin_op(&outsider),
        Err(Ok(TestError::NotASigner))
    );
}

#[test]
fn require_role_rejects_holder_of_a_different_role() {
    let s = setup();
    let pauser = Address::generate(&s.env);
    s.client.grant_role(&signer(&s, 0), &Role::Pauser, &pauser);
    assert_eq!(
        s.client.try_require_role_op(&Role::OracleWriter, &pauser),
        Err(Ok(TestError::Unauthorized))
    );
}

// ---- pause / unpause -----------------------------------------------------

#[test]
fn pauser_role_can_pause_and_unpause() {
    let s = setup();
    let pauser = Address::generate(&s.env);
    s.client.grant_role(&signer(&s, 0), &Role::Pauser, &pauser);

    s.client.pause(&pauser);
    assert!(s.client.is_paused());

    s.client.unpause(&pauser);
    assert!(!s.client.is_paused());
}

#[test]
fn signer_can_pause_without_explicit_pauser_role() {
    let s = setup();
    s.client.pause(&signer(&s, 0));
    assert!(s.client.is_paused());
}

#[test]
fn pause_twice_fails() {
    let s = setup();
    s.client.pause(&signer(&s, 0));
    assert_eq!(s.client.try_pause(&signer(&s, 0)), Err(Ok(TestError::AlreadyPaused)));
}

#[test]
fn unpause_when_not_paused_fails() {
    let s = setup();
    assert_eq!(s.client.try_unpause(&signer(&s, 0)), Err(Ok(TestError::NotPaused)));
}

#[test]
fn outsider_cannot_pause() {
    let s = setup();
    let outsider = Address::generate(&s.env);
    assert_eq!(s.client.try_pause(&outsider), Err(Ok(TestError::Unauthorized)));
}

// ---- time-locked n-of-m admin transfer ------------------------------------

#[test]
fn admin_transfer_full_flow() {
    let s = setup();
    let new1 = Address::generate(&s.env);
    let new2 = Address::generate(&s.env);
    let new_signers = addr_vec(&s.env, &[new1.clone(), new2.clone()]);

    // Proposer's confirmation is automatic.
    s.client.propose(&signer(&s, 0), &new_signers, &2u32);
    let pending = s.client.pending_transfer().unwrap();
    assert_eq!(pending.confirmations.len(), 1);
    assert_eq!(pending.new_threshold, 2);

    // Threshold (2) not yet met with a single confirmation.
    assert_eq!(
        s.client.try_execute(&signer(&s, 0)),
        Err(Ok(TestError::ThresholdNotMet))
    );

    s.client.confirm(&signer(&s, 1));
    assert_eq!(s.client.pending_transfer().unwrap().confirmations.len(), 2);

    // Threshold met, but the time-lock has not elapsed.
    assert_eq!(
        s.client.try_execute(&signer(&s, 0)),
        Err(Ok(TestError::TimelockNotElapsed))
    );

    s.env.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    s.client.execute(&signer(&s, 0));

    let cfg = s.client.multisig();
    assert_eq!(cfg.threshold, 2);
    assert_eq!(cfg.signers, new_signers);
    assert!(s.client.pending_transfer().is_none());

    // Old signers have lost admin authority; new ones hold it.
    assert!(!s.client.is_signer(&signer(&s, 0)));
    assert!(s.client.is_signer(&new1));
    assert!(s.client.is_signer(&new2));
}

#[test]
fn non_signer_cannot_propose_or_confirm() {
    let s = setup();
    let outsider = Address::generate(&s.env);
    let new_signers = addr_vec(&s.env, &[Address::generate(&s.env)]);
    assert_eq!(
        s.client.try_propose(&outsider, &new_signers, &1u32),
        Err(Ok(TestError::NotASigner))
    );

    s.client.propose(&signer(&s, 0), &new_signers, &1u32);
    assert_eq!(
        s.client.try_confirm(&outsider),
        Err(Ok(TestError::NotASigner))
    );
}

#[test]
fn double_confirmation_by_same_signer_fails() {
    let s = setup();
    let new_signers = addr_vec(&s.env, &[Address::generate(&s.env)]);
    s.client.propose(&signer(&s, 0), &new_signers, &1u32);
    assert_eq!(
        s.client.try_confirm(&signer(&s, 0)),
        Err(Ok(TestError::AlreadyConfirmed))
    );
}

#[test]
fn cancel_clears_pending_transfer() {
    let s = setup();
    let new_signers = addr_vec(&s.env, &[Address::generate(&s.env)]);
    s.client.propose(&signer(&s, 0), &new_signers, &1u32);
    assert!(s.client.pending_transfer().is_some());

    s.client.cancel(&signer(&s, 1));
    assert!(s.client.pending_transfer().is_none());
    assert_eq!(
        s.client.try_execute(&signer(&s, 0)),
        Err(Ok(TestError::NoPendingTransfer))
    );
}

#[test]
fn propose_replaces_prior_pending_transfer() {
    let s = setup();
    let first = addr_vec(&s.env, &[Address::generate(&s.env)]);
    let second = addr_vec(&s.env, &[Address::generate(&s.env), Address::generate(&s.env)]);

    s.client.propose(&signer(&s, 0), &first, &1u32);
    s.client.propose(&signer(&s, 1), &second, &2u32);

    let pending = s.client.pending_transfer().unwrap();
    assert_eq!(pending.new_signers, second);
    assert_eq!(pending.new_threshold, 2);
    assert_eq!(pending.confirmations.len(), 1);
}

#[test]
fn propose_rejects_invalid_new_signer_set() {
    let s = setup();
    let new_signers: Vec<Address> = Vec::new(&s.env);
    assert_eq!(
        s.client.try_propose(&signer(&s, 0), &new_signers, &1u32),
        Err(Ok(TestError::InvalidThreshold))
    );
}
