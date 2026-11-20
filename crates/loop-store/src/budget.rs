use chrono::{Datelike, Utc};
use loop_core::domain::BudgetStatus;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, CompanyId};
use sqlx::Row;

use crate::pool::Store;

pub struct BudgetRepository<'a> {
    store: &'a Store,
}

impl<'a> BudgetRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn record_spend(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
        usd: f64,
    ) -> Result<BudgetStatus> {
        let now = Utc::now();
        let year = now.year();
        let month = now.month() as i32;

        let row = sqlx::query(
            r#"
            SELECT used_usd, cap_usd FROM budget_periods
            WHERE company_id = ?1 AND agent_id = ?2 AND year = ?3 AND month = ?4
            "#,
        )
        .bind(company_id.to_string())
        .bind(agent_id.to_string())
        .bind(year)
        .bind(month)
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let (mut used, cap) = if let Some(r) = row {
            (
                r.try_get::<f64, _>("used_usd")
                    .map_err(|e| LoopError::Database(e.to_string()))?,
                r.try_get::<f64, _>("cap_usd")
                    .map_err(|e| LoopError::Database(e.to_string()))?,
            )
        } else {
            let cap: f64 = sqlx::query_scalar(
                r#"SELECT monthly_budget_usd FROM agents WHERE id = ?1 AND company_id = ?2"#,
            )
            .bind(agent_id.to_string())
            .bind(company_id.to_string())
            .fetch_one(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO budget_periods (company_id, agent_id, year, month, used_usd, cap_usd)
                VALUES (?1, ?2, ?3, ?4, 0, ?5)
                "#,
            )
            .bind(company_id.to_string())
            .bind(agent_id.to_string())
            .bind(year)
            .bind(month)
            .bind(cap)
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
            (0.0, cap)
        };

        used += usd;
        sqlx::query(
            r#"
            UPDATE budget_periods SET used_usd = ?1
            WHERE company_id = ?2 AND agent_id = ?3 AND year = ?4 AND month = ?5
            "#,
        )
        .bind(used)
        .bind(company_id.to_string())
        .bind(agent_id.to_string())
        .bind(year)
        .bind(month)
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let ratio = if cap > 0.0 { used / cap } else { 0.0 };
        let warn = ratio >= 0.8 && ratio < 1.0;
        let exhausted = ratio >= 1.0;

        if exhausted {
            sqlx::query(
                r#"UPDATE agents SET paused_reason = 'budget' WHERE id = ?1 AND company_id = ?2"#,
            )
            .bind(agent_id.to_string())
            .bind(company_id.to_string())
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        }

        Ok(BudgetStatus {
            used_usd: used,
            cap_usd: cap,
            warn,
            exhausted,
        })
    }

    pub async fn remaining_usd(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
    ) -> Result<f64> {
        let now = Utc::now();
        let row = sqlx::query(
            r#"
            SELECT used_usd, cap_usd FROM budget_periods
            WHERE company_id = ?1 AND agent_id = ?2 AND year = ?3 AND month = ?4
            "#,
        )
        .bind(company_id.to_string())
        .bind(agent_id.to_string())
        .bind(now.year())
        .bind(now.month() as i32)
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        if let Some(r) = row {
            let used: f64 = r.try_get("used_usd").map_err(|e| LoopError::Database(e.to_string()))?;
            let cap: f64 = r.try_get("cap_usd").map_err(|e| LoopError::Database(e.to_string()))?;
            Ok((cap - used).max(0.0))
        } else {
            let cap: f64 = sqlx::query_scalar(
                r#"SELECT monthly_budget_usd FROM agents WHERE id = ?1 AND company_id = ?2"#,
            )
            .bind(agent_id.to_string())
            .bind(company_id.to_string())
            .fetch_one(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
            Ok(cap)
        }
    }

    /// Sum of agent `used_usd` for the current calendar month within one company.
    pub async fn company_used_usd(&self, company_id: CompanyId) -> Result<f64> {
        let now = Utc::now();
        let sum: Option<f64> = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(used_usd), 0)
            FROM budget_periods
            WHERE company_id = ?1 AND year = ?2 AND month = ?3
            "#,
        )
        .bind(company_id.to_string())
        .bind(now.year())
        .bind(now.month() as i32)
        .fetch_one(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(sum.unwrap_or(0.0))
    }

    /// When the company has a monthly cap, returns spend status for the org (80% warn, 100% stop).
    pub async fn company_cap_status(
        &self,
        company_id: CompanyId,
        cap: f64,
    ) -> Result<BudgetStatus> {
        let used = self.company_used_usd(company_id).await?;
        let ratio = if cap > 0.0 { used / cap } else { 0.0 };
        Ok(BudgetStatus {
            used_usd: used,
            cap_usd: cap,
            warn: ratio >= 0.8 && ratio < 1.0,
            exhausted: ratio >= 1.0,
        })
    }

    pub async fn company_has_room(&self, company_id: CompanyId, cap: Option<f64>) -> Result<bool> {
        let Some(cap) = cap else {
            return Ok(true);
        };
        if cap <= 0.0 {
            return Ok(false);
        }
        let used = self.company_used_usd(company_id).await?;
        Ok(used < cap)
    }
}