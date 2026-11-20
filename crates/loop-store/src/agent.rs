use chrono::{Datelike, Utc};
use loop_core::domain::{AdapterKind, Agent, AgentStatus};
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, ApprovalId, CompanyId};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::pool::Store;

#[derive(Debug, Clone, Deserialize)]
pub struct HireAgentRequest {
    pub title: String,
    pub adapter_kind: AdapterKind,
    pub adapter_config: serde_json::Value,
    pub cron: String,
    pub monthly_budget_usd: f64,
    pub parent_agent_id: Option<AgentId>,
}

pub struct AgentRepository<'a> {
    store: &'a Store,
}

impl<'a> AgentRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn create_pending(
        &self,
        company_id: CompanyId,
        req: &HireAgentRequest,
    ) -> Result<(Agent, ApprovalId)> {
        croner::Cron::new(req.cron.as_str())
            .parse()
            .map_err(|e| LoopError::Validation(format!("invalid cron: {e}")))?;

        let agent_id = AgentId::new();
        let approval_id = ApprovalId::new();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO agents (
                id, company_id, title, adapter_kind, adapter_config, cron,
                monthly_budget_usd, parent_agent_id, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)
            "#,
        )
        .bind(agent_id.to_string())
        .bind(company_id.to_string())
        .bind(&req.title)
        .bind(adapter_kind_str(&req.adapter_kind))
        .bind(req.adapter_config.to_string())
        .bind(&req.cron)
        .bind(req.monthly_budget_usd)
        .bind(req.parent_agent_id.map(|a| a.to_string()))
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let payload = serde_json::json!({
            "agent_id": agent_id.to_string(),
            "title": req.title,
        });

        sqlx::query(
            r#"
            INSERT INTO approvals (id, company_id, kind, payload_json, status, created_at)
            VALUES (?1, ?2, 'create_agent', ?3, 'pending', ?4)
            "#,
        )
        .bind(approval_id.to_string())
        .bind(company_id.to_string())
        .bind(payload.to_string())
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let agent = Agent {
            id: agent_id,
            company_id,
            title: req.title.clone(),
            adapter_kind: req.adapter_kind.clone(),
            adapter_config: req.adapter_config.clone(),
            cron: req.cron.clone(),
            monthly_budget_usd: req.monthly_budget_usd,
            parent_agent_id: req.parent_agent_id,
            status: AgentStatus::Pending,
            paused_reason: None,
        };

        Ok((agent, approval_id))
    }

    pub async fn activate_after_approval(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
    ) -> Result<()> {
        let result = sqlx::query(
            r#"
            UPDATE agents SET status = 'active', paused_reason = NULL
            WHERE id = ?1 AND company_id = ?2 AND status = 'pending'
            "#,
        )
        .bind(agent_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound(format!("pending agent {}", agent_id)));
        }

        let now = Utc::now();
        let (year, month) = (now.year(), now.month() as i32);
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
            ON CONFLICT DO NOTHING
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

        Ok(())
    }

    pub async fn get(&self, company_id: CompanyId, agent_id: AgentId) -> Result<Agent> {
        let row = sqlx::query(
            r#"
            SELECT id, company_id, title, adapter_kind, adapter_config, cron,
                   monthly_budget_usd, parent_agent_id, status, paused_reason
            FROM agents WHERE id = ?1 AND company_id = ?2
            "#,
        )
        .bind(agent_id.to_string())
        .bind(company_id.to_string())
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?
        .ok_or_else(|| LoopError::NotFound(format!("agent {}", agent_id)))?;

        row_to_agent(row)
    }

    pub async fn list(&self, company_id: CompanyId) -> Result<Vec<Agent>> {
        let rows = sqlx::query(
            r#"
            SELECT id, company_id, title, adapter_kind, adapter_config, cron,
                   monthly_budget_usd, parent_agent_id, status, paused_reason
            FROM agents WHERE company_id = ?1 ORDER BY created_at ASC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_agent).collect()
    }

    pub async fn list_active(&self, company_id: CompanyId) -> Result<Vec<Agent>> {
        let rows = sqlx::query(
            r#"
            SELECT id, company_id, title, adapter_kind, adapter_config, cron,
                   monthly_budget_usd, parent_agent_id, status, paused_reason
            FROM agents WHERE company_id = ?1 AND status = 'active'
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_agent).collect()
    }

    pub async fn apply_budget_override(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
        new_cap_usd: f64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE agents SET monthly_budget_usd = ?1, paused_reason = NULL
            WHERE id = ?2 AND company_id = ?3
            "#,
        )
        .bind(new_cap_usd)
        .bind(agent_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        let now = Utc::now();
        sqlx::query(
            r#"
            UPDATE budget_periods SET cap_usd = ?1
            WHERE company_id = ?2 AND agent_id = ?3 AND year = ?4 AND month = ?5
            "#,
        )
        .bind(new_cap_usd)
        .bind(company_id.to_string())
        .bind(agent_id.to_string())
        .bind(now.year())
        .bind(now.month() as i32)
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(())
    }

    pub async fn set_paused_reason(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
        reason: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"UPDATE agents SET paused_reason = ?1 WHERE id = ?2 AND company_id = ?3"#,
        )
        .bind(reason)
        .bind(agent_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(())
    }
}

fn adapter_kind_str(k: &AdapterKind) -> &'static str {
    match k {
        AdapterKind::Hermes => "hermes",
        AdapterKind::Process => "process",
        AdapterKind::Mock => "mock",
        AdapterKind::Webhook => "webhook",
    }
}

fn parse_adapter_kind(s: &str) -> Result<AdapterKind> {
    match s {
        "hermes" => Ok(AdapterKind::Hermes),
        "process" => Ok(AdapterKind::Process),
        "mock" => Ok(AdapterKind::Mock),
        "webhook" => Ok(AdapterKind::Webhook),
        _ => Err(LoopError::Validation(format!("unknown adapter kind: {s}"))),
    }
}

fn parse_status(s: &str) -> Result<AgentStatus> {
    match s {
        "pending" => Ok(AgentStatus::Pending),
        "active" => Ok(AgentStatus::Active),
        "paused" => Ok(AgentStatus::Paused),
        _ => Err(LoopError::Validation(format!("unknown agent status: {s}"))),
    }
}

fn row_to_agent(row: sqlx::sqlite::SqliteRow) -> Result<Agent> {
    let company_id = CompanyId(
        Uuid::parse_str(
            &row.try_get::<String, _>("company_id")
                .map_err(|e| LoopError::Database(e.to_string()))?,
        )
        .map_err(|e| LoopError::Validation(e.to_string()))?,
    );
    let id = AgentId(
        Uuid::parse_str(
            &row.try_get::<String, _>("id")
                .map_err(|e| LoopError::Database(e.to_string()))?,
        )
        .map_err(|e| LoopError::Validation(e.to_string()))?,
    );
    let parent: Option<String> = row.try_get("parent_agent_id").ok();
    let config_str: String = row
        .try_get("adapter_config")
        .map_err(|e| LoopError::Database(e.to_string()))?;

    Ok(Agent {
        id,
        company_id,
        title: row.try_get("title").map_err(|e| LoopError::Database(e.to_string()))?,
        adapter_kind: parse_adapter_kind(
            &row.try_get::<String, _>("adapter_kind")
                .map_err(|e| LoopError::Database(e.to_string()))?,
        )?,
        adapter_config: serde_json::from_str(&config_str)
            .unwrap_or(serde_json::Value::Object(Default::default())),
        cron: row.try_get("cron").map_err(|e| LoopError::Database(e.to_string()))?,
        monthly_budget_usd: row
            .try_get("monthly_budget_usd")
            .map_err(|e| LoopError::Database(e.to_string()))?,
        parent_agent_id: parent
            .filter(|s| !s.is_empty())
            .map(|s| Uuid::parse_str(&s).map(AgentId))
            .transpose()
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        status: parse_status(
            &row.try_get::<String, _>("status")
                .map_err(|e| LoopError::Database(e.to_string()))?,
        )?,
        paused_reason: row
            .try_get::<Option<String>, _>("paused_reason")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty()),
    })
}