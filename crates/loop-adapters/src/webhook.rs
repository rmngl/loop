use loop_core::adapter::{HeartbeatIn, HeartbeatOut};
use loop_core::error::{LoopError, Result};

use crate::traits::AgentAdapter;

pub struct WebhookAdapter {
    pub url: String,
}

impl WebhookAdapter {
    pub fn new(url: String) -> Self {
        Self { url }
    }
}

impl AgentAdapter for WebhookAdapter {
    fn heartbeat(&self, input: HeartbeatIn) -> Result<HeartbeatOut> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        let res = client
            .post(&self.url)
            .json(&input)
            .send()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(LoopError::AdapterFailed(format!(
                "webhook status {}",
                res.status()
            )));
        }
        let body = res
            .text()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        let line = body.lines().next().unwrap_or(body.trim());
        serde_json::from_str::<HeartbeatOut>(line)
            .map_err(|e| LoopError::AdapterFailed(format!("invalid JSON: {e}")))
    }
}