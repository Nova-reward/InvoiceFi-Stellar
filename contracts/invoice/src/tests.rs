use super::{InvoiceContract, InvoiceStatus, StorageKey};
use soroban_sdk::{testutils::Accounts, Address, BytesN, Env, Symbol};

#[test]
fn test_init_stores_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let stored_admin: Address = e
        .storage()
        .instance()
        .get(&StorageKey::instance("ADMIN"))
        .unwrap();
    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "")]
fn test_mint_unauth_caller_rejected() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-001");
    InvoiceContract::mint_invoice(
        e,
        attacker,
        id,
        1,
        attacker.clone(),
        attacker.clone(),
        attacker.clone(),
        1000,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );
}

#[test]
fn test_mint_creates_draft_invoice() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-OK");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id.clone(),
        42,
        admin.clone(),
        admin.clone(),
        admin.clone(),
        5000,
        Symbol::new(&e, "XLM"),
        Symbol::new(&e, "test"),
        2000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    let status: u32 = InvoiceContract::get_status(e, id.clone()).unwrap();
    assert_eq!(status, InvoiceStatus::Draft as u32);
    let issuer = InvoiceContract::get_issuer(e.clone(), id).unwrap();
    assert_eq!(issuer, admin);
}

#[test]
#[should_panic(expected = "")]
fn test_cancel_requires_issuer() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-CANCEL");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id.clone(),
        1,
        admin.clone(),
        admin.clone(),
        admin.clone(),
        500,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    InvoiceContract::cancel_invoice(e, attacker, id);
}

#[test]
fn test_reject_requires_buyer_auth() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let buyer = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-REJECT");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id.clone(),
        1,
        admin.clone(),
        admin.clone(),
        buyer.clone(),
        500,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    InvoiceContract::reject_invoice(e, buyer, id);
    let status: u32 = InvoiceContract::get_status(e, id).unwrap();
    assert_eq!(status, InvoiceStatus::Rejected as u32);
}

#[test]
#[should_panic(expected = "")]
fn test_approve_requires_buyer_auth() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let buyer = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-APPROVE");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id.clone(),
        1,
        admin.clone(),
        admin.clone(),
        buyer.clone(),
        500,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    // attacker is not the buyer - should panic with Unauthorized
    InvoiceContract::approve_invoice(e, attacker, id);
}

#[test]
#[should_panic(expected = "")]
fn test_settlement_auth_requires_issuer_or_payee() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let attacker = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id = Symbol::new(&e, "INV-SA");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id.clone(),
        1,
        admin.clone(),
        admin.clone(),
        admin.clone(),
        500,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    // attacker is neither issuer nor payee
    InvoiceContract::request_settlement_auth(
        e,
        attacker,
        id,
        soroban_sdk::Vec::new(&e),
    );
}

#[test]
fn test_user_tree_count_increments() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let pk = BytesN::from_array(&e, &[1u8; 32]);

    InvoiceContract::init(e.clone(), admin.clone(), pk);

    let id1 = Symbol::new(&e, "INV-1");
    InvoiceContract::mint_invoice(
        e.clone(),
        admin.clone(),
        id1,
        1,
        admin.clone(),
        admin.clone(),
        admin.clone(),
        500,
        Symbol::new(&e, "USD"),
        Symbol::new(&e, "memo"),
        3000000000,
        Symbol::new(&e, "meta"),
        Symbol::new(&e, "pay"),
        Symbol::new(&e, "rel"),
        soroban_sdk::Vec::new(&e),
    );

    let count: u64 = InvoiceContract::get_user_tree_count(e, admin.clone()).unwrap();
    assert!(count > 0);
}
