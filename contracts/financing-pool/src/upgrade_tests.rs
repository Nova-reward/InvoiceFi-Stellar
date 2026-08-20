//! Upgrade regression tests for the Financing Pool contract.
//!
//! # Pattern
//!
//! Each test:
//! 1. Deploys the financing pool (v1) and plants a specific state pattern.
//! 2. Re-registers the v2 test-double at the same address.
//! 3. Asserts that all planted state is intact via v2 reads.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    FinancingPoolContract, FinancingPoolContractClient, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct V1Harness<'a> {
    env: Env,
    contract_id: Address,
    client: FinancingPoolContractClient<'a>,
    admin: Address,
}

const DISCOUNT_BPS: u32 = 1_000; // 10 %

fn deploy_v1() -> V1Harness<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(
        &signers,
        &1u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &DISCOUNT_BPS,
    );
    // `fund_invoice` rejects calls without a fresh oracle price feed; seed
    // one so the funding-related upgrade-regression tests below can call it.
    client.set_price_feed(&admin, &1_000_000i128, &env.ledger().sequence());
    let client: FinancingPoolContractClient<'static> = unsafe { core::mem::transmute(client) };
    V1Harness {
        env,
        contract_id,
        client,
        admin,
    }
}

use upgrade_test_framework::v2_financing_pool::FinancingPoolContractV2;
use upgrade_test_framework::v2_financing_pool::FinancingPoolContractV2Client;

fn simulate_upgrade_to_v2<'a>(
    env: &'a Env,
    contract_id: &Address,
) -> FinancingPoolContractV2Client<'a> {
    env.register_at(contract_id, FinancingPoolContractV2, ());
    FinancingPoolContractV2Client::new(env, contract_id)
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

/// LP balance and total available liquidity survive the upgrade.
#[test]
fn upgrade_preserves_lp_balance() {
    let h = deploy_v1();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);

    assert_eq!(h.client.balance_of(&lp), 10_000);
    assert_eq!(h.client.available_liquidity(), 10_000);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(v2.version(), 2, "version() should return 2");
    assert_eq!(
        v2.balance_of(&lp),
        10_000,
        "LP balance must survive upgrade"
    );
    assert_eq!(
        v2.available_liquidity(),
        10_000,
        "available liquidity must survive upgrade"
    );
}

/// A Funding record (invoice_id, face_value, advance, recipient) survives
/// the upgrade intact.
#[test]
fn upgrade_preserves_funded_invoice_record() {
    let h = deploy_v1();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    let advance = h.client.fund_invoice(&h.admin, &7u64, &1_000i128, &farmer);
    assert_eq!(advance, 900); // 10 % discount

    let funding_v1 = h.client.get_funding(&7u64);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert!(v2.is_funded(&7u64), "is_funded must be true after upgrade");
    let funding_v2 = v2.get_funding(&7u64);

    assert_eq!(
        funding_v2.invoice_id, funding_v1.invoice_id,
        "invoice_id mismatch after upgrade"
    );
    assert_eq!(
        funding_v2.face_value, funding_v1.face_value,
        "face_value mismatch after upgrade"
    );
    assert_eq!(
        funding_v2.advance, funding_v1.advance,
        "advance mismatch after upgrade"
    );
    assert_eq!(
        funding_v2.recipient, funding_v1.recipient,
        "recipient mismatch after upgrade"
    );

    // Liquidity bookkeeping must also survive.
    assert_eq!(
        v2.available_liquidity(),
        10_000 - 900,
        "available liquidity mismatch after upgrade"
    );
    assert_eq!(
        v2.balance_of(&farmer),
        900,
        "farmer balance mismatch after upgrade"
    );
    assert_eq!(
        v2.balance_of(&lp),
        10_000,
        "LP claim must be unchanged after upgrade"
    );
}

/// Balance and liquidity values after a withdrawal still survive the upgrade.
#[test]
fn upgrade_preserves_post_withdrawal_state() {
    let h = deploy_v1();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);
    // Farmer withdraws their advance.
    h.client.withdraw(&farmer, &900i128);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        v2.balance_of(&farmer),
        0,
        "farmer balance must be 0 after withdrawal + upgrade"
    );
    assert_eq!(
        v2.available_liquidity(),
        10_000 - 900 - 900,
        "liquidity mismatch after withdrawal + upgrade"
    );
    assert_eq!(v2.balance_of(&lp), 10_000, "LP claim must survive upgrade");
}

/// The discount_bps configuration survives the upgrade and produces correct
/// quotes.
#[test]
fn upgrade_preserves_discount_bps() {
    let h = deploy_v1();
    assert_eq!(h.client.discount_bps(), DISCOUNT_BPS);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        v2.discount_bps(),
        DISCOUNT_BPS,
        "discount_bps must survive upgrade"
    );
    // Quote must still apply the same discount.
    assert_eq!(
        v2.quote(&1_000i128),
        900,
        "quote must use surviving discount_bps"
    );
}

/// A LiquidityManager role grant survives the upgrade; the grantee can still
/// call fund_invoice.
#[test]
fn upgrade_preserves_lm_role() {
    let h = deploy_v1();
    let lm = Address::generate(&h.env);
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    h.client
        .grant_role(&h.admin, &access_control::Role::LiquidityManager, &lm);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert!(
        v2.has_role(&access_control::Role::LiquidityManager, &lm),
        "LiquidityManager role must survive upgrade"
    );
    // Role still authorises fund_invoice.
    let advance = v2.fund_invoice(&lm, &42u64, &1_000i128, &farmer);
    assert_eq!(advance, 900);
}

/// The paused state from v1 persists; deposit is still rejected after upgrade.
#[test]
fn upgrade_preserves_paused_state() {
    let h = deploy_v1();
    h.client.pause(&h.admin);
    assert!(h.client.is_paused());

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert!(v2.is_paused(), "paused state must survive upgrade");
    let lp = Address::generate(&h.env);
    // `v2` is built through `upgrade-test-framework`, a separate compilation
    // of `financing-pool-contract` (an inherent consequence of the
    // dev-dependency cycle needed to test-double the upgrade), so its
    // `Error` type is nominally distinct from `crate::Error` here even
    // though it's structurally identical. Assert failure, not the specific
    // typed variant.
    assert!(
        v2.try_deposit(&lp, &100i128).is_err(),
        "deposit must still be blocked while paused after upgrade"
    );
}

/// Multiple LP balances and funding records across different invoices all
/// survive the upgrade simultaneously (the "garden" invariant).
#[test]
fn upgrade_preserves_multiple_fundings_and_balances() {
    let h = deploy_v1();
    let lp1 = Address::generate(&h.env);
    let lp2 = Address::generate(&h.env);
    let farmer1 = Address::generate(&h.env);
    let farmer2 = Address::generate(&h.env);

    h.client.deposit(&lp1, &5_000i128);
    h.client.deposit(&lp2, &5_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer1);
    h.client.fund_invoice(&h.admin, &2u64, &2_000i128, &farmer2);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        v2.balance_of(&lp1),
        5_000,
        "lp1 balance mismatch after upgrade"
    );
    assert_eq!(
        v2.balance_of(&lp2),
        5_000,
        "lp2 balance mismatch after upgrade"
    );
    assert_eq!(
        v2.balance_of(&farmer1),
        900,
        "farmer1 balance mismatch after upgrade"
    );
    assert_eq!(
        v2.balance_of(&farmer2),
        1_800,
        "farmer2 balance mismatch after upgrade"
    );

    // Available = 10 000 - 900 - 1 800 = 7 300
    assert_eq!(
        v2.available_liquidity(),
        7_300,
        "available liquidity mismatch after upgrade"
    );

    let f1 = v2.get_funding(&1u64);
    let f2 = v2.get_funding(&2u64);
    assert_eq!(f1.advance, 900);
    assert_eq!(f2.advance, 1_800);
}
