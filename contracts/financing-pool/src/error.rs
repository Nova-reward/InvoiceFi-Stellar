use soroban_sdk::{Address, Env, Symbol};

use crate::types::StorageKey;

#[derive(Debug)]
pub enum FinancingPoolError {
    Unauthorized = 1,
    NotAdmin = 2,
    NotApproved = 3,
    ZeroAmount = 4,
    NotActive = 5,
    InvalidStatus = 6,
    ReentrancyDetected = 7,
    TokenNotSet = 8,
    TokenTransferFailed = 9,
}

#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u32)]
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

#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u32)]
pub enum DepositType {
    FixedTerm = 1,
    Flexible = 2,
}

#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u32)]
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

#[cfg(test)]
mod tests;
