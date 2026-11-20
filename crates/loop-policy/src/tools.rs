use loop_core::error::Result;
use loop_core::ids::{AgentId, CompanyId};
use loop_core::tool_policy::ToolDisposition;
use loop_store::{AuditLog, ToolPolicyRepository};

#[derive(Debug, Clone)]
pub struct ToolEvaluateResult {
    pub disposition: ToolDisposition,
    pub matched_pattern: Option<String>,
}

pub struct ToolGateway<'a> {
    policies: ToolPolicyRepository<'a>,
    audit: AuditLog<'a>,
}

impl<'a> ToolGateway<'a> {
    pub fn new(policies: ToolPolicyRepository<'a>, audit: AuditLog<'a>) -> Self {
        Self { policies, audit }
    }

    pub async fn evaluate(
        &self,
        company_id: CompanyId,
        tool_name: &str,
        agent_id: Option<AgentId>,
    ) -> Result<ToolEvaluateResult> {
        let (disposition, matched_pattern) = self.policies.evaluate(company_id, tool_name).await?;

        if disposition != ToolDisposition::Allow {
            self.audit
                .append(
                    company_id,
                    "tool_gateway_evaluate",
                    serde_json::json!({
                        "tool": tool_name,
                        "disposition": disposition.as_str(),
                        "matched_pattern": matched_pattern,
                        "agent_id": agent_id.map(|a| a.to_string()),
                    }),
                )
                .await?;
        }

        Ok(ToolEvaluateResult {
            disposition,
            matched_pattern,
        })
    }
}