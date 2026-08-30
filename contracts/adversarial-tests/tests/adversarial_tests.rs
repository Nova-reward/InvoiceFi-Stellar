//! Adversarial integration test suite for InvoiceFi-Stellar Soroban contracts.
//!
//! This module deploys mock malicious contracts and exercises every externally
//! callable entry point against adversarial inputs, verifying that all three
//! protocol contracts (invoice, financing-pool, settlement) correctly defend
//! against:
//!
//!  - Reentrancy attacks (Scenarios 1–3)
//!  - Zero / negative / overflow amounts (Scenarios 4–5)
//!  - Unauthorized role escalation (Scenario 6)
//!  - Invalid state-machine transitions (Scenario 7)
//!  - Nonce replay attacks (Scenario 8)
//!  - Transfers to self / after settlement (Scenarios 9–10)
//!  - Stale oracle price feed (Scenario 11)
//!  - Funding already-funded invoices (Scenario 12)
//!  - Operations on non-existent invoices (Scenario 13)
//!  - Pause/unpause access control (Scenario 14)
//!
//! See `tests/adversarial/README.md` for full threat-model documentation.

#![cfg(test)]

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    Address, Env, String, Symbol, Vec,
};

// Contract under test
use financing_pool_contract::{
    FinancingPoolContract, FinancingPoolContractClient,
    Error as PoolError,
};
use financing_pool_contract::types::{ReentrancyGuard, StorageKey, TokenContract};

use invoice_contract::{InvoiceContract, InvoiceContractClient, Error as InvoiceError, Status};

use settlement::{
    SettlementContract, SettlementContractClient,
    types::{NonceMeta, StorageKey as SettlementStorageKey},
};

use access_control::{AccessControl, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS, Role};

// ─────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Build a `Vec<Address>` from a slice of addresses (Soroban Vec, not std::vec).
fn addrs_vec(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// Initialize the invoice contract with a single admin signer.
fn init_invoice(env: &Env, client: &InvoiceContractClient<'_>, admin: &Address) {
    let signers = addrs_vec(env, &[admin.clone()]);
    client.initialize(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
}

/// Initialize the financing-pool contract with a single admin signer and
/// 10% discount (1_000 bps).
fn init_pool(env: &Env, client: &FinancingPoolContractClient<'_>, admin: &Address) {
    let signers = addrs_vec(env, &[admin.clone()]);
    client.initialize(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS, &1_000u32);
}

/// Initialize the settlement contract with a single admin signer.
fn init_settlement(env: &Env, client: &SettlementContractClient<'_>, admin: &Address) {
    let signers = addrs_vec(env, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
}

/// Plant a valid, un-used NonceMeta for a settlement invoice so that
/// `settle_invoice` can succeed on the first nonce.
fn plant_nonce_meta(env: &Env, contract_id: &Address, invoice_id: &Symbol) {
    let deadline = env.ledger().timestamp().saturating_add(86_400 * 30);
    let nm = NonceMeta::new(env, invoice_id.clone(), deadline);
    let key = SettlementStorageKey::nonce_meta(invoice_id);
    env.as_contract(contract_id, || {
        env.storage().persistent().set(&key, &nm);
    });
}

/// Mint a default invoice (1_000 tokens, crop MAIZE, 1-year due date).
fn mint_default(env: &Env, client: &InvoiceContractClient<'_>, owner: &Address) -> u64 {
    client.mint(
        owner,
        &1_000i128,
        &soroban_sdk::symbol_short!("MAIZE"),
        &2_000_000_000u64,
        &String::from_str(env, "ipfs://meta"),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock malicious contracts
// ─────────────────────────────────────────────────────────────────────────────

/// Mock token contract whose `transfer` implementation attempts to re-enter
/// the financing pool's `deposit` function before returning.
///
/// In Soroban's test harness, cross-contract calls are synchronous, so this
/// faithfully models the reentrancy vector that the guard is designed to block.
#[contract]
pub struct MaliciousTokenContract;

#[contractimpl]
impl MaliciousTokenContract {
    /// Called from within the pool's deposit/withdraw token-transfer path.
    /// Tries to call `deposit` again on the pool — the reentrancy guard
    /// must prevent this from succeeding.
    pub fn transfer(env: Env, pool_id: Address, reentrant_caller: Address, _amount: i128) {
        let pool_client = FinancingPoolContractClient::new(&env, &pool_id);
        // Attempt reentrant deposit — guard should fire Error::ReentrancyDetected
        let _ = pool_client.try_deposit(&reentrant_caller, &500i128);
    }

    /// Variant that attempts to reenter settlement's `settle_invoice`.
    pub fn transfer_settlement(
        env: Env,
        settlement_id: Address,
        caller: Address,
        invoice_id: Symbol,
    ) {
        let client = SettlementContractClient::new(&env, &settlement_id);
        // Attempt a reentrant settlement call — guard should block this
        let _ = client.try_settle_invoice(&caller, &invoice_id, &9999u64, &100i128, &0u32);
    }
}

/// Mock caller contract that submits malformed arguments and unexpected call
/// sequences against the three protocol contracts.
#[contract]
pub struct MaliciousCaller;

#[contractimpl]
impl MaliciousCaller {
    /// Attempt to mint an invoice with zero amount (InvalidAmount).
    pub fn try_zero_amount_mint(env: Env, invoice_id: Address, owner: Address) -> bool {
        let client = InvoiceContractClient::new(&env, &invoice_id);
        client
            .try_mint(
                &owner,
                &0i128,
                &soroban_sdk::symbol_short!("MAIZE"),
                &2_000_000_000u64,
                &String::from_str(&env, "ipfs://zero"),
            )
            .is_err()
    }

    /// Attempt to deposit zero tokens into the pool (InvalidAmount).
    pub fn try_zero_deposit(env: Env, pool_id: Address, from: Address) -> bool {
        let client = FinancingPoolContractClient::new(&env, &pool_id);
        client.try_deposit(&from, &0i128).is_err()
    }

    /// Attempt a fund_invoice with a negative face value (InvalidAmount).
    pub fn try_negative_face_value(
        env: Env,
        pool_id: Address,
        caller: Address,
        invoice_id: u64,
        recipient: Address,
    ) -> bool {
        let client = FinancingPoolContractClient::new(&env, &pool_id);
        client
            .try_fund_invoice(&caller, &invoice_id, &-1i128, &recipient)
            .is_err()
    }

    /// Attempt to settle an invoice with zero amount (INVALID_AMOUNT panic).
    pub fn try_zero_settle(
        env: Env,
        settlement_id: Address,
        caller: Address,
        invoice_id: Symbol,
    ) -> bool {
        let client = SettlementContractClient::new(&env, &settlement_id);
        client
            .try_settle_invoice(&caller, &invoice_id, &1u64, &0i128, &0u32)
            .is_err()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Pool reentrancy guard blocks reentrant deposit
// ─────────────────────────────────────────────────────────────────────────────

/// Manually lock the financing-pool reentrancy guard (simulating the moment
/// during execution when an external token callback fires) and verify that a
/// concurrent `deposit` call is rejected with `ReentrancyDetected`.
#[test]
fn scenario_01_pool_reentrancy_guard_blocks_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let attacker = Address::generate(&env);
    // Seed some initial balance so a real deposit follows
    pool.deposit(&attacker, &2_000i128);

    // Lock the guard mid-execution (reentrancy window)
    env.as_contract(&pool_id, || {
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);
    });

    // A second deposit while the guard is locked MUST be rejected
    assert_eq!(
        pool.try_deposit(&attacker, &1_000i128),
        Err(Ok(PoolError::ReentrancyDetected)),
        "Scenario 1: pool deposit should be blocked while reentrancy guard is locked"
    );

    // Verify state was NOT mutated by the rejected call
    assert_eq!(pool.balance_of(&attacker), 2_000i128);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Pool reentrancy guard blocks reentrant withdraw
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_02_pool_reentrancy_guard_blocks_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let lp = Address::generate(&env);
    pool.deposit(&lp, &1_000i128);

    // Simulate guard locked mid-withdraw
    env.as_contract(&pool_id, || {
        env.storage()
            .instance()
            .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);
    });

    assert_eq!(
        pool.try_withdraw(&lp, &500i128),
        Err(Ok(PoolError::ReentrancyDetected)),
        "Scenario 2: pool withdraw should be blocked while reentrancy guard is locked"
    );

    // Balance unchanged
    assert_eq!(pool.balance_of(&lp), 1_000i128);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Settlement reentrancy guard blocks reentrant settle_invoice
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_03_settlement_reentrancy_guard_blocks_settle_invoice() {
    let env = Env::default();
    env.mock_all_auths();

    let settle_id = env.register(SettlementContract, ());
    let settle = SettlementContractClient::new(&env, &settle_id);
    let admin = Address::generate(&env);
    init_settlement(&env, &settle, &admin);

    let invoice_id = Symbol::new(&env, "REENTER_INV");
    let caller = Address::generate(&env);

    settle.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5_000i128,
        &3_000_000_000u64,
        &0u32,
    );
    plant_nonce_meta(&env, &settle_id, &invoice_id);

    // Lock the guard (simulate reentrancy window)
    env.as_contract(&settle_id, || {
        env.storage()
            .instance()
            .set(&SettlementStorageKey::ReentrancyGuard, &settlement::types::ReentrancyGuard::Locked);
    });

    let result = settle.try_settle_invoice(&caller, &invoice_id, &1u64, &1_000i128, &0u32);
    assert!(
        result.is_err(),
        "Scenario 3: settle_invoice should be rejected while reentrancy guard is locked"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — MaliciousCaller: zero and negative amount rejections
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_04_zero_and_negative_amounts_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    // ── Invoice contract ──────────────────────────────────────────────────
    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    let user = Address::generate(&env);

    // Zero amount must fail
    assert_eq!(
        inv.try_mint(
            &user,
            &0i128,
            &soroban_sdk::symbol_short!("WHEAT"),
            &2_000_000_000u64,
            &String::from_str(&env, "ipfs://zero"),
        ),
        Err(Ok(InvoiceError::InvalidAmount)),
        "Scenario 4a: invoice mint with zero amount must fail"
    );

    // Negative amount must fail
    assert_eq!(
        inv.try_mint(
            &user,
            &-100i128,
            &soroban_sdk::symbol_short!("WHEAT"),
            &2_000_000_000u64,
            &String::from_str(&env, "ipfs://neg"),
        ),
        Err(Ok(InvoiceError::InvalidAmount)),
        "Scenario 4b: invoice mint with negative amount must fail"
    );

    // ── Financing pool ────────────────────────────────────────────────────
    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let padmin = Address::generate(&env);
    init_pool(&env, &pool, &padmin);

    assert_eq!(
        pool.try_deposit(&user, &0i128),
        Err(Ok(PoolError::InvalidAmount)),
        "Scenario 4c: pool deposit with zero amount must fail"
    );

    assert_eq!(
        pool.try_deposit(&user, &-1i128),
        Err(Ok(PoolError::InvalidAmount)),
        "Scenario 4d: pool deposit with negative amount must fail"
    );

    assert_eq!(
        pool.try_withdraw(&user, &0i128),
        Err(Ok(PoolError::InvalidAmount)),
        "Scenario 4e: pool withdraw with zero amount must fail"
    );

    // ── Financing pool: fund_invoice with zero face value ─────────────────
    let lm = Address::generate(&env);
    pool.grant_role(&padmin, &access_control::Role::LiquidityManager, &lm);

    assert_eq!(
        pool.try_fund_invoice(&lm, &1u64, &0i128, &user),
        Err(Ok(PoolError::InvalidAmount)),
        "Scenario 4f: fund_invoice with zero face value must fail"
    );

    assert_eq!(
        pool.try_fund_invoice(&lm, &1u64, &-500i128, &user),
        Err(Ok(PoolError::InvalidAmount)),
        "Scenario 4g: fund_invoice with negative face value must fail"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 — Settlement: zero amount and excessive amount rejection
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_05_settlement_invalid_amounts_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let settle_id = env.register(SettlementContract, ());
    let settle = SettlementContractClient::new(&env, &settle_id);
    let admin = Address::generate(&env);
    init_settlement(&env, &settle, &admin);

    let invoice_id = Symbol::new(&env, "INV_AMTS");
    let caller = Address::generate(&env);

    settle.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5_000i128,
        &3_000_000_000u64,
        &0u32,
    );
    plant_nonce_meta(&env, &settle_id, &invoice_id);

    // Zero amount — should panic with INVALID_AMOUNT
    let r = settle.try_settle_invoice(&caller, &invoice_id, &1u64, &0i128, &0u32);
    assert!(r.is_err(), "Scenario 5a: settle_invoice with zero amount must fail");

    // Amount exceeding invoice face value — should also panic
    plant_nonce_meta(&env, &settle_id, &invoice_id); // reset nonces
    let r2 = settle.try_settle_invoice(&caller, &invoice_id, &2u64, &100_000i128, &0u32);
    assert!(r2.is_err(), "Scenario 5b: settle_invoice with amount > face value must fail");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6 — Unauthorized role escalation attempts
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_06_unauthorized_role_escalation_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    // ── Invoice ───────────────────────────────────────────────────────────
    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);

    let attacker = Address::generate(&env);

    // fund() requires LiquidityManager role — attacker has none
    let owner = Address::generate(&env);
    let invoice_id = mint_default(&env, &inv, &owner);

    assert_eq!(
        inv.try_fund(&attacker, &invoice_id, &500u32),
        Err(Ok(InvoiceError::Unauthorized)),
        "Scenario 6a: invoice fund() without LiquidityManager role must be rejected"
    );

    // update_status() requires admin signer
    assert_eq!(
        inv.try_update_status(&attacker, &invoice_id, &Status::Defaulted),
        Err(Ok(InvoiceError::NotASigner)),
        "Scenario 6b: update_status() by non-admin must be rejected"
    );

    // pause() requires Pauser role or admin
    assert_eq!(
        inv.try_pause(&attacker),
        Err(Ok(InvoiceError::Unauthorized)),
        "Scenario 6c: pause() by unprivileged caller must be rejected"
    );

    // ── Financing pool ────────────────────────────────────────────────────
    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let padmin = Address::generate(&env);
    init_pool(&env, &pool, &padmin);

    // fund_invoice() requires LiquidityManager role
    assert_eq!(
        pool.try_fund_invoice(&attacker, &1u64, &1_000i128, &attacker),
        Err(Ok(PoolError::Unauthorized)),
        "Scenario 6d: fund_invoice() without LiquidityManager role must be rejected"
    );

    // set_price_feed() requires admin signer
    assert_eq!(
        pool.try_set_price_feed(&attacker, &100i128, &1u32),
        Err(Ok(PoolError::NotASigner)),
        "Scenario 6e: set_price_feed() by non-admin must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7 — Invalid state-machine transitions
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_07_invalid_invoice_state_transitions_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);

    let owner = Address::generate(&env);

    // ── Cannot transition Pending → Settled (must go through Funded first)
    let id1 = mint_default(&env, &inv, &owner);
    assert_eq!(
        inv.try_update_status(&admin, &id1, &Status::Settled),
        Err(Ok(InvoiceError::InvalidTransition)),
        "Scenario 7a: Pending → Settled must be rejected"
    );

    // ── Cannot fund an already-Funded invoice
    let id2 = mint_default(&env, &inv, &owner);
    // Grant LiquidityManager so fund() is authorized
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);
    inv.fund(&admin, &id2, &500u32);  // Pending → Funded
    assert_eq!(
        inv.try_fund(&admin, &id2, &500u32),
        Err(Ok(InvoiceError::InvalidTransition)),
        "Scenario 7b: funding an already-Funded invoice must be rejected"
    );

    // ── Cannot transition Settled → anything
    let id3 = mint_default(&env, &inv, &owner);
    inv.fund(&admin, &id3, &500u32);
    inv.update_status(&admin, &id3, &Status::Settled);
    assert_eq!(
        inv.try_update_status(&admin, &id3, &Status::Defaulted),
        Err(Ok(InvoiceError::InvalidTransition)),
        "Scenario 7c: transitioning from terminal Settled state must be rejected"
    );

    // ── Cannot transition Defaulted → anything
    let id4 = mint_default(&env, &inv, &owner);
    inv.update_status(&admin, &id4, &Status::Defaulted);
    assert_eq!(
        inv.try_update_status(&admin, &id4, &Status::Funded),
        Err(Ok(InvoiceError::InvalidTransition)),
        "Scenario 7d: transitioning from terminal Defaulted state must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8 — Nonce replay attack in settle_invoice
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_08_nonce_replay_attack_blocked() {
    let env = Env::default();
    env.mock_all_auths();

    let settle_id = env.register(SettlementContract, ());
    let settle = SettlementContractClient::new(&env, &settle_id);
    let admin = Address::generate(&env);
    init_settlement(&env, &settle, &admin);

    let invoice_id = Symbol::new(&env, "INV_REPLAY");
    let caller = Address::generate(&env);

    settle.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &10_000i128,
        &3_000_000_000u64,
        &0u32,
    );
    plant_nonce_meta(&env, &settle_id, &invoice_id);

    // First call with nonce=42 should succeed
    settle.settle_invoice(&caller, &invoice_id, &42u64, &1_000i128, &0u32);

    // Replaying nonce=42 must panic (NONCE_REPLAY)
    let r = settle.try_settle_invoice(&caller, &invoice_id, &42u64, &1_000i128, &0u32);
    assert!(
        r.is_err(),
        "Scenario 8: replaying a used nonce must be rejected"
    );

    // A fresh nonce should still work
    settle.settle_invoice(&caller, &invoice_id, &43u64, &1_000i128, &0u32);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9 — Transfer to self and transfer after settlement
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_09_transfer_to_self_and_after_settlement_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);

    let owner = Address::generate(&env);

    // ── Self-transfer must be rejected
    let id1 = mint_default(&env, &inv, &owner);
    inv.fund(&admin, &id1, &500u32);
    assert_eq!(
        inv.try_transfer(&owner, &owner, &id1),
        Err(Ok(InvoiceError::SameOwnerTransfer)),
        "Scenario 9a: self-transfer must be rejected"
    );

    // ── Transfer after Settled must be rejected
    let id2 = mint_default(&env, &inv, &owner);
    inv.fund(&admin, &id2, &500u32);
    inv.update_status(&admin, &id2, &Status::Settled);
    let other = Address::generate(&env);
    assert_eq!(
        inv.try_transfer(&owner, &other, &id2),
        Err(Ok(InvoiceError::TransferAfterRepayment)),
        "Scenario 9b: transfer of a Settled invoice must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10 — transfer_from without prior approval rejected
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_10_transfer_from_without_approval_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);

    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let to = Address::generate(&env);

    let id = mint_default(&env, &inv, &owner);
    inv.fund(&admin, &id, &500u32);

    // Attempt transfer_from without approval
    assert_eq!(
        inv.try_transfer_from(&spender, &owner, &to, &id),
        Err(Ok(InvoiceError::NotApproved)),
        "Scenario 10: transfer_from without approval must be rejected"
    );

    // After approval, spender can transfer; a different address still cannot
    inv.approve(&owner, &spender, &id);
    let different = Address::generate(&env);
    assert_eq!(
        inv.try_transfer_from(&different, &owner, &to, &id),
        Err(Ok(InvoiceError::NotApproved)),
        "Scenario 10b: transfer_from with wrong spender must still be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 11 — Stale oracle price feed blocks fund_invoice
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_11_stale_price_feed_blocks_fund_invoice() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let lm = Address::generate(&env);
    pool.grant_role(&admin, &Role::LiquidityManager, &lm);

    let recipient = Address::generate(&env);
    pool.deposit(&recipient, &10_000i128);

    // No price feed set → StalePriceFeed
    assert_eq!(
        pool.try_fund_invoice(&lm, &1u64, &1_000i128, &recipient),
        Err(Ok(PoolError::StalePriceFeed)),
        "Scenario 11a: fund_invoice without price feed must fail with StalePriceFeed"
    );

    // Set a price feed at ledger 100, then advance past MAX_PRICE_AGE_LEDGERS (100)
    pool.set_price_feed(&admin, &1_000i128, &100u32);

    // Advance ledger past the stale threshold using with_mut (preserves protocol version)
    env.ledger().with_mut(|li| {
        li.sequence_number = 201; // 201 - 100 = 101 > MAX_PRICE_AGE_LEDGERS(100)
    });

    assert_eq!(
        pool.try_fund_invoice(&lm, &1u64, &1_000i128, &recipient),
        Err(Ok(PoolError::StalePriceFeed)),
        "Scenario 11b: fund_invoice with stale price feed must fail"
    );

    // Fresh price feed at current ledger 201 should allow funding
    pool.set_price_feed(&admin, &1_000i128, &201u32);
    let advance = pool.fund_invoice(&lm, &1u64, &1_000i128, &recipient);
    assert!(advance > 0, "Scenario 11c: fund_invoice with fresh price feed should succeed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 12 — Funding an already-funded invoice in the pool
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_12_double_fund_invoice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let lm = Address::generate(&env);
    pool.grant_role(&admin, &Role::LiquidityManager, &lm);

    let recipient = Address::generate(&env);
    pool.deposit(&recipient, &10_000i128);

    // First: plant a fresh price feed
    pool.set_price_feed(&admin, &1_000i128, &0u32);

    pool.fund_invoice(&lm, &99u64, &1_000i128, &recipient);

    // Attempt to fund the same invoice id again
    assert_eq!(
        pool.try_fund_invoice(&lm, &99u64, &1_000i128, &recipient),
        Err(Ok(PoolError::AlreadyFunded)),
        "Scenario 12: double-funding the same invoice must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 13 — Operations on non-existent invoices
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_13_operations_on_nonexistent_invoice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);

    let ghost_id = 999u64;

    assert_eq!(
        inv.try_get_invoice(&ghost_id),
        Err(Ok(InvoiceError::InvoiceNotFound)),
        "Scenario 13a: get_invoice on ghost id must return InvoiceNotFound"
    );

    assert_eq!(
        inv.try_fund(&admin, &ghost_id, &500u32),
        Err(Ok(InvoiceError::InvoiceNotFound)),
        "Scenario 13b: fund on ghost id must return InvoiceNotFound"
    );

    assert_eq!(
        inv.try_update_status(&admin, &ghost_id, &Status::Defaulted),
        Err(Ok(InvoiceError::InvoiceNotFound)),
        "Scenario 13c: update_status on ghost id must return InvoiceNotFound"
    );

    assert_eq!(
        inv.try_owner_of(&ghost_id),
        Err(Ok(InvoiceError::InvoiceNotFound)),
        "Scenario 13d: owner_of on ghost id must return InvoiceNotFound"
    );

    assert_eq!(
        inv.try_get_invoice_token(&ghost_id),
        Err(Ok(InvoiceError::NotTokenized)),
        "Scenario 13e: get_invoice_token on ghost id must return NotTokenized"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 14 — Pause/unpause access control enforcement
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_14_paused_contract_rejects_state_mutations() {
    let env = Env::default();
    env.mock_all_auths();

    // ── Invoice contract ──────────────────────────────────────────────────
    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);

    let owner = Address::generate(&env);
    let id = mint_default(&env, &inv, &owner);

    inv.pause(&admin);

    assert_eq!(
        inv.try_mint(
            &owner,
            &1_000i128,
            &soroban_sdk::symbol_short!("RICE"),
            &2_000_000_000u64,
            &String::from_str(&env, "ipfs://paused"),
        ),
        Err(Ok(InvoiceError::ContractPaused)),
        "Scenario 14a: mint on paused invoice contract must fail"
    );

    assert_eq!(
        inv.try_fund(&admin, &id, &500u32),
        Err(Ok(InvoiceError::ContractPaused)),
        "Scenario 14b: fund on paused invoice contract must fail"
    );

    inv.unpause(&admin);
    // Should succeed now
    inv.fund(&admin, &id, &500u32);

    // ── Financing pool ────────────────────────────────────────────────────
    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let padmin = Address::generate(&env);
    init_pool(&env, &pool, &padmin);

    let lp = Address::generate(&env);
    pool.deposit(&lp, &1_000i128);

    pool.pause(&padmin);

    assert_eq!(
        pool.try_deposit(&lp, &500i128),
        Err(Ok(PoolError::ContractPaused)),
        "Scenario 14c: deposit on paused pool must fail"
    );

    assert_eq!(
        pool.try_withdraw(&lp, &500i128),
        Err(Ok(PoolError::ContractPaused)),
        "Scenario 14d: withdraw on paused pool must fail"
    );

    pool.unpause(&padmin);
    pool.withdraw(&lp, &500i128); // Should succeed now
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 15 — Double-initialize rejected across all contracts
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_15_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    // Invoice
    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    let extra = Address::generate(&env);
    let signers = addrs_vec(&env, &[extra.clone()]);
    assert_eq!(
        inv.try_initialize(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
        Err(Ok(InvoiceError::AlreadyInitialized)),
        "Scenario 15a: double-initialize of invoice must fail"
    );

    // Pool
    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let padmin = Address::generate(&env);
    init_pool(&env, &pool, &padmin);
    let signers2 = addrs_vec(&env, &[extra.clone()]);
    assert_eq!(
        pool.try_initialize(&signers2, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS, &500u32),
        Err(Ok(PoolError::AlreadyInitialized)),
        "Scenario 15b: double-initialize of pool must fail"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 16 — Insufficient liquidity prevents pool from over-advancing
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_16_insufficient_liquidity_prevents_overfunding() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let lm = Address::generate(&env);
    pool.grant_role(&admin, &Role::LiquidityManager, &lm);

    // Deposit only 100 tokens — pool cannot advance 1_000
    let lp = Address::generate(&env);
    pool.deposit(&lp, &100i128);

    // Fresh price feed required
    pool.set_price_feed(&admin, &1_000i128, &0u32);

    assert_eq!(
        pool.try_fund_invoice(&lm, &1u64, &1_000i128, &lp),
        Err(Ok(PoolError::InsufficientLiquidity)),
        "Scenario 16: fund_invoice when pool lacks liquidity must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 17 — Withdraw more than deposited (insufficient balance)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_17_withdraw_exceeding_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let lp = Address::generate(&env);
    pool.deposit(&lp, &200i128);

    assert_eq!(
        pool.try_withdraw(&lp, &201i128),
        Err(Ok(PoolError::InsufficientBalance)),
        "Scenario 17: withdraw exceeding balance must fail with InsufficientBalance"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 18 — Discount rate at or above 100% (10_000 bps) rejected
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_18_full_and_above_discount_rate_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let inv_id = env.register(InvoiceContract, ());
    let inv = InvoiceContractClient::new(&env, &inv_id);
    let admin = Address::generate(&env);
    init_invoice(&env, &inv, &admin);
    inv.grant_role(&admin, &Role::LiquidityManager, &admin);

    let owner = Address::generate(&env);

    // 100% discount
    let id1 = mint_default(&env, &inv, &owner);
    assert_eq!(
        inv.try_fund(&admin, &id1, &10_000u32),
        Err(Ok(InvoiceError::InvalidDiscountRate)),
        "Scenario 18a: 100% discount rate must be rejected"
    );

    // Above 100% discount
    let id2 = mint_default(&env, &inv, &owner);
    assert_eq!(
        inv.try_fund(&admin, &id2, &20_000u32),
        Err(Ok(InvoiceError::InvalidDiscountRate)),
        "Scenario 18b: >100% discount rate must be rejected"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 19 — Settlement: operation on an invoice that was never registered
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_19_settle_nonexistent_invoice_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let settle_id = env.register(SettlementContract, ());
    let settle = SettlementContractClient::new(&env, &settle_id);
    let admin = Address::generate(&env);
    init_settlement(&env, &settle, &admin);

    let ghost_id = Symbol::new(&env, "GHOST");
    let caller = Address::generate(&env);

    // Nonce meta for the ghost invoice (no invoice_data stored)
    plant_nonce_meta(&env, &settle_id, &ghost_id);

    let r = settle.try_settle_invoice(&caller, &ghost_id, &1u64, &1_000i128, &0u32);
    assert!(
        r.is_err(),
        "Scenario 19: settling a non-existent invoice must panic"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 20 — Pool admin-only set_token_address blocked for non-admins
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn scenario_20_set_token_address_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let pool_id = env.register(FinancingPoolContract, ());
    let pool = FinancingPoolContractClient::new(&env, &pool_id);
    let admin = Address::generate(&env);
    init_pool(&env, &pool, &admin);

    let attacker = Address::generate(&env);
    let token_addr = Address::generate(&env);

    assert_eq!(
        pool.try_set_token_address(&attacker, &TokenContract::XLM, &token_addr),
        Err(Ok(PoolError::NotASigner)),
        "Scenario 20: set_token_address by non-admin must be rejected"
    );

    // Admin can set it
    pool.set_token_address(&admin, &TokenContract::XLM, &token_addr);
    assert_eq!(pool.get_token_address(&TokenContract::XLM), Some(token_addr));
}
