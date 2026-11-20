use loop_core::domain::{AdapterKind, AgentStatus};
use loop_store::{AgentRepository, ApprovalRepository, CompanyRepository, HireAgentRequest, Store};
use tempfile::tempdir;

#[tokio::test]
async fn agent_activate_becomes_active() {
    let dir = tempdir().unwrap();
    let store = Store::connect(&dir.path().join("a.db")).await.unwrap();
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
                cron: "0 0 * * *".into(),
                monthly_budget_usd: 1.0,
                parent_agent_id: None,
            },
        )
        .await
        .unwrap();
    ApprovalRepository::new(&store)
        .approve(company.id, approval_id)
        .await
        .unwrap();
    AgentRepository::new(&store)
        .activate_after_approval(company.id, agent.id)
        .await
        .unwrap();
    let row = AgentRepository::new(&store)
        .get(company.id, agent.id)
        .await
        .unwrap();
    assert_eq!(row.status, AgentStatus::Active);
}