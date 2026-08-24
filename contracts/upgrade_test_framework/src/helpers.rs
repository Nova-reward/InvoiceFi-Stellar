use soroban_sdk::{Env, Address, String};

/// Helper functions for upgrade test framework
pub struct TestHelpers;

impl TestHelpers {
    /// Generate a test V1 invoice data
    pub fn create_v1_invoice(
        env: &Env,
        id: &str,
        seller: Address,
        buyer: Address,
        amount: i128,
        asset: &str,
    ) -> super::v2_invoice::V1InvoiceData {
        use super::v2_invoice::{V1InvoiceData, V1InvoiceStatus};

        V1InvoiceData {
            id: String::from_str(env, id),
            seller,
            buyer,
            amount,
            asset: String::from_str(env, asset),
            created_at: env.ledger().timestamp(),
            status: V1InvoiceStatus::Funded,
        }
    }

    /// Generate a test V1 pool data
    pub fn create_v1_pool(
        env: &Env,
        id: &str,
        admin: Address,
        committed: i128,
        deployed: i128,
        returned: i128,
    ) -> super::v2_financing_pool::V1PoolData {
        use super::v2_financing_pool::{V1PoolData, V1PoolStatus};

        V1PoolData {
            id: String::from_str(env, id),
            admin,
            total_committed: committed,
            total_deployed: deployed,
            total_returned: returned,
            created_at: env.ledger().timestamp(),
            status: V1PoolStatus::Active,
        }
    }

    /// Generate a test V1 settlement data
    pub fn create_v1_settlement(
        env: &Env,
        id: &str,
        invoice_id: &str,
        payer: Address,
        payee: Address,
        amount: i128,
        asset: &str,
    ) -> super::v2_settlement::V1SettlementData {
        use super::v2_settlement::{V1SettlementData, V1SettlementStatus};

        V1SettlementData {
            id: String::from_str(env, id),
            invoice_id: String::from_str(env, invoice_id),
            payer,
            payee,
            amount,
            asset: String::from_str(env, asset),
            settled_at: env.ledger().timestamp(),
            status: V1SettlementStatus::Completed,
        }
    }

    /// Verify migration success by reading V2 data
    pub fn verify_migration<T>(env: &Env, id: String) -> bool {
        let version_key = format!("{}_v2", id);
        env.storage().has(&String::from_str(env, &version_key))
    }

    /// Get migration version
    pub fn get_version(env: &Env, id: String) -> Option<u32> {
        let version_key = String::from_str(env, &format!("{}_v2", id));
        env.storage().get(&version_key)
    }
}
