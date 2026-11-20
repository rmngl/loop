use loop_core::domain::AdapterKind;
use loop_store::{AgentRepository, ApprovalRepository, BudgetRepository, CompanyRepository, HireAgentRequest, Store};
use tempfile::tempdir;

#[tokio::test]
async fn budget_warn_and_hard_stop() {
    let dir = tempdir().unwrap();
    let store = Store::connect(&dir.path().join("b.db")).await.unwrap();
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
                cron: "0 0 1 1 *".into(),
                monthly_budget_usd: 10.0,
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

    let budgets = BudgetRepository::new(&store);
    let s1 = budgets.record_spend(company.id, agent.id, 8.5).await.unwrap();
    assert!(s1.warn);
    assert!(!s1.exhausted);

    let s2 = budgets.record_spend(company.id, agent.id, 2.0).await.unwrap();
    assert!(s2.exhausted);

    let agent_row = AgentRepository::new(&store)
        .get(company.id, agent.id)
        .await
        .unwrap();
    assert_eq!(agent_row.paused_reason.as_deref(), Some("budget"));
}