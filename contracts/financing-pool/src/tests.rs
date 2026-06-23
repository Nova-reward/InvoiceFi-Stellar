use super::{
    FinancingPoolContract, StorageKey,
};
use soroban_sdk::{Address, Env, Symbol};

#[test]
fn test_init_stores_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin.clone());

    let stored_admin: Address = e
        .storage()
        .instance()
        .get(&StorageKey::instance("ADMIN"))
        .unwrap();
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "NOT_ADMIN")]
fn test_approve_investor_requires_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let investor = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin);
    // attacker calling approve_investor - not admin
    FinancingPoolContract::approve_investor(e, attacker, investor);
}

#[test]
fn test_approve_then_verify_investor_status() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin.clone());
    FinancingPoolContract::approve_investor(e.clone(), admin, investor.clone());

    let status: u32 =
        FinancingPoolContract::get_investor_status(e, investor).unwrap();
    assert_eq!(status, 2); // Active (DepositStatus::Active)
}

#[test]
fn test_is_approved_investor_after_approval() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin.clone());
    assert!(!FinancingPoolContract::is_approved_investor(
        e.clone(),
        investor.clone()
    ));

    FinancingPoolContract::approve_investor(e.clone(), admin, investor.clone());
    assert!(FinancingPoolContract::is_approved_investor(
        e, investor
    ));
}

#[test]
#[should_panic(expected = "NOT_APPROVED_INVESTOR")]
fn test_issue_deposit_requires_approved_investor() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let random = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin);
    // random is NOT approved as investor, but calling issue_deposit should fail with auth error
    let dep_key = Symbol::new(&e, "DEP-001");
    FinancingPoolContract::issue_deposit(
        e,
        random,
        dep_key,
        1000,
        2, // Flexible
        Symbol::new(&e, "memo"),
        true,
    );
}

#[test]
#[should_panic(expected = "NOT_APPROVED")]
fn test_reject_investor_requires_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let investor = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin);

    // attacker calling reject_investor - not admin
    FinancingPoolContract::reject_investor(e, attacker, investor);
}

#[test]
#[should_panic(expected = "NOT_ADMIN")]
fn test_transfer_admin_fails_for_non_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let _new_admin = Address::generate(&e);

    FinancingPoolContract::init(e.clone(), admin);

    FinancingPoolContract::set_role(e.clone(), attacker, attacker, 2);

    let stored_admin: Address = e
        .storage()
        .instance()
        .get(&StorageKey::instance("ADMIN"))
        .unwrap();
    assert_eq!(stored_admin, admin);
}
