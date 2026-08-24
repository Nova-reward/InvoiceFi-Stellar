#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SettlementDataKey {
    Admin,
    Settlement(u64),
    SettlementCount,
    EscrowBalance,
}

pub const CONTRACT_PREFIX: &str = "settlement";

impl SettlementDataKey {
    pub fn namespaced_key(&self, env: &Env) -> (Symbol, SettlementDataKey) {
        (Symbol::new(env, CONTRACT_PREFIX), self.clone())
    }
}

#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementContract {
    pub fn init(env: Env, admin: Address) {
        let key = SettlementDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().set(&key, &admin);
        let count_key = SettlementDataKey::SettlementCount.namespaced_key(&env);
        env.storage().persistent().set(&count_key, &0u64);
        let escrow_key = SettlementDataKey::EscrowBalance.namespaced_key(&env);
        env.storage().persistent().set(&escrow_key, &0u128);
    }

    pub fn record_settlement(env: Env, _invoice_id: u64, amount: u128) -> u64 {
        let count_key = SettlementDataKey::SettlementCount.namespaced_key(&env);
        let count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
        let new_id = count + 1;

        let set_key = SettlementDataKey::Settlement(new_id).namespaced_key(&env);
        env.storage().persistent().set(&set_key, &amount);

        let escrow_key = SettlementDataKey::EscrowBalance.namespaced_key(&env);
        let current_escrow: u128 = env.storage().persistent().get(&escrow_key).unwrap_or(0);
        env.storage().persistent().set(&escrow_key, &(current_escrow + amount));

        env.storage().persistent().set(&count_key, &new_id);
        new_id
    }

    pub fn get_settlement(env: Env, id: u64) -> Option<u128> {
        let key = SettlementDataKey::Settlement(id).namespaced_key(&env);
        env.storage().persistent().get(&key)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        let key = SettlementDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_settlement_storage() {
        let env = Env::default();
        let contract_id = env.register(SettlementContract, ());
        let client = SettlementContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);

        client.init(&admin);
        assert_eq!(client.get_admin(), Some(admin));

        let id = client.record_settlement(&101, &7500);
        assert_eq!(id, 1);
        assert_eq!(client.get_settlement(&1), Some(7500));
    }
}
