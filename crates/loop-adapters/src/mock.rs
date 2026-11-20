use chrono::Utc;
use loop_core::adapter::{HeartbeatIn, HeartbeatOut, TraceEvent};
use loop_core::domain::AgentCost;
use loop_core::error::Result;

use crate::gateway_client::GatewayClient;
use crate::traits::AgentAdapter;

pub struct MockAdapter;

impl AgentAdapter for MockAdapter {
    fn heartbeat(&self, input: HeartbeatIn) -> Result<HeartbeatOut> {
        let mut trace_events = vec![TraceEvent {
            name: "mock_run".to_string(),
            detail_json: serde_json::json!({ "ok": true }),
            at: Utc::now(),
        }];

        if let Ok(tool) = std::env::var("LOOP_MOCK_TOOL") {
            if !tool.is_empty() {
                let base = GatewayClient::loopd_url_from_input(&input);
                let client = GatewayClient::new(&base);
                match client.invoke(input.company_id, &tool, Some(input.agent_id), None) {
                    Ok(inv) => trace_events.push(TraceEvent {
                        name: "tool_invoke".to_string(),
                        detail_json: serde_json::json!({
                            "tool": inv.tool,
                            "disposition": inv.disposition,
                            "grant_consumed": inv.grant_consumed,
                            "result": inv.result,
                        }),
                        at: Utc::now(),
                    }),
                    Err(e) => trace_events.push(TraceEvent {
                        name: "tool_invoke_denied".to_string(),
                        detail_json: serde_json::json!({ "tool": tool, "error": e.to_string() }),
                        at: Utc::now(),
                    }),
                }
            }
        }

        Ok(HeartbeatOut {
            status: "ok".to_string(),
            messages: vec!["mock heartbeat complete".to_string()],
            cost: AgentCost {
                input_tokens: 10,
                output_tokens: 20,
                usd: 0.25,
            },
            trace_events,
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
                    loopd_url: Some("http://127.0.0.1:7841".into()),
                    ticket: None,
                },
                budget_remaining_usd: 5.0,
            })
            .unwrap();
        assert_eq!(out.cost.usd, 0.25);
        assert_eq!(out.trace_events.len(), 1);
    }
}