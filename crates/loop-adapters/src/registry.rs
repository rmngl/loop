use std::path::PathBuf;

use loop_core::domain::{AdapterKind, Agent};
use loop_core::error::{LoopError, Result};

use crate::hermes::HermesAdapter;
use crate::mock::MockAdapter;
use crate::process::ProcessAdapter;
use crate::traits::AgentAdapter;
use crate::webhook::WebhookAdapter;

pub fn adapter_for(agent: &Agent) -> Result<Box<dyn AgentAdapter>> {
    match agent.adapter_kind {
        AdapterKind::Mock => Ok(Box::new(MockAdapter)),
        AdapterKind::Hermes => {
            let bin = agent
                .adapter_config
                .get("hermes_bin")
                .and_then(|v| v.as_str())
                .unwrap_or("hermes");
            Ok(Box::new(HermesAdapter::new(PathBuf::from(bin))))
        }
        AdapterKind::Process => {
            let command = agent
                .adapter_config
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LoopError::Validation("process adapter needs command".into()))?;
            let args: Vec<String> = agent
                .adapter_config
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(Box::new(ProcessAdapter::new(
                PathBuf::from(command),
                args,
                None,
            )))
        }
        AdapterKind::Webhook => {
            let url = agent
                .adapter_config
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LoopError::Validation("webhook adapter needs url".into()))?;
            Ok(Box::new(WebhookAdapter::new(url.to_string())))
        }
    }
}