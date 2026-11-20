use std::env;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use loop_core::paths::db_path;
use loopd::{parse_listen_addr, serve};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let listen = env::var("LISTEN_ADDR").unwrap_or_else(|_| "127.0.0.1:7841".into());
    let addr = parse_listen_addr(&listen)?;
    let db = env::var("LOOP_DB_PATH")
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|_| db_path(None));

    let state = Arc::new(loopd::state::AppState::new(db).await?);

    let tick_state = Arc::clone(&state);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.tick().await;
        loop {
            interval.tick().await;
            let scheduler = tick_state.scheduler();
            if let Ok(_) = scheduler.tick(Utc::now()).await {
                let _ = scheduler.dispatch_pending().await;
            }
        }
    });

    serve(state, addr).await?;
    Ok(())
}