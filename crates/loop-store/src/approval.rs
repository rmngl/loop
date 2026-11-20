use chrono::Utc;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{ApprovalId, CompanyId};
use serde_json::Value;
use sqlx::Row;

use crate::pool::Store;

#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub approval_id: ApprovalId,
    pub kind: String,
    pub payload_json: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

pub struct ApprovalRepository<'a> {
    store: &'a Store,
}

impl<'a> ApprovalRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn approve(&self, company_id: CompanyId, approval_id: ApprovalId) -> Result<(String, Value)> {
        let row = sqlx::query(
            r#"
            SELECT kind, payload_json, status FROM approvals
            WHERE id = ?1 AND company_id = ?2
            "#,
        )
        .bind(approval_id.to_string())
        .bind(company_id.to_string())
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?
        .ok_or_else(|| LoopError::NotFound(format!("approval {}", approval_id)))?;

        let kind: String = row.try_get("kind").map_err(|e| LoopError::Database(e.to_string()))?;
        let status: String = row.try_get("status").map_err(|e| LoopError::Database(e.to_string()))?;
        if status != "pending" {
            return Err(LoopError::Validation("approval already resolved".into()));
        }

        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"UPDATE approvals SET status = 'approved', resolved_at = ?1 WHERE id = ?2 AND company_id = ?3"#,
        )
        .bind(&now)
        .bind(approval_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let payload_str: String = row
            .try_get("payload_json")
            .map_err(|e| LoopError::Database(e.to_string()))?;
        let payload = serde_json::from_str(&payload_str).map_err(|e| LoopError::Validation(e.to_string()))?;
        Ok((kind, payload))
    }

    pub async fn list_pending(&self, company_id: CompanyId) -> Result<Vec<PendingApproval>> {
        let rows = sqlx::query(
            r#"
            SELECT id, kind, payload_json, created_at FROM approvals
            WHERE company_id = ?1 AND status = 'pending'
            ORDER BY created_at ASC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter()
            .map(|row| {
                let id_str: String = row.try_get("id").map_err(|e| LoopError::Database(e.to_string()))?;
                let payload_str: String = row
                    .try_get("payload_json")
                    .map_err(|e| LoopError::Database(e.to_string()))?;
                Ok(PendingApproval {
                    approval_id: ApprovalId(
                        uuid::Uuid::parse_str(&id_str)
                            .map_err(|e| LoopError::Validation(e.to_string()))?,
                    ),
                    kind: row.try_get("kind").map_err(|e| LoopError::Database(e.to_string()))?,
                    payload_json: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
                    created_at: row
                        .try_get::<String, _>("created_at")
                        .map_err(|e| LoopError::Database(e.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn has_approved_strategy(&self, company_id: CompanyId, ticket_id: &str) -> Result<bool> {
        let rows = sqlx::query(
            r#"
            SELECT id FROM approvals
            WHERE company_id = ?1 AND kind = 'strategy' AND status = 'approved'
            AND payload_json LIKE '%' || ?2 || '%'
            LIMIT 1
            "#,
        )
        .bind(company_id.to_string())
        .bind(ticket_id)
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(rows.is_some())
    }

    pub async fn create_increase_budget(
        &self,
        company_id: CompanyId,
        agent_id: &str,
        new_cap_usd: f64,
    ) -> Result<ApprovalId> {
        let id = ApprovalId::new();
        let now = Utc::now();
        let payload = serde_json::json!({
            "agent_id": agent_id,
            "new_cap_usd": new_cap_usd,
        });

        sqlx::query(
            r#"
            INSERT INTO approvals (id, company_id, kind, payload_json, status, created_at)
            VALUES (?1, ?2, 'increase_budget', ?3, 'pending', ?4)
            "#,
        )
        .bind(id.to_string())
        .bind(company_id.to_string())
        .bind(payload.to_string())
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(id)
    }

    pub async fn create_strategy_approval(
        &self,
        company_id: CompanyId,
        ticket_id: &str,
    ) -> Result<ApprovalId> {
        let id = ApprovalId::new();
        let now = Utc::now();
        let payload = serde_json::json!({ "ticket_id": ticket_id });

        sqlx::query(
            r#"
            INSERT INTO approvals (id, company_id, kind, payload_json, status, created_at)
            VALUES (?1, ?2, 'strategy', ?3, 'pending', ?4)
            "#,
        )
        .bind(id.to_string())
        .bind(company_id.to_string())
        .bind(payload.to_string())
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(id)
    }
}