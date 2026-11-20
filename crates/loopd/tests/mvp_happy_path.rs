use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn mvp_happy_path() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("mvp.db");
    let state = Arc::new(AppState::new(db).await.unwrap());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = app(Arc::clone(&state));
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::new();
    let base = format!("http://{addr}");

    let c1: serde_json::Value = client
        .post(format!("{base}/v1/companies"))
        .json(&serde_json::json!({ "name": "C1", "mission": "MVP" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let c1_id = c1["id"].as_str().unwrap();

    let hire: serde_json::Value = client
        .post(format!("{base}/v1/companies/{c1_id}/agents"))
        .json(&serde_json::json!({
            "title": "CEO",
            "adapter_kind": "mock",
            "cron": "0 0 1 1 *",
            "monthly_budget_usd": 1.0
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let agent_id = hire["agent_id"].as_str().unwrap();
    let approval_id = hire["approval_id"].as_str().unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{c1_id}/approvals/{approval_id}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let ticket: serde_json::Value = client
        .post(format!("{base}/v1/companies/{c1_id}/tickets"))
        .json(&serde_json::json!({ "title": "Ship", "description": "go" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ticket_id = ticket["ticket_id"].as_str().unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{c1_id}/tickets/{ticket_id}/assign"
        ))
        .json(&serde_json::json!({ "agent_id": agent_id }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let hb: serde_json::Value = client
        .post(format!(
            "{base}/v1/companies/{c1_id}/agents/{agent_id}/heartbeat"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(hb["dispatched"].as_u64().unwrap(), 1);

    let budgets: serde_json::Value = client
        .get(format!("{base}/v1/companies/{c1_id}/budgets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let remaining = budgets["agents"][0]["remaining_usd"].as_f64().unwrap();
    assert!(remaining < 1.0);

    for _ in 0..5 {
        client
            .post(format!(
                "{base}/v1/companies/{c1_id}/agents/{agent_id}/heartbeat"
            ))
            .send()
            .await
            .unwrap();
    }
    let budgets_after: serde_json::Value = client
        .get(format!("{base}/v1/companies/{c1_id}/budgets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        budgets_after["agents"][0]["paused_reason"].as_str(),
        Some("budget")
    );

    let c2: serde_json::Value = client
        .post(format!("{base}/v1/companies"))
        .json(&serde_json::json!({ "name": "C2", "mission": "Other" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let c2_id = c2["id"].as_str().unwrap();

    let err = client
        .get(format!("{base}/v1/companies/{c2_id}/agents/{agent_id}/heartbeat"))
        .send()
        .await
        .unwrap();
    assert!(err.status().is_client_error() || err.status().is_server_error());

    let audit: serde_json::Value = client
        .get(format!("{base}/v1/companies/{c1_id}/audit"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(audit["entries"].as_array().unwrap().len() >= 1);
}