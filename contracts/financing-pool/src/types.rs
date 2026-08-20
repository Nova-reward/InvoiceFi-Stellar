use soroban_sdk::{contracttype, Env, Symbol};

/// Token contract addresses for supported assets
#[contracttype]
#[derive(Clone, Debug)]
pub enum TokenContract {
    XLM,
    USDC,
    AQUA,
}

impl TokenContract {
    /// Bug fix: this previously built the `Symbol` from a throwaway
    /// `Env::default()` rather than the live contract `env`. For any string
    /// over 9 characters, Soroban's small-symbol inline encoding doesn't
    /// apply and a real host object is allocated — one that belonged to the
    /// disposable `Env::default()` and was invalid (or already dropped) by
    /// the time it reached the caller's real environment, surfacing at
    /// runtime as a "mis-tagged object reference" host error. Every one of
    /// these constructors now takes the caller's `&Env` instead.
    pub fn to_symbol(&self, env: &Env) -> Symbol {
        match self {
            TokenContract::XLM => Symbol::new(env, "XLM"),
            TokenContract::USDC => Symbol::new(env, "USDC"),
            TokenContract::AQUA => Symbol::new(env, "AQUA"),
        }
    }
}

/// Reentrancy guard state
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReentrancyGuard {
    Unlocked,
    Locked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[contracttype]
pub struct StorageKey {
    pub category: Symbol,
    pub id: Symbol,
}

impl StorageKey {
    pub fn new(env: &Env, category: &str, id: &str) -> Self {
        StorageKey {
            category: Symbol::new(env, category),
            id: Symbol::new(env, id),
        }
    }

    pub fn instance(env: &Env, key: &str) -> Self {
        Self::new(env, "INSTANCE", key)
    }

    pub fn token_address(env: &Env, token: &TokenContract) -> Self {
        StorageKey {
            category: Symbol::new(env, "TOKEN_ADDRESS"),
            id: token.to_symbol(env),
        }
    }

    pub fn reentrancy_guard(env: &Env) -> Self {
        Self::instance(env, "REENTRANCY_GUARD")
    }
}
