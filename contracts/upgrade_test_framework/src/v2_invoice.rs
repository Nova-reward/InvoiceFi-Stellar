use soroban_sdk::{contract, contracttype, Address, Env, String, Vec};

// ===== V1 Storage Format =====
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V1InvoiceData {
    pub id: String,
    pub seller: Address,
    pub buyer: Address,
    pub amount: i128,
    pub asset: String,
    pub created_at: u64,
    pub status: V1InvoiceStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V1InvoiceStatus {
    Pending,
    Funded,
    Paid,
    Defaulted,
}

// ===== V2 Storage Format (with new mandatory fields) =====
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V2InvoiceData {
    pub id: String,
    pub seller: Address,
    pub buyer: Address,
    pub amount: i128,
    pub asset: String,
    pub created_at: u64,
    pub status: V2InvoiceStatus,
    // NEW MANDATORY FIELDS - V1 → V2 upgrade
    pub metadata: String,                  // New mandatory field
    pub collateral: i128,                 // New mandatory field
    pub maturity_date: u64,               // New mandatory field
    pub payment_terms: V2PaymentTerms,    // New mandatory field
    pub version: u32,                     // Version tracking
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V2InvoiceStatus {
    Pending,
    Funded,
    Paid,
    Defaulted,
    Disputed,        // NEW status
    Settled,         // NEW status
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V2PaymentTerms {
    pub due_days: u32,
    pub late_penalty_bps: i128,
    pub grace_period_days: u32,
}

#[contract]
pub struct V2InvoiceContract;

#[contractimpl]
impl V2InvoiceContract {
    /// Migrate from V1 to V2 storage format
    pub fn migrate(env: Env, invoice_id: String) -> Result<(), MigrationError> {
        // 1. Read V1 data
        let v1_data: V1InvoiceData = env.storage()
            .get(&invoice_id)
            .ok_or(MigrationError::V1DataNotFound)?;

        // 2. Validate migration conditions
        // Check if already migrated to V2
        let version_key = Self::version_key(invoice_id.clone());
        if env.storage().has(&version_key) {
            return Err(MigrationError::AlreadyMigrated);
        }

        // Check migration guard conditions
        // Guard 1: Invoice must be in a valid state for migration
        if v1_data.status == V1InvoiceStatus::Pending {
            return Err(MigrationError::CannotMigratePendingInvoice);
        }

        // 3. Transform V1 data to V2 format
        let v2_data = Self::transform_to_v2(&env, v1_data);

        // 4. Write V2 data
        env.storage().set(&invoice_id, &v2_data);
        env.storage().set(&version_key, &2u32);

        // 5. Emit migration event
        env.events().publish(
            ("migration", "v1_to_v2"),
            (invoice_id, 2u32, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Transform V1 data to V2 format
    fn transform_to_v2(env: &Env, v1: V1InvoiceData) -> V2InvoiceData {
        // Map V1 status to V2 status
        let v2_status = match v1.status {
            V1InvoiceStatus::Pending => V2InvoiceStatus::Pending,
            V1InvoiceStatus::Funded => V2InvoiceStatus::Funded,
            V1InvoiceStatus::Paid => V2InvoiceStatus::Paid,
            V1InvoiceStatus::Defaulted => V2InvoiceStatus::Defaulted,
        };

        // Generate new mandatory fields from V1 data
        let metadata = format!(
            "migrated: invoice_{}_seller_{}",
            v1.id, v1.seller.to_string()
        );

        let collateral = v1.amount / 10; // 10% collateral based on invoice amount
        let maturity_date = v1.created_at + (30 * 24 * 60 * 60); // 30 days maturity

        let payment_terms = V2PaymentTerms {
            due_days: 30,
            late_penalty_bps: 500, // 5%
            grace_period_days: 3,
        };

        V2InvoiceData {
            id: v1.id,
            seller: v1.seller,
            buyer: v1.buyer,
            amount: v1.amount,
            asset: v1.asset,
            created_at: v1.created_at,
            status: v2_status,
            metadata,
            collateral,
            maturity_date,
            payment_terms,
            version: 2,
        }
    }

    /// Version key for tracking
    fn version_key(id: String) -> String {
        format!("{}_v2", id)
    }

    /// Get V2 data (with migration check)
    pub fn get_invoice(env: Env, invoice_id: String) -> Result<V2InvoiceData, MigrationError> {
        // Check version first
        let version_key = Self::version_key(invoice_id.clone());
        if !env.storage().has(&version_key) {
            // Try to read V1 data and migrate
            Self::migrate(env.clone(), invoice_id.clone())?;
        }

        env.storage()
            .get(&invoice_id)
            .ok_or(MigrationError::InvoiceNotFound)
    }
}

// ===== Migration Errors =====
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationError {
    V1DataNotFound = 1,
    AlreadyMigrated = 2,
    CannotMigratePendingInvoice = 3,
    InvoiceNotFound = 4,
    MigrationFailed = 5,
}
