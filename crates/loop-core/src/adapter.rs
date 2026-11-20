use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::{AgentCost, HeartbeatContext};
use crate::ids::{AgentId, CompanyId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeartbeatIn {
    pub company_id: CompanyId,
    pub agent_id: AgentId,
    pub role: String,
    pub context: HeartbeatContext,
    pub budget_remaining_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceEvent {
    pub name: String,
    pub detail_json: serde_json::Value,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeartbeatOut {
    pub status: String,
    pub messages: Vec<String>,
    pub cost: AgentCost,
    pub trace_events: Vec<TraceEvent>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{AgentId, CompanyId, TicketId};
    use uuid::Uuid;

    #[test]
    fn heartbeat_in_out_roundtrip() {
        let company_id = CompanyId(Uuid::new_v4());
        let agent_id = AgentId(Uuid::new_v4());
        let ticket_id = TicketId(Uuid::new_v4());

        let input = HeartbeatIn {
            company_id,
            agent_id,
            role: "CEO".to_string(),
            context: crate::domain::HeartbeatContext {
                mission: "Build MVP".to_string(),
                project: Some("Loop".to_string()),
                agent_goal: None,
                ticket: Some(crate::domain::TicketSummary {
                    ticket_id,
                    title: "Ship".to_string(),
                    description: "Do it".to_string(),
                }),
            },
            budget_remaining_usd: 42.5,
        };

        let json = serde_json::to_string(&input).expect("serialize");
        let back: HeartbeatIn = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.company_id, company_id);
        assert_eq!(back.budget_remaining_usd, 42.5);

        let output = HeartbeatOut {
            status: "ok".to_string(),
            messages: vec!["done".to_string()],
            cost: crate::domain::AgentCost {
                input_tokens: 100,
                output_tokens: 50,
                usd: 0.25,
            },
            trace_events: vec![TraceEvent {
                name: "run_tests".to_string(),
                detail_json: serde_json::json!({"passed": true}),
                at: Utc::now(),
            }],
        };

        let json = serde_json::to_string(&output).expect("serialize out");
        let back: HeartbeatOut = serde_json::from_str(&json).expect("deserialize out");
        assert_eq!(back.cost.usd, 0.25);
        assert_eq!(back.trace_events.len(), 1);
    }
}