use loop_core::error::{LoopError, Result};
use loop_core::ids::CompanyId;
use loop_store::{ApprovalRepository, Ticket};
use loop_store::AuditLog;

pub struct PolicyEngine<'a> {
    approvals: ApprovalRepository<'a>,
    audit: AuditLog<'a>,
}

impl<'a> PolicyEngine<'a> {
    pub fn new(approvals: ApprovalRepository<'a>, audit: AuditLog<'a>) -> Self {
        Self { approvals, audit }
    }

    pub async fn can_execute_ticket(
        &self,
        company_id: CompanyId,
        ticket: &Ticket,
    ) -> Result<()> {
        if ticket.tags.iter().any(|t| t == "strategy") {
            let approved = self
                .approvals
                .has_approved_strategy(company_id, &ticket.id.to_string())
                .await?;
            if !approved {
                return Err(LoopError::PolicyDenied(
                    "strategy ticket requires board approval".into(),
                ));
            }
        }
        Ok(())
    }

    pub async fn record_approval_resolution(
        &self,
        company_id: CompanyId,
        kind: &str,
        approval_id: &str,
    ) -> Result<()> {
        self.audit
            .append(
                company_id,
                "approval_resolved",
                serde_json::json!({
                    "kind": kind,
                    "approval_id": approval_id,
                    "status": "approved",
                }),
            )
            .await?;
        Ok(())
    }
}