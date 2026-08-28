use soroban_sdk::{
    testutils::Address as _,
    Address, Env, IntoVal, Symbol, Val,
};

use access_control::{AccessControlContract, AccessControlDataKey};
use financing_pool::{FinancingPoolContract, FinancingPoolDataKey};
use invoice::{InvoiceContract, InvoiceDataKey};
use settlement::{SettlementContract, SettlementDataKey};

#[test]
fn test_no_raw_storage_key_overlap_across_contracts() {
    let env = Env::default();
    let dummy_addr = Address::generate(&env);
    let dummy_sym = Symbol::new(&env, "TEST");

    // Enumerate every DataKey variant across access-control, invoice, financing-pool, settlement
    let ac_keys = [
        AccessControlDataKey::Admin.namespaced_key(&env),
        AccessControlDataKey::Role(dummy_sym.clone(), dummy_addr.clone()).namespaced_key(&env),
        AccessControlDataKey::RoleAdmin(dummy_sym.clone()).namespaced_key(&env),
        AccessControlDataKey::Paused.namespaced_key(&env),
    ];

    let inv_keys = [
        InvoiceDataKey::Admin.namespaced_key(&env),
        InvoiceDataKey::Invoice(1).namespaced_key(&env),
        InvoiceDataKey::InvoiceCount.namespaced_key(&env),
        InvoiceDataKey::FeeConfig.namespaced_key(&env),
        InvoiceDataKey::InvoiceStatus(1).namespaced_key(&env),
    ];

    let pool_keys = [
        FinancingPoolDataKey::Admin.namespaced_key(&env),
        FinancingPoolDataKey::Pool(1).namespaced_key(&env),
        FinancingPoolDataKey::PoolCount.namespaced_key(&env),
        FinancingPoolDataKey::InvestorBalance(dummy_addr.clone()).namespaced_key(&env),
        FinancingPoolDataKey::TotalLiquidity.namespaced_key(&env),
    ];

    let set_keys = [
        SettlementDataKey::Admin.namespaced_key(&env),
        SettlementDataKey::Settlement(1).namespaced_key(&env),
        SettlementDataKey::SettlementCount.namespaced_key(&env),
        SettlementDataKey::EscrowBalance.namespaced_key(&env),
    ];

    // Collect all serialized Val payloads into a vector
    let mut all_payloads: std::vec::Vec<u64> = std::vec::Vec::new();

    for key in ac_keys.iter() {
        let val: Val = key.into_val(&env);
        all_payloads.push(val.get_payload());
    }
    for key in inv_keys.iter() {
        let val: Val = key.into_val(&env);
        all_payloads.push(val.get_payload());
    }
    for key in pool_keys.iter() {
        let val: Val = key.into_val(&env);
        all_payloads.push(val.get_payload());
    }
    for key in set_keys.iter() {
        let val: Val = key.into_val(&env);
        all_payloads.push(val.get_payload());
    }

    // Assert that every single key across all 4 contracts produces a unique payload representation
    for i in 0..all_payloads.len() {
        for j in (i + 1)..all_payloads.len() {
            assert!(
                all_payloads[i] != all_payloads[j],
                "Collision detected between key index {} and {}! (payload: {})",
                i,
                j,
                all_payloads[i]
            );
        }
    }
}

#[test]
fn test_shared_env_multi_contract_storage_isolation() {
    let env = Env::default();

    let shared_id = Address::generate(&env);

    let ac_admin = Address::generate(&env);
    let inv_admin = Address::generate(&env);
    let pool_admin = Address::generate(&env);
    let set_admin = Address::generate(&env);

    // Execute contract operations on the EXACT SAME instance address context
    env.register_at(&shared_id, AccessControlContract, ());

    env.as_contract(&shared_id, || {
        AccessControlContract::init(env.clone(), ac_admin.clone());
        InvoiceContract::init(env.clone(), inv_admin.clone());
        FinancingPoolContract::init(env.clone(), pool_admin.clone());
        SettlementContract::init(env.clone(), set_admin.clone());

        // Verify all four contracts maintain their independent Admin state without clobbering each other
        assert_eq!(
            AccessControlContract::get_admin(env.clone()),
            Some(ac_admin.clone()),
            "AccessControl admin was clobbered!"
        );
        assert_eq!(
            InvoiceContract::get_admin(env.clone()),
            Some(inv_admin.clone()),
            "Invoice admin was clobbered!"
        );
        assert_eq!(
            FinancingPoolContract::get_admin(env.clone()),
            Some(pool_admin.clone()),
            "FinancingPool admin was clobbered!"
        );
        assert_eq!(
            SettlementContract::get_admin(env.clone()),
            Some(set_admin.clone()),
            "Settlement admin was clobbered!"
        );

        // Execute actions across contracts in shared instance storage
        let inv_id = InvoiceContract::create_invoice(env.clone(), 150_000);
        assert_eq!(inv_id, 1);

        let investor = Address::generate(&env);
        FinancingPoolContract::deposit(env.clone(), investor.clone(), 500_000);

        let set_id = SettlementContract::record_settlement(env.clone(), inv_id, 150_000);
        assert_eq!(set_id, 1);

        // Verify invoice count and settlement count do not overlap or clobber each other
        assert_eq!(InvoiceContract::get_invoice(env.clone(), 1), Some(150_000));
        assert_eq!(
            FinancingPoolContract::get_investor_balance(env.clone(), investor),
            500_000
        );
        assert_eq!(
            SettlementContract::get_settlement(env.clone(), 1),
            Some(150_000)
        );
    });
}
