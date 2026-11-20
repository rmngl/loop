use loop_core::domain::AdapterKind;
use loop_store::{
    AgentRepository, ApprovalRepository, BudgetRepository, CompanyRepository, HireAgentRequest, Store,
};
use tempfile::tempdir;

#[tokio::test]
async fn company_monthly_cap_blocks_when_exhausted() {
    let dir = tempdir().unwrap();
    let store = Store::connect(&dir.path().join("co.db")).await.unwrap();
    let repo = CompanyRepository::new(&store);
    let company = repo.create("C", "M").await.unwrap();
    repo.update_monthly_budget(company.id, Some(5.0)).await.unwrap();

    let (agent, approval_id) = AgentRepository::new(&store)
        .create_pending(
            company.id,
            &HireAgentRequest {
                title: "CEO".into(),
                adapter_kind: AdapterKind::Mock,
                adapter_config: serde_json::json!({}),
                cron: "0 0 1 1 *".into(),
                monthly_budget_usd: 100.0,
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
    assert!(budgets.company_has_room(company.id, Some(5.0)).await.unwrap());

    budgets.record_spend(company.id, agent.id, 4.0).await.unwrap();
    let status = budgets.company_cap_status(company.id, 5.0).await.unwrap();
    assert!(status.warn);
    assert!(!status.exhausted);
    assert!(budgets.company_has_room(company.id, Some(5.0)).await.unwrap());

    budgets.record_spend(company.id, agent.id, 1.5).await.unwrap();
    let status = budgets.company_cap_status(company.id, 5.0).await.unwrap();
    assert!(status.exhausted);
    assert!(!budgets.company_has_room(company.id, Some(5.0)).await.unwrap());
}