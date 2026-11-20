use chrono::Utc;
use loop_core::domain::Company;
use loop_core::error::{LoopError, Result};
use loop_core::ids::CompanyId;
use loop_core::paths::ensure_company_workspace;
use sqlx::Row;
use uuid::Uuid;

use crate::pool::Store;

pub struct CompanyRepository<'a> {
    store: &'a Store,
}

impl<'a> CompanyRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn create(&self, name: &str, mission: &str) -> Result<Company> {
        let id = CompanyId::new();
        let now = Utc::now();
        ensure_company_workspace(id).map_err(LoopError::Io)?;
        sqlx::query(
            r#"
            INSERT INTO companies (id, name, mission, created_at)
            VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(id.to_string())
        .bind(name)
        .bind(mission)
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(Company {
            id,
            name: name.to_string(),
            mission: mission.to_string(),
            monthly_budget_usd: None,
            archived_at: None,
            created_at: now,
        })
    }

    pub async fn list(&self) -> Result<Vec<Company>> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, mission, monthly_budget_usd, archived_at, created_at
            FROM companies
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_company).collect()
    }

    pub async fn get(&self, company_id: CompanyId) -> Result<Company> {
        let row = sqlx::query(
            r#"
            SELECT id, name, mission, monthly_budget_usd, archived_at, created_at
            FROM companies WHERE id = ?1
            "#,
        )
        .bind(company_id.to_string())
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?
        .ok_or_else(|| LoopError::NotFound(format!("company {}", company_id)))?;

        row_to_company(row)
    }

    pub async fn update_mission(&self, company_id: CompanyId, mission: &str) -> Result<Company> {
        let result = sqlx::query(r#"UPDATE companies SET mission = ?1 WHERE id = ?2"#)
            .bind(mission)
            .bind(company_id.to_string())
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound(format!("company {}", company_id)));
        }
        self.get(company_id).await
    }

    pub async fn update_monthly_budget(
        &self,
        company_id: CompanyId,
        cap: Option<f64>,
    ) -> Result<Company> {
        if let Some(v) = cap {
            if v < 0.0 {
                return Err(LoopError::Validation("monthly_budget_usd must be >= 0".into()));
            }
        }
        let result = sqlx::query(r#"UPDATE companies SET monthly_budget_usd = ?1 WHERE id = ?2"#)
            .bind(cap)
            .bind(company_id.to_string())
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound(format!("company {}", company_id)));
        }
        self.get(company_id).await
    }

    pub async fn archive(&self, company_id: CompanyId) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(r#"UPDATE companies SET archived_at = ?1 WHERE id = ?2"#)
            .bind(&now)
            .bind(company_id.to_string())
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound(format!("company {}", company_id)));
        }
        Ok(())
    }
}

fn row_to_company(row: sqlx::sqlite::SqliteRow) -> Result<Company> {
    let id_str: String = row.try_get("id").map_err(|e| LoopError::Database(e.to_string()))?;
    let id = CompanyId(Uuid::parse_str(&id_str).map_err(|e| LoopError::Validation(e.to_string()))?);
    let archived_at: Option<String> = row.try_get("archived_at").ok();
    let monthly_budget_usd: Option<f64> = row
        .try_get::<Option<f64>, _>("monthly_budget_usd")
        .map_err(|e| LoopError::Database(e.to_string()))?;
    Ok(Company {
        id,
        name: row.try_get("name").map_err(|e| LoopError::Database(e.to_string()))?,
        mission: row.try_get("mission").map_err(|e| LoopError::Database(e.to_string()))?,
        monthly_budget_usd,
        archived_at: archived_at
            .filter(|s| !s.is_empty())
            .map(|s| chrono::DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)))
            .transpose()
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        created_at: chrono::DateTime::parse_from_rfc3339(
            &row.try_get::<String, _>("created_at")
                .map_err(|e| LoopError::Database(e.to_string()))?,
        )
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| LoopError::Validation(e.to_string()))?,
    })
}