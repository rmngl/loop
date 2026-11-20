use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use loop_core::domain::{AdapterKind, AgentStatus, TicketStatus};
use loop_core::error::LoopError;
use loop_core::ids::{AgentId, ApprovalId, CompanyId, ProjectId, TicketId};
use loop_core::tool_policy::ToolDisposition;
use loop_store::{
    AgentRepository, ApprovalRepository, AuditLog, BudgetRepository, CompanyRepository,
    HireAgentRequest, ProjectRepository, TicketRepository, ToolGrantRepository,
    ToolPolicyRepository, ToolUseGrantId,
};
use loop_policy::{PolicyEngine, ToolGateway};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health))
        .route("/v1/companies", post(create_company).get(list_companies))
        .route(
            "/v1/companies/{company_id}",
            get(get_company)
                .patch(patch_company)
                .post(archive_company),
        )
        .route(
            "/v1/companies/{company_id}/projects",
            get(list_projects).post(create_project),
        )
        .route("/v1/companies/{company_id}/dashboard", get(dashboard))
        .route(
            "/v1/companies/{company_id}/agents",
            post(hire_agent).get(list_agents),
        )
        .route(
            "/v1/companies/{company_id}/approvals",
            get(list_pending_approvals),
        )
        .route(
            "/v1/companies/{company_id}/approvals/{approval_id}/approve",
            post(approve),
        )
        .route(
            "/v1/companies/{company_id}/tickets",
            post(create_ticket).get(list_tickets),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}",
            get(get_ticket),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/assign",
            post(assign_ticket),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/reviewer",
            post(set_ticket_reviewer),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/submit-review",
            post(submit_ticket_review),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/approve-done",
            post(approve_ticket_done),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/request-changes",
            post(request_ticket_changes),
        )
        .route(
            "/v1/companies/{company_id}/tickets/{ticket_id}/messages",
            get(list_ticket_messages).post(post_ticket_message),
        )
        .route(
            "/v1/companies/{company_id}/agents/{agent_id}/budget-increase",
            post(request_budget_increase),
        )
        .route(
            "/v1/companies/{company_id}/agents/{agent_id}/heartbeat",
            post(trigger_heartbeat),
        )
        .route("/v1/companies/{company_id}/budgets", get(list_budgets))
        .route("/v1/companies/{company_id}/audit", get(list_audit))
        .route(
            "/v1/companies/{company_id}/tool-policies",
            get(list_tool_policies).post(upsert_tool_policy),
        )
        .route(
            "/v1/companies/{company_id}/tool-policies/remove",
            post(remove_tool_policy),
        )
        .route(
            "/v1/companies/{company_id}/tools/evaluate",
            post(evaluate_tool),
        )
        .route(
            "/v1/companies/{company_id}/tools/request-use",
            post(request_tool_use),
        )
        .route(
            "/v1/companies/{company_id}/tools/consume",
            post(consume_tool_grant),
        )
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
struct CreateCompanyBody {
    name: String,
    mission: String,
}

#[derive(Serialize)]
struct CompanyResponse {
    id: String,
    name: String,
    mission: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    monthly_budget_usd: Option<f64>,
    archived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    archived_at: Option<String>,
}

fn company_to_response(c: loop_core::domain::Company) -> CompanyResponse {
    CompanyResponse {
        id: c.id.to_string(),
        name: c.name,
        mission: c.mission,
        monthly_budget_usd: c.monthly_budget_usd,
        archived: c.archived_at.is_some(),
        archived_at: c.archived_at.map(|d| d.to_rfc3339()),
    }
}

async fn create_company(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateCompanyBody>,
) -> Result<Json<CompanyResponse>, AppError> {
    let company = CompanyRepository::new(&state.store)
        .create(&body.name, &body.mission)
        .await?;
    AuditLog::new(&state.store)
        .append(
            company.id,
            "company_created",
            serde_json::json!({ "name": body.name }),
        )
        .await?;
    Ok(Json(company_to_response(company)))
}

async fn list_companies(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<CompanyResponse>>, AppError> {
    let list = CompanyRepository::new(&state.store).list().await?;
    Ok(Json(
        list.into_iter().map(company_to_response).collect::<Vec<_>>(),
    ))
}

async fn get_company(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<CompanyResponse>, AppError> {
    let id = parse_company(&company_id)?;
    let c = CompanyRepository::new(&state.store).get(id).await?;
    Ok(Json(company_to_response(c)))
}

#[derive(Deserialize)]
struct HireAgentBody {
    title: String,
    adapter_kind: String,
    adapter_config: Option<serde_json::Value>,
    cron: String,
    monthly_budget_usd: f64,
    parent_agent_id: Option<String>,
}

async fn hire_agent(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<HireAgentBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let kind = match body.adapter_kind.as_str() {
        "hermes" => AdapterKind::Hermes,
        "process" => AdapterKind::Process,
        "mock" => AdapterKind::Mock,
        "webhook" => AdapterKind::Webhook,
        _ => return Err(AppError(LoopError::Validation("unknown adapter_kind".into()))),
    };
    let parent_agent_id = match body.parent_agent_id {
        Some(ref s) if !s.is_empty() => Some(loop_core::ids::AgentId(
            Uuid::parse_str(s).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
        )),
        _ => None,
    };
    let (agent, approval_id) = AgentRepository::new(&state.store)
        .create_pending(
            company_id,
            &HireAgentRequest {
                title: body.title,
                adapter_kind: kind,
                adapter_config: body.adapter_config.unwrap_or(serde_json::json!({})),
                cron: body.cron,
                monthly_budget_usd: body.monthly_budget_usd,
                parent_agent_id,
            },
        )
        .await?;
    Ok(Json(serde_json::json!({
        "agent_id": agent.id.to_string(),
        "approval_id": approval_id.to_string(),
        "status": "pending"
    })))
}

async fn approve(
    State(state): State<Arc<AppState>>,
    Path((company_id, approval_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let approval_id = ApprovalId(Uuid::parse_str(&approval_id).map_err(|e| {
        AppError(LoopError::Validation(e.to_string()))
    })?);

    let (kind, payload) = ApprovalRepository::new(&state.store)
        .approve(company_id, approval_id)
        .await?;

    PolicyEngine::new(
        ApprovalRepository::new(&state.store),
        AuditLog::new(&state.store),
    )
    .record_approval_resolution(company_id, &kind, &approval_id.to_string())
    .await?;

    if kind == "create_agent" {
        if let Some(agent_id) = payload.get("agent_id").and_then(|v| v.as_str()) {
            let agent_id = loop_core::ids::AgentId(
                Uuid::parse_str(agent_id)
                    .map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
            );
            AgentRepository::new(&state.store)
                .activate_after_approval(company_id, agent_id)
                .await?;
        }
    } else if kind == "increase_budget" {
        let agent_id = payload
            .get("agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError(LoopError::Validation("missing agent_id".into())))?;
        let new_cap = payload
            .get("new_cap_usd")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| AppError(LoopError::Validation("missing new_cap_usd".into())))?;
        let agent_id = loop_core::ids::AgentId(
            Uuid::parse_str(agent_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
        );
        AgentRepository::new(&state.store)
            .apply_budget_override(company_id, agent_id, new_cap)
            .await?;
    } else if kind == "tool_use" {
        let tool = payload
            .get("tool")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError(LoopError::Validation("missing tool".into())))?;
        let agent_id = payload.get("agent_id").and_then(|v| {
            v.as_str()
                .filter(|s| !s.is_empty())
                .map(|s| Uuid::parse_str(s))
        });
        let agent_id = match agent_id {
            Some(Ok(u)) => Some(AgentId(u)),
            Some(Err(e)) => return Err(AppError(LoopError::Validation(e.to_string()))),
            None => None,
        };
        let grant_id = ToolGrantRepository::new(&state.store)
            .create(company_id, tool, agent_id)
            .await?;
        AuditLog::new(&state.store)
            .append(
                company_id,
                "tool_use_granted",
                serde_json::json!({
                    "grant_id": grant_id.to_string(),
                    "tool": tool,
                    "agent_id": agent_id.map(|a| a.to_string()),
                    "approval_id": approval_id.to_string(),
                }),
            )
            .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_pending_approvals(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let pending = ApprovalRepository::new(&state.store)
        .list_pending(company_id)
        .await?;
    Ok(Json(serde_json::json!({
        "approvals": pending.iter().map(|a| serde_json::json!({
            "approval_id": a.approval_id.to_string(),
            "kind": a.kind,
            "payload": a.payload_json,
            "created_at": a.created_at,
        })).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
struct CreateTicketBody {
    title: String,
    description: Option<String>,
    tags: Option<Vec<String>>,
    project_id: Option<String>,
}

fn ticket_status_str(s: &TicketStatus) -> &'static str {
    match s {
        TicketStatus::Open => "open",
        TicketStatus::InProgress => "in_progress",
        TicketStatus::InReview => "in_review",
        TicketStatus::Done => "done",
        TicketStatus::Blocked => "blocked",
    }
}

async fn list_agents(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let agents = AgentRepository::new(&state.store).list(company_id).await?;
    Ok(Json(serde_json::json!({
        "agents": agents.iter().map(|a| serde_json::json!({
            "agent_id": a.id.to_string(),
            "title": a.title,
            "adapter_kind": adapter_kind_api(&a.adapter_kind),
            "status": agent_status_api(&a.status),
            "cron": a.cron,
            "monthly_budget_usd": a.monthly_budget_usd,
            "parent_agent_id": a.parent_agent_id.map(|p| p.to_string()),
            "paused_reason": a.paused_reason,
        })).collect::<Vec<_>>()
    })))
}

async fn list_tickets(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let tickets = TicketRepository::new(&state.store).list(company_id).await?;
    Ok(Json(serde_json::json!({
        "tickets": tickets.iter().map(|t| serde_json::json!({
            "ticket_id": t.id.to_string(),
            "project_id": t.project_id.map(|p| p.to_string()),
            "title": t.title,
            "status": ticket_status_str(&t.status),
            "assignee_agent_id": t.assignee_agent_id.map(|a| a.to_string()),
            "reviewer_agent_id": t.reviewer_agent_id.map(|a| a.to_string()),
            "tags": t.tags,
        })).collect::<Vec<_>>()
    })))
}

async fn get_ticket(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = loop_core::ids::TicketId(
        Uuid::parse_str(&ticket_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );
    let ticket = TicketRepository::new(&state.store)
        .get(company_id, ticket_id)
        .await?;
    let repo = TicketRepository::new(&state.store);
    let traces = repo.list_traces(company_id, ticket_id).await?;
    let messages = repo.list_messages(company_id, ticket_id).await?;
    Ok(Json(serde_json::json!({
        "ticket": {
            "ticket_id": ticket.id.to_string(),
            "project_id": ticket.project_id.map(|p| p.to_string()),
            "title": ticket.title,
            "description": ticket.description,
            "status": ticket_status_str(&ticket.status),
            "assignee_agent_id": ticket.assignee_agent_id.map(|a| a.to_string()),
            "reviewer_agent_id": ticket.reviewer_agent_id.map(|a| a.to_string()),
            "tags": ticket.tags,
        },
        "messages": messages,
        "traces": traces,
    })))
}

async fn create_ticket(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<CreateTicketBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let tags = body.tags.unwrap_or_default();
    let project_id = body
        .project_id
        .as_ref()
        .map(|s| {
            Ok::<_, AppError>(ProjectId(
                Uuid::parse_str(s).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
            ))
        })
        .transpose()?;
    let ticket = TicketRepository::new(&state.store)
        .create(
            company_id,
            &body.title,
            body.description.as_deref().unwrap_or(""),
            &tags,
            project_id,
        )
        .await?;

    let mut approval_id = None;
    if tags.iter().any(|t| t == "strategy") {
        let id = ApprovalRepository::new(&state.store)
            .create_strategy_approval(company_id, &ticket.id.to_string())
            .await?;
        approval_id = Some(id.to_string());
        AuditLog::new(&state.store)
            .append(
                company_id,
                "strategy_approval_requested",
                serde_json::json!({ "ticket_id": ticket.id.to_string(), "approval_id": id.to_string() }),
            )
            .await?;
    }

    Ok(Json(serde_json::json!({
        "ticket_id": ticket.id.to_string(),
        "status": "open",
        "strategy_approval_id": approval_id,
    })))
}

#[derive(Deserialize)]
struct AssignBody {
    agent_id: String,
    reviewer_agent_id: Option<String>,
}

#[derive(Deserialize)]
struct SetReviewerBody {
    agent_id: Option<String>,
    clear: Option<bool>,
}

async fn assign_ticket(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
    Json(body): Json<AssignBody>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = loop_core::ids::TicketId(
        Uuid::parse_str(&ticket_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );
    let agent_id = loop_core::ids::AgentId(
        Uuid::parse_str(&body.agent_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );

    let ticket_repo = TicketRepository::new(&state.store);
    let before = ticket_repo.get(company_id, ticket_id).await?;

    PolicyEngine::new(
        ApprovalRepository::new(&state.store),
        AuditLog::new(&state.store),
    )
    .can_execute_ticket(company_id, &before)
    .await?;

    ticket_repo.assign(company_id, ticket_id, agent_id).await?;

    if let Some(ref rid) = body.reviewer_agent_id {
        if rid.is_empty() {
            ticket_repo
                .set_reviewer(company_id, ticket_id, None)
                .await?;
        } else {
            let reviewer_id = loop_core::ids::AgentId(
                Uuid::parse_str(rid).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
            );
            ticket_repo
                .set_reviewer(company_id, ticket_id, Some(reviewer_id))
                .await?;
        }
    }

    state
        .scheduler()
        .enqueue_ticket_wake(company_id, agent_id, ticket_id)
        .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn set_ticket_reviewer(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
    Json(body): Json<SetReviewerBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = parse_ticket_id(&ticket_id)?;
    let repo = TicketRepository::new(&state.store);
    let reviewer = if body.clear == Some(true) {
        None
    } else if let Some(ref aid) = body.agent_id {
        if aid.is_empty() {
            None
        } else {
            Some(loop_core::ids::AgentId(
                Uuid::parse_str(aid).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
            ))
        }
    } else {
        return Err(AppError(LoopError::Validation(
            "agent_id or clear required".into(),
        )));
    };
    let ticket = repo.set_reviewer(company_id, ticket_id, reviewer).await?;
    Ok(Json(serde_json::json!({
        "ticket_id": ticket.id.to_string(),
        "reviewer_agent_id": ticket.reviewer_agent_id.map(|a| a.to_string()),
    })))
}

fn parse_ticket_id(s: &str) -> Result<TicketId, AppError> {
    Ok(TicketId(
        Uuid::parse_str(s).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    ))
}

async fn submit_ticket_review(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = parse_ticket_id(&ticket_id)?;
    let repo = TicketRepository::new(&state.store);
    let ticket = repo.get(company_id, ticket_id).await?;

    if ticket.reviewer_agent_id.is_none() {
        if let Some(assignee_id) = ticket.assignee_agent_id {
            let assignee = AgentRepository::new(&state.store)
                .get(company_id, assignee_id)
                .await?;
            if let Some(parent) = assignee.parent_agent_id {
                repo.set_reviewer(company_id, ticket_id, Some(parent))
                    .await?;
            }
        }
    }

    let ticket = repo
        .set_status(
            company_id,
            ticket_id,
            &[TicketStatus::InProgress],
            TicketStatus::InReview,
        )
        .await?;

    AuditLog::new(&state.store)
        .append(
            company_id,
            "ticket_submitted_for_review",
            serde_json::json!({
                "ticket_id": ticket.id.to_string(),
                "title": ticket.title,
                "reviewer_agent_id": ticket.reviewer_agent_id.map(|a| a.to_string()),
            }),
        )
        .await?;

    if let Some(reviewer_id) = ticket.reviewer_agent_id {
        state
            .scheduler()
            .enqueue_ticket_wake(company_id, reviewer_id, ticket_id)
            .await;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn approve_ticket_done(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = parse_ticket_id(&ticket_id)?;
    let repo = TicketRepository::new(&state.store);
    let ticket = repo
        .set_status(
            company_id,
            ticket_id,
            &[TicketStatus::InReview],
            TicketStatus::Done,
        )
        .await?;
    AuditLog::new(&state.store)
        .append(
            company_id,
            "ticket_review_approved",
            serde_json::json!({
                "ticket_id": ticket.id.to_string(),
                "title": ticket.title,
            }),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn request_ticket_changes(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = parse_ticket_id(&ticket_id)?;
    let repo = TicketRepository::new(&state.store);
    let ticket = repo
        .set_status(
            company_id,
            ticket_id,
            &[TicketStatus::InReview],
            TicketStatus::InProgress,
        )
        .await?;
    AuditLog::new(&state.store)
        .append(
            company_id,
            "ticket_review_changes_requested",
            serde_json::json!({
                "ticket_id": ticket.id.to_string(),
                "title": ticket.title,
            }),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn trigger_heartbeat(
    State(state): State<Arc<AppState>>,
    Path((company_id, agent_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let agent_id = loop_core::ids::AgentId(
        Uuid::parse_str(&agent_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );

    let scheduler = state.scheduler();
    let result = scheduler
        .dispatch_one(loop_scheduler::WakeJob {
            company_id,
            agent_id,
            ticket_id: None,
        })
        .await?;
    Ok(Json(serde_json::json!({ "dispatched": 1, "result": result })))
}

async fn list_budgets(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let company = CompanyRepository::new(&state.store).get(company_id).await?;
    let budgets = BudgetRepository::new(&state.store);
    let company_rollup = if let Some(cap) = company.monthly_budget_usd {
        let status = budgets.company_cap_status(company_id, cap).await?;
        Some(serde_json::json!({
            "cap_usd": cap,
            "used_usd": status.used_usd,
            "remaining_usd": (cap - status.used_usd).max(0.0),
            "warn": status.warn,
            "exhausted": status.exhausted,
        }))
    } else {
        None
    };
    let agents = AgentRepository::new(&state.store)
        .list_active(company_id)
        .await?;
    let mut rows = Vec::new();
    for a in agents {
        let remaining = budgets.remaining_usd(company_id, a.id).await?;
        rows.push(serde_json::json!({
            "agent_id": a.id.to_string(),
            "title": a.title,
            "remaining_usd": remaining,
            "cap_usd": a.monthly_budget_usd,
            "paused_reason": a.paused_reason,
        }));
    }
    Ok(Json(serde_json::json!({
        "company": company_rollup,
        "agents": rows
    })))
}

async fn list_audit(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let entries = AuditLog::new(&state.store).list(company_id).await?;
    Ok(Json(serde_json::json!({
        "entries": entries.iter().map(|e| serde_json::json!({
            "id": e.id.0,
            "kind": e.kind,
            "payload": e.payload_json,
        })).collect::<Vec<_>>()
    })))
}

fn adapter_kind_api(k: &AdapterKind) -> &'static str {
    match k {
        AdapterKind::Hermes => "hermes",
        AdapterKind::Process => "process",
        AdapterKind::Mock => "mock",
        AdapterKind::Webhook => "webhook",
    }
}

#[derive(Deserialize)]
struct PatchCompanyBody {
    mission: Option<String>,
    monthly_budget_usd: Option<f64>,
    clear_monthly_budget: Option<bool>,
}

async fn patch_company(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<PatchCompanyBody>,
) -> Result<Json<CompanyResponse>, AppError> {
    let company_id = parse_company(&company_id)?;
    let wants_mission = body.mission.is_some();
    let wants_cap = body.monthly_budget_usd.is_some();
    let wants_clear = body.clear_monthly_budget == Some(true);
    if !wants_mission && !wants_cap && !wants_clear {
        return Err(AppError(LoopError::Validation(
            "provide mission, monthly_budget_usd, or clear_monthly_budget".into(),
        )));
    }
    let repo = CompanyRepository::new(&state.store);
    let mut c = repo.get(company_id).await?;
    if let Some(mission) = body.mission {
        c = repo.update_mission(company_id, &mission).await?;
    }
    if wants_clear {
        c = repo.update_monthly_budget(company_id, None).await?;
        AuditLog::new(&state.store)
            .append(company_id, "company_budget_cleared", serde_json::json!({}))
            .await?;
    } else if let Some(cap) = body.monthly_budget_usd {
        c = repo.update_monthly_budget(company_id, Some(cap)).await?;
        AuditLog::new(&state.store)
            .append(
                company_id,
                "company_budget_set",
                serde_json::json!({ "monthly_budget_usd": cap }),
            )
            .await?;
    }
    Ok(Json(company_to_response(c)))
}

async fn archive_company(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    CompanyRepository::new(&state.store)
        .archive(company_id)
        .await?;
    AuditLog::new(&state.store)
        .append(company_id, "company_archived", serde_json::json!({}))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreateProjectBody {
    name: String,
    goal: String,
}

async fn list_projects(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let projects = ProjectRepository::new(&state.store)
        .list(company_id)
        .await?;
    Ok(Json(serde_json::json!({
        "projects": projects.iter().map(|p| serde_json::json!({
            "project_id": p.id.to_string(),
            "name": p.name,
            "goal": p.goal,
        })).collect::<Vec<_>>()
    })))
}

async fn create_project(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let p = ProjectRepository::new(&state.store)
        .create(company_id, &body.name, &body.goal)
        .await?;
    Ok(Json(serde_json::json!({
        "project_id": p.id.to_string(),
        "name": p.name,
        "goal": p.goal,
    })))
}

async fn dashboard(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let company = CompanyRepository::new(&state.store).get(company_id).await?;
    let agents = AgentRepository::new(&state.store).list(company_id).await?;
    let mut budget_warn = 0u32;
    let mut budget_stopped = 0u32;
    let budgets = BudgetRepository::new(&state.store);
    let mut company_budget = serde_json::Value::Null;
    if let Some(cap) = company.monthly_budget_usd {
        let status = budgets.company_cap_status(company_id, cap).await?;
        company_budget = serde_json::json!({
            "cap_usd": cap,
            "used_usd": status.used_usd,
            "remaining_usd": (cap - status.used_usd).max(0.0),
            "warn": status.warn,
            "exhausted": status.exhausted,
        });
    }
    for a in &agents {
        if a.paused_reason.as_deref() == Some("budget") {
            budget_stopped += 1;
            continue;
        }
        let remaining = budgets.remaining_usd(company_id, a.id).await?;
        if a.monthly_budget_usd > 0.0 && remaining / a.monthly_budget_usd <= 0.2 {
            budget_warn += 1;
        }
    }
    let pending = ApprovalRepository::new(&state.store)
        .list_pending(company_id)
        .await?
        .len();
  let tickets = TicketRepository::new(&state.store).list(company_id).await?;
    Ok(Json(serde_json::json!({
        "agents_active": agents.iter().filter(|a| a.status == AgentStatus::Active).count(),
        "agents_paused_budget": budget_stopped,
        "agents_budget_warn": budget_warn,
        "pending_approvals": pending,
        "open_tickets": tickets.iter().filter(|t| t.status == TicketStatus::Open || t.status == TicketStatus::InProgress).count(),
        "tickets_in_review": tickets.iter().filter(|t| t.status == TicketStatus::InReview).count(),
        "company_budget": company_budget,
    })))
}

#[derive(Deserialize)]
struct TicketMessageBody {
    author: String,
    body: String,
}

async fn list_ticket_messages(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = TicketId(
        Uuid::parse_str(&ticket_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );
    let messages = TicketRepository::new(&state.store)
        .list_messages(company_id, ticket_id)
        .await?;
    Ok(Json(serde_json::json!({ "messages": messages })))
}

async fn post_ticket_message(
    State(state): State<Arc<AppState>>,
    Path((company_id, ticket_id)): Path<(String, String)>,
    Json(body): Json<TicketMessageBody>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let ticket_id = TicketId(
        Uuid::parse_str(&ticket_id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );
    TicketRepository::new(&state.store)
        .append_message(company_id, ticket_id, &body.author, &body.body)
        .await?;
    if let Ok(ticket) = TicketRepository::new(&state.store)
        .get(company_id, ticket_id)
        .await
    {
        if let Some(agent_id) = ticket.assignee_agent_id {
            state
                .scheduler()
                .enqueue_ticket_wake(company_id, agent_id, ticket_id)
                .await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct BudgetIncreaseBody {
    new_cap_usd: f64,
}

async fn request_budget_increase(
    State(state): State<Arc<AppState>>,
    Path((company_id, agent_id)): Path<(String, String)>,
    Json(body): Json<BudgetIncreaseBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let approval_id = ApprovalRepository::new(&state.store)
        .create_increase_budget(company_id, &agent_id, body.new_cap_usd)
        .await?;
    Ok(Json(serde_json::json!({ "approval_id": approval_id.to_string() })))
}

async fn list_tool_policies(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let rows = ToolPolicyRepository::new(&state.store)
        .list(company_id)
        .await?;
    Ok(Json(serde_json::json!({
        "policies": rows.iter().map(|p| serde_json::json!({
            "tool_pattern": p.tool_pattern,
            "disposition": p.disposition.as_str(),
        })).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
struct UpsertToolPolicyBody {
    tool_pattern: String,
    disposition: String,
}

async fn upsert_tool_policy(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<UpsertToolPolicyBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let disposition = ToolDisposition::parse(&body.disposition)
        .ok_or_else(|| AppError(LoopError::Validation("disposition must be allow|ask|block".into())))?;
    let row = ToolPolicyRepository::new(&state.store)
        .upsert(company_id, &body.tool_pattern, disposition)
        .await?;
    AuditLog::new(&state.store)
        .append(
            company_id,
            "tool_policy_upsert",
            serde_json::json!({
                "tool_pattern": row.tool_pattern,
                "disposition": row.disposition.as_str(),
            }),
        )
        .await?;
    Ok(Json(serde_json::json!({
        "tool_pattern": row.tool_pattern,
        "disposition": row.disposition.as_str(),
    })))
}

#[derive(Deserialize)]
struct RemoveToolPolicyBody {
    tool_pattern: String,
}

async fn remove_tool_policy(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<RemoveToolPolicyBody>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    ToolPolicyRepository::new(&state.store)
        .delete(company_id, &body.tool_pattern)
        .await?;
    AuditLog::new(&state.store)
        .append(
            company_id,
            "tool_policy_removed",
            serde_json::json!({ "tool_pattern": body.tool_pattern }),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct EvaluateToolBody {
    tool: String,
    agent_id: Option<String>,
}

fn parse_optional_agent(s: &Option<String>) -> Result<Option<AgentId>, AppError> {
    match s {
        Some(id) if !id.is_empty() => Ok(Some(AgentId(
            Uuid::parse_str(id).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
        ))),
        _ => Ok(None),
    }
}

async fn evaluate_tool(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<EvaluateToolBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let agent_id = parse_optional_agent(&body.agent_id)?;
    let result = ToolGateway::new(
        ToolPolicyRepository::new(&state.store),
        AuditLog::new(&state.store),
    )
    .evaluate(company_id, &body.tool, agent_id)
    .await?;

    let grants = ToolGrantRepository::new(&state.store);
    let approvals = ApprovalRepository::new(&state.store);

    let (allowed, grant_id, pending_approval_id) = match result.disposition {
        ToolDisposition::Allow => (true, None, None),
        ToolDisposition::Block => (false, None, None),
        ToolDisposition::Ask => {
            if let Some(gid) = grants
                .has_unused(company_id, &body.tool, agent_id)
                .await?
            {
                (true, Some(gid.to_string()), None)
            } else if let Some(pending_id) = approvals
                .find_pending_tool_use(company_id, &body.tool, body.agent_id.as_deref())
                .await?
            {
                (false, None, Some(pending_id.to_string()))
            } else {
                (false, None, None)
            }
        }
    };

    Ok(Json(serde_json::json!({
        "disposition": result.disposition.as_str(),
        "matched_pattern": result.matched_pattern,
        "allowed": allowed,
        "grant_id": grant_id,
        "pending_approval_id": pending_approval_id,
    })))
}

async fn request_tool_use(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<EvaluateToolBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let company_id = parse_company(&company_id)?;
    let agent_id = parse_optional_agent(&body.agent_id)?;
    let result = ToolGateway::new(
        ToolPolicyRepository::new(&state.store),
        AuditLog::new(&state.store),
    )
    .evaluate(company_id, &body.tool, agent_id)
    .await?;

    match result.disposition {
        ToolDisposition::Allow => {
            return Ok(Json(serde_json::json!({
                "status": "allowed",
                "allowed": true,
                "disposition": "allow",
                "matched_pattern": result.matched_pattern,
            })));
        }
        ToolDisposition::Block => {
            return Err(AppError(LoopError::Validation(format!(
                "tool blocked by policy {}",
                result.matched_pattern.unwrap_or_default()
            ))));
        }
        ToolDisposition::Ask => {}
    }

    let grants = ToolGrantRepository::new(&state.store);
    if let Some(gid) = grants
        .has_unused(company_id, &body.tool, agent_id)
        .await?
    {
        return Ok(Json(serde_json::json!({
            "status": "already_granted",
            "grant_id": gid.to_string(),
        })));
    }

    let approvals = ApprovalRepository::new(&state.store);
    if let Some(pending_id) = approvals
        .find_pending_tool_use(company_id, &body.tool, body.agent_id.as_deref())
        .await?
    {
        return Ok(Json(serde_json::json!({
            "status": "pending",
            "approval_id": pending_id.to_string(),
        })));
    }

    let agent_scope = agent_id.as_ref().map(|a| a.to_string());
    let approval_id = approvals
        .create_tool_use(
            company_id,
            &body.tool,
            agent_scope.as_deref(),
            result.matched_pattern.as_deref(),
        )
        .await?;

    AuditLog::new(&state.store)
        .append(
            company_id,
            "tool_use_requested",
            serde_json::json!({
                "tool": body.tool,
                "agent_id": agent_id.map(|a| a.to_string()),
                "approval_id": approval_id.to_string(),
                "matched_pattern": result.matched_pattern,
            }),
        )
        .await?;

    Ok(Json(serde_json::json!({
        "status": "pending",
        "approval_id": approval_id.to_string(),
    })))
}

#[derive(Deserialize)]
struct ConsumeToolGrantBody {
    grant_id: String,
}

async fn consume_tool_grant(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<String>,
    Json(body): Json<ConsumeToolGrantBody>,
) -> Result<StatusCode, AppError> {
    let company_id = parse_company(&company_id)?;
    let grant_id = ToolUseGrantId::from_uuid(
        Uuid::parse_str(&body.grant_id)
            .map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    );
    ToolGrantRepository::new(&state.store)
        .consume(company_id, grant_id)
        .await?;
    AuditLog::new(&state.store)
        .append(
            company_id,
            "tool_use_consumed",
            serde_json::json!({ "grant_id": body.grant_id }),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn agent_status_api(s: &AgentStatus) -> &'static str {
    match s {
        AgentStatus::Pending => "pending",
        AgentStatus::Active => "active",
        AgentStatus::Paused => "paused",
    }
}

fn parse_company(s: &str) -> Result<CompanyId, AppError> {
    Ok(CompanyId(
        Uuid::parse_str(s).map_err(|e| AppError(LoopError::Validation(e.to_string())))?,
    ))
}

struct AppError(LoopError);

impl From<LoopError> for AppError {
    fn from(e: LoopError) -> Self {
        Self(e)
    }
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let status = match self.0 {
            LoopError::NotFound(_) => StatusCode::NOT_FOUND,
            LoopError::Validation(_) => StatusCode::BAD_REQUEST,
            LoopError::PolicyDenied(_) => StatusCode::FORBIDDEN,
            LoopError::BudgetExhausted => StatusCode::PAYMENT_REQUIRED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.0.to_string()).into_response()
    }
}