use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn company_cap_increase_requires_approval() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState::new(dir.path().join("cbc.db")).await.unwrap());

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
        .json(&serde_json::json!({ "name": "CapCo", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    let denied = client
        .patch(format!("{base}/v1/companies/{company_id}"))
        .json(&serde_json::json!({ "monthly_budget_usd": 500.0 }))
        .send()
        .await
        .unwrap();
    assert!(!denied.status().is_success());

    let req: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/company-budget-increase"))
        .json(&serde_json::json!({ "new_cap_usd": 500.0 }))
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

    let company: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(company["monthly_budget_usd"].as_f64(), Some(500.0));

    let lowered = client
        .patch(format!("{base}/v1/companies/{company_id}"))
        .json(&serde_json::json!({ "monthly_budget_usd": 400.0 }))
        .send()
        .await
        .unwrap();
    lowered.error_for_status().unwrap();

    let company: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(company["monthly_budget_usd"].as_f64(), Some(400.0));
}