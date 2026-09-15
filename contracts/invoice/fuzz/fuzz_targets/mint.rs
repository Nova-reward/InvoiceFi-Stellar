#![no_main]
use libfuzzer_sys::fuzz_target;
use soroban_sdk::{symbol_short, Address, Env, String, testutils::Address as _};
use invoice_contract::{InvoiceContract, InvoiceContractClient};

fuzz_target!(|data: (u64, i128)| {
    let (due_date, amount) = data;
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());

    let _ = client.try_initialize(&signers, &1u32, &17280u32);

    let owner = Address::generate(&env);
    let meta = String::from_str(&env, "meta");
    let crop = symbol_short!("CROP");

    let _ = client.try_mint(&owner, &amount, &crop, &due_date, &meta);
});
