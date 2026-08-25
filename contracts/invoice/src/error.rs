use soroban_sdk::Symbol;

use crate::types::LeafHashData;

#[derive(Debug)]
pub enum InvoiceError {
    NotFound,
    InvalidStatus,
    InvalidAmount,
    InvalidDueDate,
    Unauthorized,
}

impl InvoiceError {
    pub fn code(&self) -> u32 {
        match self {
            InvoiceError::NotFound => 1,
            InvoiceError::InvalidStatus => 2,
            InvoiceError::InvalidAmount => 3,
            InvoiceError::InvalidDueDate => 4,
            InvoiceError::Unauthorized => 5,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum InvoiceStatus {
    Draft = 0,
    Cancelled = 10,
    PendingAcceptance = 20,
    Accepted = 30,
    PendingApprovalForSettlement = 40,
    Rejected = 50,
}

impl TryFrom<u32> for InvoiceStatus {
    type Error = ();
    fn try_from(value: u32) -> Result<Self, ()> {
        match value {
            0 => Ok(InvoiceStatus::Draft),
            10 => Ok(InvoiceStatus::Cancelled),
            20 => Ok(InvoiceStatus::PendingAcceptance),
            30 => Ok(InvoiceStatus::Accepted),
            40 => Ok(InvoiceStatus::PendingApprovalForSettlement),
            50 => Ok(InvoiceStatus::Rejected),
            _ => Err(()),
        }
    }
}

impl InvoiceStatus {
    pub fn from_u32(value: u32) -> Option<Self> {
        Self::try_from(value).ok()
    }
}

#[cfg(test)]
mod tests;
