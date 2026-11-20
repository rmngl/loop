use loop_store::{CompanyRepository, Store};
use tempfile::tempdir;

#[tokio::test]
async fn company_get_roundtrip() {
    let dir = tempdir().unwrap();
    let store = Store::connect(&dir.path().join("c.db")).await.unwrap();
    let created = CompanyRepository::new(&store)
        .create("C", "M")
        .await
        .unwrap();
    let fetched = CompanyRepository::new(&store)
        .get(created.id)
        .await
        .unwrap();
    assert_eq!(fetched.mission, "M");
}