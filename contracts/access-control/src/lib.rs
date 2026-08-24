#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AccessControlDataKey {
    Admin,
    Role(Symbol, Address),
    RoleAdmin(Symbol),
    Paused,
}

pub const CONTRACT_PREFIX: &str = "access_control";

impl AccessControlDataKey {
    pub fn namespaced_key(&self, env: &Env) -> (Symbol, AccessControlDataKey) {
        (Symbol::new(env, CONTRACT_PREFIX), self.clone())
    }
}

#[contract]
pub struct AccessControlContract;

#[contractimpl]
impl AccessControlContract {
    pub fn init(env: Env, admin: Address) {
        let key = AccessControlDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().set(&key, &admin);
    }

    pub fn set_role(env: Env, role: Symbol, account: Address) {
        let key = AccessControlDataKey::Role(role, account.clone()).namespaced_key(&env);
        env.storage().persistent().set(&key, &true);
    }

    pub fn has_role(env: Env, role: Symbol, account: Address) -> bool {
        let key = AccessControlDataKey::Role(role, account).namespaced_key(&env);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        let key = AccessControlDataKey::Admin.namespaced_key(&env);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, Symbol};

    #[test]
    fn test_access_control_storage() {
        let env = Env::default();
        let contract_id = env.register(AccessControlContract, ());
        let client = AccessControlContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let role = Symbol::new(&env, "operator");

        client.init(&admin);
        assert_eq!(client.get_admin(), Some(admin));

        assert!(!client.has_role(&role, &user));
        client.set_role(&role, &user);
        assert!(client.has_role(&role, &user));
    }
}
