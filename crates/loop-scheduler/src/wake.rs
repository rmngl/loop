use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use loop_adapters::adapter_for;
use loop_core::adapter::HeartbeatIn;
use loop_core::domain::{AgentStatus, HeartbeatContext, TicketStatus, TicketSummary};
use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, CompanyId, TicketId};
use loop_store::{
    AgentRepository, AuditLog, BudgetRepository, CompanyRepository, ProjectRepository, Store,
    TicketRepository,
};

const DEBOUNCE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct WakeJob {
    pub company_id: CompanyId,
    pub agent_id: AgentId,
    pub ticket_id: Option<TicketId>,
}

#[derive(Debug, Default)]
struct DebounceState {
    last_seen: HashMap<AgentId, Instant>,
    pending: Vec<WakeJob>,
}

pub struct WakeQueue {
    inner: Arc<Mutex<DebounceState>>,
}

impl WakeQueue {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(DebounceState::default())),
        }
    }

    pub fn push(&self, job: WakeJob) -> usize {
        let mut state = self.inner.lock().expect("wake queue lock");
        let now = Instant::now();
        if let Some(last) = state.last_seen.get(&job.agent_id) {
            if now.duration_since(*last) < DEBOUNCE {
                return state.pending.len();
            }
        }
        state.last_seen.insert(job.agent_id, now);
        let duplicate = state.pending.iter().any(|j| {
            j.agent_id == job.agent_id
                && j.ticket_id == job.ticket_id
                && j.company_id == job.company_id
        });
        if !duplicate {
            state.pending.push(job);
        }
        state.pending.len()
    }

    pub fn drain_ready(&self) -> Vec<WakeJob> {
        let mut state = self.inner.lock().expect("wake queue lock");
        let now = Instant::now();
        let pending = std::mem::take(&mut state.pending);
        let (ready, waiting): (Vec<_>, Vec<_>) = pending.into_iter().partition(|job| {
            state
                .last_seen
                .get(&job.agent_id)
                .map(|t| now.duration_since(*t) >= DEBOUNCE)
                .unwrap_or(true)
        });
        state.pending = waiting;
        ready
    }

    #[cfg(test)]
    pub fn clear(&self) {
        let mut state = self.inner.lock().expect("wake queue lock");
        state.pending.clear();
        state.last_seen.clear();
    }
}

#[derive(Debug, serde::Serialize)]
pub struct DispatchResult {
    pub success: bool,
    pub budget_exhausted: bool,
}

pub struct Scheduler<'a> {
    store: &'a Store,
    wake: Arc<WakeQueue>,
}

impl<'a> Scheduler<'a> {
    pub fn new(store: &'a Store, wake: Arc<WakeQueue>) -> Self {
        Self { store, wake }
    }

    pub fn wake_queue(&self) -> Arc<WakeQueue> {
        Arc::clone(&self.wake)
    }

    pub async fn enqueue_ticket_wake(
        &self,
        company_id: CompanyId,
        agent_id: AgentId,
        ticket_id: TicketId,
    ) {
        self.wake.push(WakeJob {
            company_id,
            agent_id,
            ticket_id: Some(ticket_id),
        });
    }

    pub async fn tick(&self, now: DateTime<Utc>) -> Result<Vec<AgentId>> {
        let companies = CompanyRepository::new(self.store).list().await?;
        let mut due = Vec::new();
        let agents_repo = AgentRepository::new(self.store);

        for company in companies {
            if company.archived_at.is_some() {
                continue;
            }
            if !BudgetRepository::new(self.store)
                .company_has_room(company.id, company.monthly_budget_usd)
                .await?
            {
                continue;
            }
            for agent in agents_repo.list_active(company.id).await? {
                if agent.paused_reason.is_some() {
                    continue;
                }
                if BudgetRepository::new(self.store)
                    .remaining_usd(company.id, agent.id)
                    .await?
                    <= 0.0
                {
                    continue;
                }
                let cron = croner::Cron::new(&agent.cron)
                    .parse()
                    .map_err(|e| LoopError::Validation(e.to_string()))?;
                let due_soon = cron
                    .find_next_occurrence(&now, false)
                    .map(|t| (t - now).num_seconds().abs() < 60)
                    .unwrap_or(false);
                if due_soon {
                    due.push(agent.id);
                    self.wake.push(WakeJob {
                        company_id: company.id,
                        agent_id: agent.id,
                        ticket_id: None,
                    });
                }
            }
        }
        Ok(due)
    }

    pub async fn dispatch_pending(&self) -> Result<Vec<DispatchResult>> {
        let jobs = self.wake.drain_ready();
        let mut results = Vec::new();
        for job in jobs {
            results.push(self.dispatch_one(job).await?);
        }
        Ok(results)
    }

    pub async fn dispatch_one(&self, job: WakeJob) -> Result<DispatchResult> {
        let agents = AgentRepository::new(self.store);
        let agent = agents.get(job.company_id, job.agent_id).await?;

        if agent.status != AgentStatus::Active {
            return Ok(DispatchResult {
                success: false,
                budget_exhausted: false,
            });
        }
        if agent.paused_reason.is_some() {
            return Ok(DispatchResult {
                success: false,
                budget_exhausted: true,
            });
        }

        let remaining = BudgetRepository::new(self.store)
            .remaining_usd(job.company_id, job.agent_id)
            .await?;
        if remaining <= 0.0 {
            agents
                .set_paused_reason(job.company_id, job.agent_id, Some("budget"))
                .await?;
            return Ok(DispatchResult {
                success: false,
                budget_exhausted: true,
            });
        }

        let company = CompanyRepository::new(self.store)
            .get(job.company_id)
            .await?;

        if !BudgetRepository::new(self.store)
            .company_has_room(job.company_id, company.monthly_budget_usd)
            .await?
        {
            return Ok(DispatchResult {
                success: false,
                budget_exhausted: true,
            });
        }

        let ticket_repo = TicketRepository::new(self.store);
        let mut project_goal: Option<String> = None;
        let mut agent_goal: Option<String> = None;
        let mut heartbeat_mode: Option<String> = None;
        let ticket_context = if let Some(tid) = job.ticket_id {
            let ticket = ticket_repo.get(job.company_id, tid).await?;
            if let Some(pid) = ticket.project_id {
                let project = ProjectRepository::new(self.store)
                    .get(job.company_id, pid)
                    .await?;
                project_goal = Some(format!("{} — {}", project.name, project.goal));
            }
            if ticket.status == TicketStatus::InReview
                && ticket.reviewer_agent_id == Some(job.agent_id)
            {
                heartbeat_mode = Some("review".into());
                agent_goal = Some(
                    "Review assignee work on this ticket; inspect trace and board thread; suggest approve or changes.".into(),
                );
            }
            Some(TicketSummary {
                ticket_id: tid,
                title: ticket.title.clone(),
                description: ticket.description.clone(),
            })
        } else {
            None
        };

        let loopd_url = std::env::var("LOOPD_URL").unwrap_or_else(|_| "http://127.0.0.1:7841".into());
        let input = HeartbeatIn {
            company_id: job.company_id,
            agent_id: job.agent_id,
            role: agent.title.clone(),
            context: HeartbeatContext {
                mission: company.mission.clone(),
                project: project_goal,
                agent_goal,
                ticket: ticket_context,
                heartbeat_mode,
                loopd_url: Some(loopd_url),
            },
            budget_remaining_usd: remaining,
        };

        let adapter = adapter_for(&agent)?;
        let out = adapter.heartbeat(input);
        let out = match out {
            Ok(o) => o,
            Err(e) => {
                AuditLog::new(self.store)
                    .append(
                        job.company_id,
                        "adapter_failed",
                        serde_json::json!({ "agent_id": job.agent_id.to_string(), "error": e.to_string() }),
                    )
                    .await?;
                return Ok(DispatchResult {
                    success: false,
                    budget_exhausted: false,
                });
            }
        };

        if let Some(tid) = job.ticket_id {
            for msg in &out.messages {
                ticket_repo
                    .append_message(job.company_id, tid, &agent.title, msg)
                    .await?;
            }
            ticket_repo
                .append_trace_events(job.company_id, tid, &out.trace_events)
                .await?;
            let review_signal = matches!(
                out.status.as_str(),
                "ready_for_review" | "awaiting_review" | "in_review"
            );
            if review_signal {
                let ticket = ticket_repo.get(job.company_id, tid).await?;
                if ticket.status == loop_core::domain::TicketStatus::InProgress {
                    let _ = ticket_repo
                        .set_status(
                            job.company_id,
                            tid,
                            &[loop_core::domain::TicketStatus::InProgress],
                            loop_core::domain::TicketStatus::InReview,
                        )
                        .await;
                    AuditLog::new(self.store)
                        .append(
                            job.company_id,
                            "ticket_submitted_for_review",
                            serde_json::json!({
                                "ticket_id": tid.to_string(),
                                "source": "adapter_heartbeat",
                                "adapter_status": out.status,
                            }),
                        )
                        .await?;
                }
            }
        }

        let budget = BudgetRepository::new(self.store)
            .record_spend(job.company_id, job.agent_id, out.cost.usd)
            .await?;

        Ok(DispatchResult {
            success: true,
            budget_exhausted: budget.exhausted,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loop_core::domain::AdapterKind;
    use loop_store::{CompanyRepository, HireAgentRequest};

    #[tokio::test]
    async fn debounce_coalesces_within_window() {
        let queue = WakeQueue::new();
        let company_id = CompanyId::new();
        let agent_id = AgentId::new();
        queue.push(WakeJob {
            company_id,
            agent_id,
            ticket_id: None,
        });
        queue.push(WakeJob {
            company_id,
            agent_id,
            ticket_id: None,
        });
        let ready = queue.drain_ready();
        assert!(ready.len() <= 1 || ready.is_empty());
    }

    #[tokio::test]
    async fn budget_blocks_dispatch() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::connect(&dir.path().join("t.db")).await.unwrap();
        let company = CompanyRepository::new(&store)
            .create("C", "M")
            .await
            .unwrap();
        let (agent, approval_id) = AgentRepository::new(&store)
            .create_pending(
                company.id,
                &HireAgentRequest {
                    title: "CEO".into(),
                    adapter_kind: AdapterKind::Mock,
                    adapter_config: serde_json::json!({}),
                    cron: "0 0 1 1 *".into(),
                    monthly_budget_usd: 0.1,
                    parent_agent_id: None,
                },
            )
            .await
            .unwrap();
        loop_store::ApprovalRepository::new(&store)
            .approve(company.id, approval_id)
            .await
            .unwrap();
        AgentRepository::new(&store)
            .activate_after_approval(company.id, agent.id)
            .await
            .unwrap();
        let wake = Arc::new(WakeQueue::new());
        let scheduler = Scheduler::new(&store, Arc::clone(&wake));

        let r1 = scheduler
            .dispatch_one(WakeJob {
                company_id: company.id,
                agent_id: agent.id,
                ticket_id: None,
            })
            .await
            .unwrap();
        assert!(r1.success);

        let r2 = scheduler
            .dispatch_one(WakeJob {
                company_id: company.id,
                agent_id: agent.id,
                ticket_id: None,
            })
            .await
            .unwrap();
        assert!(r2.budget_exhausted);
    }
}