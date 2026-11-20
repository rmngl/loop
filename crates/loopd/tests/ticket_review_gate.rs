use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn ticket_review_gate_happy_path() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("review.db");
    let state = Arc::new(AppState::new(db).await.unwrap());

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
        .json(&serde_json::json!({ "name": "ReviewCo", "mission": "Verify" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    let hire: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/agents"))
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
    let agent_id = hire["agent_id"].as_str().unwrap();
    let approval_id = hire["approval_id"].as_str().unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/approvals/{approval_id}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let ticket: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tickets"))
        .json(&serde_json::json!({ "title": "Task", "description": "work" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ticket_id = ticket["ticket_id"].as_str().unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/assign"
        ))
        .json(&serde_json::json!({ "agent_id": agent_id }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/submit-review"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let dash: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}/dashboard"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(dash["tickets_in_review"].as_u64(), Some(1));

    let list: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}/tickets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let status = list["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["ticket_id"] == ticket_id)
        .unwrap()["status"]
        .as_str()
        .unwrap();
    assert_eq!(status, "in_review");

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/approve-done"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let list2: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}/tickets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let status2 = list2["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["ticket_id"] == ticket_id)
        .unwrap()["status"]
        .as_str()
        .unwrap();
    assert_eq!(status2, "done");
}

#[tokio::test]
async fn ticket_review_request_changes() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("review2.db");
    let state = Arc::new(AppState::new(db).await.unwrap());

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
        .json(&serde_json::json!({ "name": "Rev2", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    let hire: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/agents"))
        .json(&serde_json::json!({
            "title": "Worker",
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
            "{base}/v1/companies/{company_id}/approvals/{approval_id}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let ticket: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tickets"))
        .json(&serde_json::json!({ "title": "T", "description": "" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ticket_id = ticket["ticket_id"].as_str().unwrap();

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/assign"
        ))
        .json(&serde_json::json!({ "agent_id": agent_id }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/submit-review"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    client
        .post(format!(
            "{base}/v1/companies/{company_id}/tickets/{ticket_id}/request-changes"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let list: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}/tickets"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let status = list["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["ticket_id"] == ticket_id)
        .unwrap()["status"]
        .as_str()
        .unwrap();
    assert_eq!(status, "in_progress");
}