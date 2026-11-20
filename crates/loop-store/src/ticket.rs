use chrono::Utc;
use loop_core::domain::TicketStatus;
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, CompanyId, ProjectId, TicketId};
use serde::Serialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::pool::Store;

#[derive(Debug, Clone, Serialize)]
pub struct TicketMessage {
    pub author: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct Ticket {
    pub id: TicketId,
    pub company_id: CompanyId,
    pub project_id: Option<ProjectId>,
    pub title: String,
    pub description: String,
    pub status: TicketStatus,
    pub assignee_agent_id: Option<AgentId>,
    pub tags: Vec<String>,
}

pub struct TicketRepository<'a> {
    store: &'a Store,
}

impl<'a> TicketRepository<'a> {
    pub fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub async fn create(
        &self,
        company_id: CompanyId,
        title: &str,
        description: &str,
        tags: &[String],
        project_id: Option<ProjectId>,
    ) -> Result<Ticket> {
        let id = TicketId::new();
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO tickets (id, company_id, project_id, title, description, status, tags, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7)
            "#,
        )
        .bind(id.to_string())
        .bind(company_id.to_string())
        .bind(project_id.map(|p| p.to_string()))
        .bind(title)
        .bind(description)
        .bind(serde_json::to_string(tags).unwrap_or_else(|_| "[]".into()))
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        Ok(Ticket {
            id,
            company_id,
            project_id,
            title: title.to_string(),
            description: description.to_string(),
            status: TicketStatus::Open,
            assignee_agent_id: None,
            tags: tags.to_vec(),
        })
    }

    pub async fn list_messages(
        &self,
        company_id: CompanyId,
        ticket_id: TicketId,
    ) -> Result<Vec<TicketMessage>> {
        let rows = sqlx::query(
            r#"
            SELECT author, body, created_at FROM ticket_messages
            WHERE company_id = ?1 AND ticket_id = ?2 ORDER BY id ASC
            "#,
        )
        .bind(company_id.to_string())
        .bind(ticket_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(TicketMessage {
                    author: row
                        .try_get("author")
                        .map_err(|e| LoopError::Database(e.to_string()))?,
                    body: row
                        .try_get("body")
                        .map_err(|e| LoopError::Database(e.to_string()))?,
                    created_at: row
                        .try_get("created_at")
                        .map_err(|e| LoopError::Database(e.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn assign(
        &self,
        company_id: CompanyId,
        ticket_id: TicketId,
        agent_id: AgentId,
    ) -> Result<Ticket> {
        let result = sqlx::query(
            r#"
            UPDATE tickets
            SET assignee_agent_id = ?1, status = 'in_progress'
            WHERE id = ?2 AND company_id = ?3
            "#,
        )
        .bind(agent_id.to_string())
        .bind(ticket_id.to_string())
        .bind(company_id.to_string())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(LoopError::NotFound(format!("ticket {}", ticket_id)));
        }
        self.get(company_id, ticket_id).await
    }

    pub async fn list(&self, company_id: CompanyId) -> Result<Vec<Ticket>> {
        let rows = sqlx::query(
            r#"
            SELECT id, company_id, project_id, title, description, status, assignee_agent_id, tags
            FROM tickets WHERE company_id = ?1 ORDER BY created_at DESC
            "#,
        )
        .bind(company_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter().map(row_to_ticket).collect()
    }

    pub async fn get(&self, company_id: CompanyId, ticket_id: TicketId) -> Result<Ticket> {
        let row = sqlx::query(
            r#"
            SELECT id, company_id, project_id, title, description, status, assignee_agent_id, tags
            FROM tickets WHERE id = ?1 AND company_id = ?2
            "#,
        )
        .bind(ticket_id.to_string())
        .bind(company_id.to_string())
        .fetch_optional(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?
        .ok_or_else(|| LoopError::NotFound(format!("ticket {}", ticket_id)))?;

        row_to_ticket(row)
    }

    pub async fn append_message(
        &self,
        company_id: CompanyId,
        ticket_id: TicketId,
        author: &str,
        body: &str,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO ticket_messages (company_id, ticket_id, author, body, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(company_id.to_string())
        .bind(ticket_id.to_string())
        .bind(author)
        .bind(body)
        .bind(now.to_rfc3339())
        .execute(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;
        Ok(())
    }

    pub async fn append_trace_events(
        &self,
        company_id: CompanyId,
        ticket_id: TicketId,
        events: &[loop_core::adapter::TraceEvent],
    ) -> Result<()> {
        for ev in events {
            sqlx::query(
                r#"
                INSERT INTO trace_events (company_id, ticket_id, name, detail_json, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
            )
            .bind(company_id.to_string())
            .bind(ticket_id.to_string())
            .bind(&ev.name)
            .bind(ev.detail_json.to_string())
            .bind(ev.at.to_rfc3339())
            .execute(self.store.pool())
            .await
            .map_err(|e| LoopError::Database(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn list_traces(
        &self,
        company_id: CompanyId,
        ticket_id: TicketId,
    ) -> Result<Vec<loop_core::adapter::TraceEvent>> {
        let rows = sqlx::query(
            r#"
            SELECT name, detail_json, created_at FROM trace_events
            WHERE company_id = ?1 AND ticket_id = ?2 ORDER BY id ASC
            "#,
        )
        .bind(company_id.to_string())
        .bind(ticket_id.to_string())
        .fetch_all(self.store.pool())
        .await
        .map_err(|e| LoopError::Database(e.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(loop_core::adapter::TraceEvent {
                    name: row.try_get("name").map_err(|e| LoopError::Database(e.to_string()))?,
                    detail_json: serde_json::from_str(
                        &row.try_get::<String, _>("detail_json")
                            .map_err(|e| LoopError::Database(e.to_string()))?,
                    )
                    .unwrap_or(json!({})),
                    at: chrono::DateTime::parse_from_rfc3339(
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

fn row_to_ticket(row: sqlx::sqlite::SqliteRow) -> Result<Ticket> {
    let tags_str: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
    let status_str: String = row.try_get("status").map_err(|e| LoopError::Database(e.to_string()))?;
    let status = match status_str.as_str() {
        "open" => TicketStatus::Open,
        "in_progress" => TicketStatus::InProgress,
        "done" => TicketStatus::Done,
        "blocked" => TicketStatus::Blocked,
        _ => TicketStatus::Open,
    };
    let assignee: Option<String> = row.try_get("assignee_agent_id").ok();
    let project: Option<String> = row.try_get("project_id").ok();

    Ok(Ticket {
        id: TicketId(
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
        project_id: project
            .filter(|s| !s.is_empty())
            .map(|s| Uuid::parse_str(&s).map(ProjectId))
            .transpose()
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        title: row.try_get("title").map_err(|e| LoopError::Database(e.to_string()))?,
        description: row
            .try_get("description")
            .map_err(|e| LoopError::Database(e.to_string()))?,
        status,
        assignee_agent_id: assignee
            .filter(|s| !s.is_empty())
            .map(|s| Uuid::parse_str(&s).map(AgentId))
            .transpose()
            .map_err(|e| LoopError::Validation(e.to_string()))?,
        tags,
    })
}