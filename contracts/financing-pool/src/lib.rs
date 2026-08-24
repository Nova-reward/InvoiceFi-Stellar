#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum FinancingPoolDataKey {
    Admin,
    Pool(u64),
    PoolCount,
    InvestorBalance(Address),
    TotalLiquidity,
}

pub const CONTRACT_PREFIX: &str = "financing_pool";

impl FinancingPoolDataKey {
    pub fn namespaced_key(&self, env: &Env) -> (Symbol, FinancingPoolDataKey) {
        (Symbol::new(env, CONTRACT_PREFIX), self.clone())
    }
}

#[contract]
pub struct FinancingPoolContract;

#[contractimpl]
impl FinancingPoolContract {
    pub fn init(env: Env, admin: Address) {
        let key = FinancingPoolDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().set(&key, &admin);
        let liq_key = FinancingPoolDataKey::TotalLiquidity.namespaced_key(&env);
        env.storage().persistent().set(&liq_key, &0u128);
    }

    pub fn deposit(env: Env, investor: Address, amount: u128) {
        let bal_key = FinancingPoolDataKey::InvestorBalance(investor.clone()).namespaced_key(&env);
        let prev_bal: u128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        env.storage().persistent().set(&bal_key, &(prev_bal + amount));

        let liq_key = FinancingPoolDataKey::TotalLiquidity.namespaced_key(&env);
        let total: u128 = env.storage().persistent().get(&liq_key).unwrap_or(0);
        env.storage().persistent().set(&liq_key, &(total + amount));
    }

    pub fn get_investor_balance(env: Env, investor: Address) -> u128 {
        let key = FinancingPoolDataKey::InvestorBalance(investor).namespaced_key(&env);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn get_total_liquidity(env: Env) -> u128 {
        let key = FinancingPoolDataKey::TotalLiquidity.namespaced_key(&env);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        let key = FinancingPoolDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_financing_pool_storage() {
        let env = Env::default();
        let contract_id = env.register(FinancingPoolContract, ());
        let client = FinancingPoolContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let investor = Address::generate(&env);

        client.init(&admin);
        assert_eq!(client.get_admin(), Some(admin));

        client.deposit(&investor, &10000);
        assert_eq!(client.get_investor_balance(&investor), 10000);
        assert_eq!(client.get_total_liquidity(), 10000);
    }
}
