use chrono::Utc;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AuditEntryId, CompanyId};
use serde_json::Value;
use sqlx::Row;

use crate::pool::Store;

#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub id: AuditEntryId,
    pub company_id: CompanyId,
    pub kind: String,
    pub payload_json: Value,
    pub created_at: chrono::DateTime<Utc>,
}

pub struct AuditLog<'a> {
    store: &'a Store,
}

impl<'a> AuditLog<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn append(
        &self,
        company_id: CompanyId,
        kind: &str,
        payload_json: Value,
    ) -> Result<AuditEntryId> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"
            INSERT INTO audit_entries (company_id, kind, payload_json, created_at)
            VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(company_id.to_string())
        .bind(kind)
        .bind(payload_json.to_string())
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(AuditEntryId(result.last_insert_rowid()))
    }

    pub async fn list(&self, company_id: CompanyId) -> Result<Vec<AuditEntry>> {
        let rows = sqlx::query(
            r#"
            SELECT id, company_id, kind, payload_json, created_at
            FROM audit_entries WHERE company_id = ?1 ORDER BY id ASC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(AuditEntry {
                    id: AuditEntryId(
                        row.try_get::<i64, _>("id")
                            .map_err(|e| LoopError::Database(e.to_string()))?,
                    ),
                    company_id,
                    kind: row.try_get("kind").map_err(|e| LoopError::Database(e.to_string()))?,
                    payload_json: serde_json::from_str(
                        &row.try_get::<String, _>("payload_json")
                            .map_err(|e| LoopError::Database(e.to_string()))?,
                    )
                    .unwrap_or(Value::Null),
                    created_at: chrono::DateTime::parse_from_rfc3339(
                        &row.try_get::<String, _>("created_at")
                            .map_err(|e| LoopError::Database(e.to_string()))?,
                    )
                    .map(|d| d.with_timezone(&Utc))
                    .map_err(|e| LoopError::Validation(e.to_string()))?,
                })
            })
            .collect()
    }
}