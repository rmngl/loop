use loop_core::tool_policy::ToolDisposition;
use loop_store::{CompanyRepository, Store, ToolPolicyRepository};
use tempfile::tempdir;

#[tokio::test]
async fn tool_policy_wildcard_and_precedence() {
    let dir = tempdir().unwrap();
    let store = Store::connect(&dir.path().join("tp.db")).await.unwrap();
    let company = CompanyRepository::new(&store).create("C", "M").await.unwrap();
    let repo = ToolPolicyRepository::new(&store);

    repo.upsert(company.id, "mcp:*", ToolDisposition::Allow)
        .await
        .unwrap();
    repo.upsert(company.id, "mcp:secrets:*", ToolDisposition::Block)
        .await
        .unwrap();
    repo.upsert(company.id, "mcp:github:create_pr", ToolDisposition::Ask)
        .await
        .unwrap();

    let (d, p) = repo
        .evaluate(company.id, "mcp:filesystem:read")
        .await
        .unwrap();
    assert_eq!(d, ToolDisposition::Allow);
    assert_eq!(p.as_deref(), Some("mcp:*"));

    let (d, _) = repo
        .evaluate(company.id, "mcp:secrets:read")
        .await
        .unwrap();
    assert_eq!(d, ToolDisposition::Block);

    let (d, p) = repo
        .evaluate(company.id, "mcp:github:create_pr")
        .await
        .unwrap();
    assert_eq!(d, ToolDisposition::Ask);
    assert_eq!(p.as_deref(), Some("mcp:github:create_pr"));
}