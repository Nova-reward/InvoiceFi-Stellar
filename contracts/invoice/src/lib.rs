#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum InvoiceDataKey {
    Admin,
    Invoice(u64),
    InvoiceCount,
    FeeConfig,
    InvoiceStatus(u64),
}

pub const CONTRACT_PREFIX: &str = "invoice";

impl InvoiceDataKey {
    pub fn namespaced_key(&self, env: &Env) -> (Symbol, InvoiceDataKey) {
        (Symbol::new(env, CONTRACT_PREFIX), self.clone())
    }
}

#[contract]
pub struct InvoiceContract;

#[contractimpl]
impl InvoiceContract {
    pub fn init(env: Env, admin: Address) {
        let key = InvoiceDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().set(&key, &admin);
        let count_key = InvoiceDataKey::InvoiceCount.namespaced_key(&env);
        env.storage().persistent().set(&count_key, &0u64);
    }

    pub fn create_invoice(env: Env, amount: u128) -> u64 {
        let count_key = InvoiceDataKey::InvoiceCount.namespaced_key(&env);
        let count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
        let new_id = count + 1;
        
        let inv_key = InvoiceDataKey::Invoice(new_id).namespaced_key(&env);
        env.storage().persistent().set(&inv_key, &amount);

        let status_key = InvoiceDataKey::InvoiceStatus(new_id).namespaced_key(&env);
        env.storage().persistent().set(&status_key, &1u32); // 1 = Created

        env.storage().persistent().set(&count_key, &new_id);
        new_id
    }

    pub fn get_invoice(env: Env, id: u64) -> Option<u128> {
        let key = InvoiceDataKey::Invoice(id).namespaced_key(&env);
        env.storage().persistent().get(&key)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        let key = InvoiceDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_invoice_storage() {
        let env = Env::default();
        let contract_id = env.register(InvoiceContract, ());
        let client = InvoiceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);

        client.init(&admin);
        assert_eq!(client.get_admin(), Some(admin));

        let id = client.create_invoice(&5000);
        assert_eq!(id, 1);
        assert_eq!(client.get_invoice(&1), Some(5000));
    }
}
