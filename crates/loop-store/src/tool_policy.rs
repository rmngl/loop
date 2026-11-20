use chrono::Utc;
use loop_core::error::{LoopError, Result};
use loop_core::ids::CompanyId;
use loop_core::tool_policy::ToolDisposition;
use sqlx::Row;

use crate::pool::Store;

#[derive(Debug, Clone)]
pub struct ToolPolicyRow {
    pub tool_pattern: String,
    pub disposition: ToolDisposition,
}

pub struct ToolPolicyRepository<'a> {
    store: &'a Store,
}

impl<'a> ToolPolicyRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn list(&self, company_id: CompanyId) -> Result<Vec<ToolPolicyRow>> {
        let rows = sqlx::query(
            r#"
            SELECT tool_pattern, disposition
            FROM tool_policies
            WHERE company_id = ?1
            ORDER BY tool_pattern ASC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_policy).collect()
    }

    pub async fn upsert(
        &self,
        company_id: CompanyId,
        tool_pattern: &str,
        disposition: ToolDisposition,
    ) -> Result<ToolPolicyRow> {
        let pattern = tool_pattern.trim();
        if pattern.is_empty() {
            return Err(LoopError::Validation("tool_pattern required".into()));
        }
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO tool_policies (company_id, tool_pattern, disposition, created_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(company_id, tool_pattern) DO UPDATE SET disposition = ?3
            "#,
        )
        .bind(company_id.to_string())
        .bind(pattern)
        .bind(disposition.as_str())
        .bind(&now)
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(ToolPolicyRow {
            tool_pattern: pattern.to_string(),
            disposition,
        })
    }

    pub async fn delete(&self, company_id: CompanyId, tool_pattern: &str) -> Result<()> {
        sqlx::query(r#"DELETE FROM tool_policies WHERE company_id = ?1 AND tool_pattern = ?2"#)
            .bind(company_id.to_string())
            .bind(tool_pattern)
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(())
    }

    pub async fn evaluate(
        &self,
        company_id: CompanyId,
        tool_name: &str,
    ) -> Result<(ToolDisposition, Option<String>)> {
        let policies = self.list(company_id).await?;
        let mut best: Option<(ToolDisposition, String, usize)> = None;

        for p in policies {
            if pattern_matches(&p.tool_pattern, tool_name) {
                let score = match_priority(p.disposition);
                let len = p.tool_pattern.len();
                let replace = best.as_ref().is_none_or(|(d, _, l)| {
                    score > match_priority(*d) || (score == match_priority(*d) && len > *l)
                });
                if replace {
                    best = Some((p.disposition, p.tool_pattern.clone(), len));
                }
            }
        }

        Ok(match best {
            Some((d, pat, _)) => (d, Some(pat)),
            None => (ToolDisposition::Allow, None),
        })
    }
}

fn match_priority(d: ToolDisposition) -> u8 {
    match d {
        ToolDisposition::Block => 3,
        ToolDisposition::Ask => 2,
        ToolDisposition::Allow => 1,
    }
}

fn pattern_matches(pattern: &str, tool_name: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix('*') {
        tool_name.starts_with(prefix)
    } else {
        pattern == tool_name
    }
}

fn row_to_policy(row: sqlx::sqlite::SqliteRow) -> Result<ToolPolicyRow> {
    let pattern: String = row
        .try_get("tool_pattern")
        .map_err(|e| LoopError::Database(e.to_string()))?;
    let disposition_str: String = row
        .try_get("disposition")
        .map_err(|e| LoopError::Database(e.to_string()))?;
    let disposition = ToolDisposition::parse(&disposition_str)
        .ok_or_else(|| LoopError::Database("invalid disposition".into()))?;
    Ok(ToolPolicyRow {
        tool_pattern: pattern,
        disposition,
    })
}