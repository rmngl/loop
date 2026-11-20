use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{AgentId, CompanyId, TicketId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Pending,
    Active,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    Hermes,
    Process,
    #[serde(rename = "mock")]
    Mock,
    Webhook,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
    Open,
    InProgress,
    /// Paperclip-style: agent finished; board must verify before done.
    InReview,
    Done,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeartbeatContext {
    pub mission: String,
    pub project: Option<String>,
    pub agent_goal: Option<String>,
    pub ticket: Option<TicketSummary>,
    /// When set to `review`, the agent is the designated reviewer for a ticket in `in_review`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_mode: Option<String>,
    /// Base URL for loopd tool gateway (`http://127.0.0.1:7841`). Adapters call evaluate/invoke here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loopd_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TicketSummary {
    pub ticket_id: TicketId,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentCost {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetStatus {
    pub used_usd: f64,
    pub cap_usd: f64,
    pub warn: bool,
    pub exhausted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Company {
    pub id: CompanyId,
    pub name: String,
    pub mission: String,
    /// Organization-wide monthly spend ceiling; `None` means unlimited.
    pub monthly_budget_usd: Option<f64>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: AgentId,
    pub company_id: CompanyId,
    pub title: String,
    pub adapter_kind: AdapterKind,
    pub adapter_config: serde_json::Value,
    pub cron: String,
    pub monthly_budget_usd: f64,
    pub parent_agent_id: Option<AgentId>,
    pub status: AgentStatus,
    pub paused_reason: Option<String>,
}