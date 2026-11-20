use chrono::Utc;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{CompanyId, ProjectId};
use sqlx::Row;
use uuid::Uuid;

use crate::pool::Store;

#[derive(Debug, Clone)]
pub struct Project {
    pub id: ProjectId,
    pub company_id: CompanyId,
    pub name: String,
    pub goal: String,
}

pub struct ProjectRepository<'a> {
    store: &'a Store,
}

impl<'a> ProjectRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn create(
        &self,
        company_id: CompanyId,
        name: &str,
        goal: &str,
    ) -> Result<Project> {
        let id = ProjectId::new();
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO projects (id, company_id, name, goal, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id.to_string())
        .bind(company_id.to_string())
        .bind(name)
        .bind(goal)
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(Project {
            id,
            company_id,
            name: name.to_string(),
            goal: goal.to_string(),
        })
    }

    pub async fn list(&self, company_id: CompanyId) -> Result<Vec<Project>> {
        let rows = sqlx::query(
            r#"
            SELECT id, company_id, name, goal FROM projects
            WHERE company_id = ?1 ORDER BY created_at ASC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_project).collect()
    }

    pub async fn get(&self, company_id: CompanyId, project_id: ProjectId) -> Result<Project> {
        let row = sqlx::query(
            r#"
            SELECT id, company_id, name, goal FROM projects
            WHERE id = ?1 AND company_id = ?2
            "#,
        )
        .bind(project_id.to_string())
        .bind(company_id.to_string())
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?
        .ok_or_else(|| LoopError::NotFound(format!("project {}", project_id)))?;

        row_to_project(row)
    }
}

fn row_to_project(row: sqlx::sqlite::SqliteRow) -> Result<Project> {
    Ok(Project {
        id: ProjectId(
            Uuid::parse_str(
                &row.try_get::<String, _>("id")
                    .map_err(|e| LoopError::Database(e.to_string()))?,
            )
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        ),
        company_id: CompanyId(
            Uuid::parse_str(
                &row.try_get::<String, _>("company_id")
                    .map_err(|e| LoopError::Database(e.to_string()))?,
            )
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        ),
        name: row
            .try_get("name")
            .map_err(|e| LoopError::Database(e.to_string()))?,
        goal: row
            .try_get("goal")
            .map_err(|e| LoopError::Database(e.to_string()))?,
    })
}