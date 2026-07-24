use soroban_sdk::{Address, Env, Symbol};

#[derive(Debug)]
pub enum SettlementError {
    Unauthorized = 1,
    AlreadySettled = 2,
    InvalidStatus = 3,
    ZeroAmount = 4,
    AlreadyAuthorized = 5,
    NotAuthorized = 6,
    NonceReplay = 7,
    InvoiceNotFound = 8,
    InvalidAuthType = 9,
    InsufficientFees = 10,
    ReentrancyDetected = 11,
    FinancingPoolNotSet = 12,
    CrossContractCallFailed = 13,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum SettlementStatus {
    ApprovedForSettlement = 0,
    LenderApproved = 1,
    PayerApproved = 2,
    Settled = 3,
    ReleaseRejected = 9,
}

#[derive(Clone, Debug)]
pub struct SettlementAuthInfo {
    pub lender_addr: Address,
    pub lender_auth: bool,
    pub buyer_addr: Address,
    pub buyer_auth: bool,
    pub payee_addr: Address,
    pub payee_auth: bool,
}

#[cfg(test)]
mod tests;
