use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn strategy_ticket_blocked_until_approval() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState::new(dir.path().join("s.db")).await.unwrap());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = app(Arc::clone(&state));
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::new();
    let base = format!("http://{addr}");

    let c: serde_json::Value = client
        .post(format!("{base}/v1/companies"))
        .json(&serde_json::json!({ "name": "S", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = c["id"].as_str().unwrap();

    let hire: serde_json::Value = client
        .post(format!("{base}/v1/companies/{cid}/agents"))
        .json(&serde_json::json!({
            "title": "CEO",
            "adapter_kind": "mock",
            "cron": "0 0 1 1 *",
            "monthly_budget_usd": 5.0
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    client
        .post(format!(
            "{base}/v1/companies/{cid}/approvals/{}/approve",
            hire["approval_id"].as_str().unwrap()
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let ticket: serde_json::Value = client
        .post(format!("{base}/v1/companies/{cid}/tickets"))
        .json(&serde_json::json!({
            "title": "Strategy move",
            "description": "big",
            "tags": ["strategy"]
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tid = ticket["ticket_id"].as_str().unwrap();
    let strategy_approval = ticket["strategy_approval_id"].as_str().unwrap();
    let agent_id = hire["agent_id"].as_str().unwrap();

    let blocked = client
        .post(format!("{base}/v1/companies/{cid}/tickets/{tid}/assign"))
        .json(&serde_json::json!({ "agent_id": agent_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked.status(), 403);

    client
        .post(format!(
            "{base}/v1/companies/{cid}/approvals/{strategy_approval}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{base}/v1/companies/{cid}/tickets/{tid}/assign"))
        .json(&serde_json::json!({ "agent_id": agent_id }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
}