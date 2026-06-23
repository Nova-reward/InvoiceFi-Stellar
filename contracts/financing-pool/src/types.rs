use soroban_sdk::{Address, Env, Symbol};

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

#[derive(Clone, Copy, Debug, Hash, Eq, PartialEq)]
#[contracttype]
pub struct StorageKey {
    pub category: Symbol,
    pub id: Symbol,
}

impl StorageKey {
    pub fn new(category: &str, id: &str) -> Self {
        StorageKey {
            category: Symbol::new(&Env::default(), category),
            id: Symbol::new(&Env::default(), id),
        }
    }

    pub fn instance(key: &str) -> Self {
        Self::new("INSTANCE", key)
    }

    pub fn deposit_status(dep: &Symbol) -> Self {
        Self::new("DEP_STATUS", dep.as_str())
    }

    pub fn deposit_balance(dep: &Symbol) -> Self {
        Self::new("DEP_BALANCE", dep.as_str())
    }

    pub fn cert_status(cert: &Symbol) -> Self {
        Self::new("CERT_STATUS", cert.as_str())
    }

    pub fn investment_status(inv: &Symbol) -> Self {
        Self::new("INV_STATUS", inv.as_str())
    }

    pub fn investment_amount(inv: &Symbol) -> Self {
        Self::new("INV_AMOUNT", inv.as_str())
    }

    pub fn investor_status(addr: &Address) -> Self {
        Self::new("INVESTOR_STATUS", &addr.to_string())
    }

    pub fn fund_req_status(req: &Symbol) -> Self {
        Self::new("FUND_REQ_STATUS", req.as_str())
    }
}
