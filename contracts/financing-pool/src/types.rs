use soroban_sdk::{contracttype, Address, Env, Symbol};

/// Token contract addresses for supported assets
#[contracttype]
#[derive(Clone, Debug)]
pub enum TokenContract {
    XLM,
    USDC,
    AQUA,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum DepositStatus {
    Draft = 1,
    Active = 2,
    Closed = 3,
    PendingWithdrawalRequest = 4,
    WithdrawalRequestApproved = 5,
    WithdrawalRequestRejected = 6,
    Released = 7,
    Accepted = 8,
    Rejected = 9,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum DepositType {
    FixedTerm = 1,
    Flexible = 2,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum InvestmentStatus {
    Draft = 1,
    Opened = 2,
    Funded = 3,
    Closed = 4,
    SettlementInitiatorRequestedAuth = 5,
    ReleaseApproved = 6,
    ReleaseRejected = 7,
    Accepted = 8,
    Rejected = 9,
}

impl TokenContract {
    pub fn to_symbol(&self) -> Symbol {
        match self {
            TokenContract::XLM => Symbol::new(&Env::default(), "XLM"),
            TokenContract::USDC => Symbol::new(&Env::default(), "USDC"),
            TokenContract::AQUA => Symbol::new(&Env::default(), "AQUA"),
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

#[derive(Clone, Debug)]
pub struct PoolBalance {
    pub total: i128,
    pub available: i128,
    pub allocated: i128,
}

#[derive(Clone, Debug)]
pub struct DepositData {
    pub dep_key: Symbol,
    pub depositor: Address,
    pub amount: i128,
    pub deposit_type: DepositType,
    pub memo: Symbol,
    pub InvestNow: bool,
    pub status: DepositStatus,
}

#[derive(Clone, Debug)]
pub struct CertificateData {
    pub cert_key: Symbol,
    pub linked_dep_key: Symbol,
    pub amount: i128,
    pub cert_type: DepositType,
    pub payable_amount: i128,
    pub payment_due_date: u64,
    pub pool_invest_nonce: u64,
    pub interest_rate: u32,
    pub approval_status: u32,
    pub status: DepositStatus,
}

#[derive(Clone, Debug)]
pub struct InvestmentRequestData {
    pub inv_key: Symbol,
    pub investor: Address,
    pub invoice_id: Symbol,
    pub amount: i128,
    pub status: InvestmentStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    ReentrancyGuard,
    TokenAddress(Symbol),
}

impl StorageKey {
    pub fn reentrancy_guard() -> Self {
        StorageKey::ReentrancyGuard
    }

    pub fn token_address(token: &TokenContract) -> Self {
        StorageKey::TokenAddress(token.to_symbol())
    }
}
