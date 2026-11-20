use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn tool_invoke_stub_when_policy_allows() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState::new(dir.path().join("invoke.db")).await.unwrap());

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
        .json(&serde_json::json!({ "name": "InvokeCo", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    let inv: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/invoke"))
        .json(&serde_json::json!({
            "tool": "mcp:mock:echo",
            "input": { "hello": "world" }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(inv["status"], "invoked");
    assert_eq!(inv["result"]["stub"], true);

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

    let denied = client
        .post(format!("{base}/v1/companies/{company_id}/tools/invoke"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 403);

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

    client
        .post(format!(
            "{base}/v1/companies/{company_id}/approvals/{approval_id}/approve"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let inv2: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tools/invoke"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(inv2["status"], "invoked");
    assert_eq!(inv2["grant_consumed"], true);

    let denied2 = client
        .post(format!("{base}/v1/companies/{company_id}/tools/invoke"))
        .json(&serde_json::json!({ "tool": "mcp:deploy:prod" }))
        .send()
        .await
        .unwrap();
    assert_eq!(denied2.status(), 403);
}