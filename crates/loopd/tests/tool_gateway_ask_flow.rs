use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn tool_ask_approve_grant_consume() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState::new(dir.path().join("ask.db")).await.unwrap());

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
        .json(&serde_json::json!({ "name": "AskCo", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    client
        .post(format!("{base}/v1/companies/{company_id}/tool-policies"))
        .json(&serde_json::json!({
            "tool_pattern": "mcp:deploy:*",
            "disposition": "ask"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let denied: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(denied["disposition"], "ask");
    assert_eq!(denied["allowed"], false);

    let req: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/request-use"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let approval_id = req["approval_id"].as_str().unwrap();

    let pending: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(pending["allowed"], false);
    assert_eq!(pending["pending_approval_id"].as_str(), Some(approval_id));

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/approvals/{approval_id}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let granted: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(granted["allowed"], true);
    let grant_id = granted["grant_id"].as_str().unwrap().to_string();

    client
        .post(format!("{base}/v1/companies/{company_id}/tools/consume"))
        .json(&serde_json::json!({ "grant_id": grant_id }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let after: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after["allowed"], false);
    assert_eq!(after["disposition"], "ask");
}