use loop_core::domain::AdapterKind;
use loop_core::ids::{AgentId, CompanyId};
use loop_store::{AgentRepository, CompanyRepository, HireAgentRequest, Store};
use tempfile::tempdir;

#[tokio::test]
async fn company_isolation() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("test.db");
    let store = Store::connect(&db).await.expect("connect");

    let companies = CompanyRepository::new(&store);
    let a = companies.create("A", "mission A").await.unwrap();
    let b = companies.create("B", "mission B").await.unwrap();

    let agents = AgentRepository::new(&store);
    let (agent, _) = agents
        .create_pending(
            a.id,
            &HireAgentRequest {
                title: "CEO".into(),
                adapter_kind: AdapterKind::Mock,
                adapter_config: serde_json::json!({}),
                cron: "0 */4 * * *".into(),
                monthly_budget_usd: 10.0,
                parent_agent_id: None,
            },
        )
        .await
        .unwrap();

    let err = agents.get(b.id, agent.id).await;
    assert!(matches!(err, Err(loop_core::error::LoopError::NotFound(_))));

    let wrong = AgentId::new();
    let err = agents.get(a.id, wrong).await;
    assert!(matches!(err, Err(loop_core::error::LoopError::NotFound(_))));
}