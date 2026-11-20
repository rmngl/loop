use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn tool_gateway_evaluate_respects_policy() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState::new(dir.path().join("tg.db")).await.unwrap());

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
        .json(&serde_json::json!({ "name": "ToolCo", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    let eval: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:test:run" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(eval["disposition"], "allow");
    assert_eq!(eval["allowed"], true);

    client
        .post(format!("{base}/v1/companies/{company_id}/tool-policies"))
        .json(&serde_json::json!({
            "tool_pattern": "mcp:test:*",
            "disposition": "block"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let eval2: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/evaluate"))
        .json(&serde_json::json!({ "tool": "mcp:test:run" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(eval2["disposition"], "block");
    assert_eq!(eval2["allowed"], false);
}