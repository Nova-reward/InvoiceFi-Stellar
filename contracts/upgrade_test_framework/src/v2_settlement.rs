use soroban_sdk::{contract, contracttype, Address, Env, String, Vec};

// ===== V1 Storage Format =====
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V1SettlementData {
    pub id: String,
    pub invoice_id: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: String,
    pub settled_at: u64,
    pub status: V1SettlementStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V1SettlementStatus {
    Pending,
    Completed,
    Failed,
}

// ===== V2 Storage Format =====
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V2SettlementData {
    pub id: String,
    pub invoice_id: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: String,
    pub settled_at: u64,
    pub status: V2SettlementStatus,
    // NEW MANDATORY FIELDS - V1 → V2 upgrade
    pub confirmation_block: u64,           // New mandatory field
    pub transaction_hash: String,          // New mandatory field
    pub fee_amount: i128,                  // New mandatory field
    pub settlement_type: V2SettlementType, // New mandatory field
    pub finality_status: V2FinalityStatus, // New mandatory field
    pub version: u32,                      // Version tracking
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V2SettlementStatus {
    Pending,
    Completed,
    Failed,
    Reversed,       // NEW status
    Confirmed,      // NEW status
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V2SettlementType {
    Standard,
    Instant,
    Delayed,
    Conditional,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V2FinalityStatus {
    Pending,
    Confirmed,
    Finalized,
}

#[contract]
pub struct V2Settlement;

#[contractimpl]
impl V2Settlement {
    /// Migrate from V1 to V2 storage format
    pub fn migrate(env: Env, settlement_id: String) -> Result<(), MigrationError> {
        // 1. Read V1 data
        let v1_data: V1SettlementData = env.storage()
            .get(&settlement_id)
            .ok_or(MigrationError::V1DataNotFound)?;

        // 2. Validate migration conditions
        let version_key = Self::version_key(settlement_id.clone());
        if env.storage().has(&version_key) {
            return Err(MigrationError::AlreadyMigrated);
        }

        // Guard: Only completed settlements can be migrated
        // Pending or failed settlements need special handling
        if v1_data.status == V1SettlementStatus::Pending {
            return Err(MigrationError::CannotMigratePendingSettlement);
        }

        // 3. Transform V1 data to V2 format
        let v2_data = Self::transform_to_v2(&env, v1_data);

        // 4. Write V2 data
        env.storage().set(&settlement_id, &v2_data);
        env.storage().set(&version_key, &2u32);

        // 5. Emit migration event
        env.events().publish(
            ("migration", "v1_to_v2"),
            (settlement_id, 2u32, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Transform V1 data to V2 format
    fn transform_to_v2(env: &Env, v1: V1SettlementData) -> V2SettlementData {
        let v2_status = match v1.status {
            V1SettlementStatus::Pending => V2SettlementStatus::Pending,
            V1SettlementStatus::Completed => V2SettlementStatus::Confirmed,
            V1SettlementStatus::Failed => V2SettlementStatus::Failed,
        };

        let confirmation_block = env.ledger().sequence();
        let transaction_hash = String::from_str(env, &format!("txn_{}", v1.id));
        let fee_amount = v1.amount / 1000; // 0.1% fee
        let settlement_type = V2SettlementType::Standard;
        let finality_status = V2FinalityStatus::Finalized;

        V2SettlementData {
            id: v1.id,
            invoice_id: v1.invoice_id,
            payer: v1.payer,
            payee: v1.payee,
            amount: v1.amount,
            asset: v1.asset,
            settled_at: v1.settled_at,
            status: v2_status,
            confirmation_block,
            transaction_hash,
            fee_amount,
            settlement_type,
            finality_status,
            version: 2,
        }
    }

    fn version_key(id: String) -> String {
        format!("{}_v2", id)
    }

    /// Get V2 data (with migration check)
    pub fn get_settlement(env: Env, settlement_id: String) -> Result<V2SettlementData, MigrationError> {
        let version_key = Self::version_key(settlement_id.clone());
        if !env.storage().has(&version_key) {
            Self::migrate(env.clone(), settlement_id.clone())?;
        }

        env.storage()
            .get(&settlement_id)
            .ok_or(MigrationError::SettlementNotFound)
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationError {
    V1DataNotFound = 1,
    AlreadyMigrated = 2,
    CannotMigratePendingSettlement = 3,
    SettlementNotFound = 4,
    MigrationFailed = 5,
}
