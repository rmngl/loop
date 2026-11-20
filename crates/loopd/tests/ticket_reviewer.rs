use std::sync::Arc;

use loopd::{app, state::AppState};
use tempfile::tempdir;

#[tokio::test]
async fn submit_review_defaults_reviewer_to_assignee_manager() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("rev.db");
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
        .json(&serde_json::json!({ "name": "Co", "mission": "M" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let company_id = c["id"].as_str().unwrap();

    async fn hire_and_approve(
        client: &reqwest::Client,
        base: &str,
        company_id: &str,
        title: &str,
        parent: Option<&str>,
    ) -> String {
        let mut body = serde_json::json!({
            "title": title,
            "adapter_kind": "mock",
            "cron": "0 0 1 1 *",
            "monthly_budget_usd": 5.0
        });
        if let Some(p) = parent {
            body["parent_agent_id"] = serde_json::json!(p);
        }
        let hire: serde_json::Value = client
            .post(format!("{base}/v1/companies/{company_id}/agents"))
            .json(&body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let agent_id = hire["agent_id"].as_str().unwrap().to_string();
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
        agent_id
    }

    let ceo = hire_and_approve(&client, &base, company_id, "CEO", None).await;
    let ic = hire_and_approve(&client, &base, company_id, "IC", Some(&ceo)).await;

    let ticket: serde_json::Value = client
        .post(format!("{base}/v1/companies/{company_id}/tickets"))
        .json(&serde_json::json!({ "title": "Task", "description": "" }))
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
        .json(&serde_json::json!({ "agent_id": ic }))
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

    let detail: serde_json::Value = client
        .get(format!("{base}/v1/companies/{company_id}/tickets/{ticket_id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        detail["ticket"]["reviewer_agent_id"].as_str(),
        Some(ceo.as_str())
    );
    assert_eq!(detail["ticket"]["status"].as_str(), Some("in_review"));
}