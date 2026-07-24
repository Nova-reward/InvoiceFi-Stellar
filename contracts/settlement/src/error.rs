use soroban_sdk::{contracterror, Address};

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    AlreadyInitialized = 14,
    NotInitialized = 15,
    /// Caller is not a current member of the admin signer set.
    NotASigner = 16,
    InvalidThreshold = 17,
    DuplicateSigner = 18,
    InvalidTimelock = 19,
    ContractPaused = 20,
    AlreadyPaused = 21,
    NotPaused = 22,
    NoPendingTransfer = 23,
    AlreadyConfirmed = 24,
    ThresholdNotMet = 25,
    TimelockNotElapsed = 26,
    CannotGrantAdminRole = 27,
}

impl From<access_control::AcError> for SettlementError {
    fn from(e: access_control::AcError) -> Self {
        use access_control::AcError;
        match e {
            AcError::AlreadyInitialized => SettlementError::AlreadyInitialized,
            AcError::NotInitialized => SettlementError::NotInitialized,
            // Reuses the pre-existing generic `Unauthorized` variant.
            AcError::Unauthorized => SettlementError::Unauthorized,
            AcError::NotASigner => SettlementError::NotASigner,
            AcError::InvalidThreshold => SettlementError::InvalidThreshold,
            AcError::DuplicateSigner => SettlementError::DuplicateSigner,
            AcError::InvalidTimelock => SettlementError::InvalidTimelock,
            AcError::ContractPaused => SettlementError::ContractPaused,
            AcError::AlreadyPaused => SettlementError::AlreadyPaused,
            AcError::NotPaused => SettlementError::NotPaused,
            AcError::NoPendingTransfer => SettlementError::NoPendingTransfer,
            AcError::AlreadyConfirmed => SettlementError::AlreadyConfirmed,
            AcError::ThresholdNotMet => SettlementError::ThresholdNotMet,
            AcError::TimelockNotElapsed => SettlementError::TimelockNotElapsed,
            AcError::CannotGrantAdminRole => SettlementError::CannotGrantAdminRole,
        }
    }
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
