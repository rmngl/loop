use chrono::Utc;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, CompanyId};
use sqlx::Row;
use uuid::Uuid;

use crate::pool::Store;

#[derive(Debug, Clone, Copy)]
pub struct ToolUseGrantId(uuid::Uuid);

impl ToolUseGrantId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }

    pub fn to_string(self) -> String {
        self.0.to_string()
    }
}

pub struct ToolGrantRepository<'a> {
    store: &'a Store,
}

impl<'a> ToolGrantRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn create(
        &self,
        company_id: CompanyId,
        tool_name: &str,
        agent_id: Option<AgentId>,
    ) -> Result<ToolUseGrantId> {
        let id = ToolUseGrantId::new();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO tool_use_grants (id, company_id, tool_name, agent_id, used_at, created_at)
            VALUES (?1, ?2, ?3, ?4, NULL, ?5)
            "#,
        )
        .bind(id.to_string())
        .bind(company_id.to_string())
        .bind(tool_name)
        .bind(agent_id.map(|a| a.to_string()))
        .bind(&now)
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(id)
    }

    pub async fn has_unused(
        &self,
        company_id: CompanyId,
        tool_name: &str,
        agent_id: Option<AgentId>,
    ) -> Result<Option<ToolUseGrantId>> {
        let rows = sqlx::query(
            r#"
            SELECT id, agent_id FROM tool_use_grants
            WHERE company_id = ?1 AND tool_name = ?2 AND used_at IS NULL
            "#,
        )
        .bind(company_id.to_string())
        .bind(tool_name)
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        for row in rows {
            let id_str: String = row.try_get("id").map_err(|e| LoopError::Database(e.to_string()))?;
            let grant_agent: Option<String> = row.try_get("agent_id").ok();
            if agent_id_matches(&grant_agent, agent_id) {
                let uuid = Uuid::parse_str(&id_str).map_err(|e| LoopError::Database(e.to_string()))?;
                return Ok(Some(ToolUseGrantId(uuid)));
            }
        }
        Ok(None)
    }

    pub async fn consume(&self, company_id: CompanyId, grant_id: ToolUseGrantId) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            r#"
            UPDATE tool_use_grants SET used_at = ?1
            WHERE id = ?2 AND company_id = ?3 AND used_at IS NULL
            "#,
        )
        .bind(&now)
        .bind(grant_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound("grant not found or already used".into()));
        }
        Ok(())
    }
}

fn agent_id_matches(grant_agent: &Option<String>, request: Option<AgentId>) -> bool {
    match (grant_agent.as_deref().filter(|s| !s.is_empty()), request) {
        (None, _) => true,
        (Some(g), Some(a)) => g == a.to_string(),
        (Some(_), None) => false,
    }
}