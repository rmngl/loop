//! HTTP client for loopd tool gateway (evaluate / request-use / consume / invoke stub).

use loop_core::error::{LoopError, Result};
use loop_core::ids::{AgentId, CompanyId};
use reqwest::blocking::Client;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ToolEvaluateResponse {
    pub disposition: String,
    pub matched_pattern: Option<String>,
    pub allowed: bool,
    pub grant_id: Option<String>,
    pub pending_approval_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolInvokeResponse {
    pub tool: String,
    pub result: Value,
    pub disposition: String,
    pub grant_consumed: bool,
}

pub struct GatewayClient {
    base: String,
    client: Client,
}

impl GatewayClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base = base_url.into().trim_end_matches('/').to_string();
        Self {
            base,
            client: Client::new(),
        }
    }

    pub fn loopd_url_from_input(input: &loop_core::adapter::HeartbeatIn) -> String {
        input
            .context
            .loopd_url
            .clone()
            .or_else(|| std::env::var("LOOPD_URL").ok())
            .unwrap_or_else(|| "http://127.0.0.1:7841".to_string())
    }

    fn company_path(&self, company_id: CompanyId, path: &str) -> String {
        format!("{}/v1/companies/{}{}", self.base, company_id, path)
    }

    pub fn evaluate(
        &self,
        company_id: CompanyId,
        tool: &str,
        agent_id: Option<AgentId>,
    ) -> Result<ToolEvaluateResponse> {
        let mut body = serde_json::json!({ "tool": tool });
        if let Some(a) = agent_id {
            body["agent_id"] = serde_json::json!(a.to_string());
        }
        let res = self
            .client
            .post(self.company_path(company_id, "/tools/evaluate"))
            .json(&body)
            .send()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(LoopError::AdapterFailed(res.text().unwrap_or_default()));
        }
        let v: Value = res
            .json()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        Ok(ToolEvaluateResponse {
            disposition: v["disposition"].as_str().unwrap_or("").to_string(),
            matched_pattern: v["matched_pattern"].as_str().map(String::from),
            allowed: v["allowed"].as_bool().unwrap_or(false),
            grant_id: v["grant_id"].as_str().map(String::from),
            pending_approval_id: v["pending_approval_id"].as_str().map(String::from),
        })
    }

    pub fn request_use(
        &self,
        company_id: CompanyId,
        tool: &str,
        agent_id: Option<AgentId>,
    ) -> Result<Value> {
        let mut body = serde_json::json!({ "tool": tool });
        if let Some(a) = agent_id {
            body["agent_id"] = serde_json::json!(a.to_string());
        }
        let res = self
            .client
            .post(self.company_path(company_id, "/tools/request-use"))
            .json(&body)
            .send()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(LoopError::AdapterFailed(res.text().unwrap_or_default()));
        }
        res.json()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))
    }

    pub fn consume_grant(&self, company_id: CompanyId, grant_id: &str) -> Result<()> {
        let res = self
            .client
            .post(self.company_path(company_id, "/tools/consume"))
            .json(&serde_json::json!({ "grant_id": grant_id }))
            .send()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(LoopError::AdapterFailed(res.text().unwrap_or_default()));
        }
        Ok(())
    }

    /// Policy-gated stub invoke (loopd does not call real MCP yet).
    pub fn invoke(
        &self,
        company_id: CompanyId,
        tool: &str,
        agent_id: Option<AgentId>,
        input: Option<Value>,
    ) -> Result<ToolInvokeResponse> {
        let mut body = serde_json::json!({ "tool": tool });
        if let Some(a) = agent_id {
            body["agent_id"] = serde_json::json!(a.to_string());
        }
        if let Some(inp) = input {
            body["input"] = inp;
        }
        let res = self
            .client
            .post(self.company_path(company_id, "/tools/invoke"))
            .json(&body)
            .send()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(LoopError::AdapterFailed(res.text().unwrap_or_default()));
        }
        let v: Value = res
            .json()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
        Ok(ToolInvokeResponse {
            tool: v["tool"].as_str().unwrap_or(tool).to_string(),
            result: v["result"].clone(),
            disposition: v["disposition"].as_str().unwrap_or("").to_string(),
            grant_consumed: v["grant_consumed"].as_bool().unwrap_or(false),
        })
    }
}