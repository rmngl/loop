use chrono::Utc;
use loop_core::adapter::{HeartbeatIn, HeartbeatOut, TraceEvent};
use loop_core::domain::AgentCost;
use loop_core::error::Result;

use crate::traits::AgentAdapter;

pub struct MockAdapter;

impl AgentAdapter for MockAdapter {
    fn heartbeat(&self, _input: HeartbeatIn) -> Result<HeartbeatOut> {
        Ok(HeartbeatOut {
            status: "ok".to_string(),
            messages: vec!["mock heartbeat complete".to_string()],
            cost: AgentCost {
                input_tokens: 10,
                output_tokens: 20,
                usd: 0.25,
            },
            trace_events: vec![TraceEvent {
                name: "mock_run".to_string(),
                detail_json: serde_json::json!({ "ok": true }),
                at: Utc::now(),
            }],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loop_core::domain::HeartbeatContext;
    use loop_core::ids::{AgentId, CompanyId};

    #[test]
    fn mock_roundtrip() {
        let adapter = MockAdapter;
        let out = adapter
            .heartbeat(HeartbeatIn {
                company_id: CompanyId::new(),
                agent_id: AgentId::new(),
                role: "CEO".into(),
                context: HeartbeatContext {
                    mission: "M".into(),
                    project: None,
                    agent_goal: None,
                    heartbeat_mode: None,
                    ticket: None,
                },
                budget_remaining_usd: 5.0,
            })
            .unwrap();
        assert_eq!(out.cost.usd, 0.25);
        assert_eq!(out.trace_events.len(), 1);
    }
}