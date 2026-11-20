pub mod routes;
pub mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use loop_core::error::{LoopError, Result};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::state::AppState;

pub fn parse_listen_addr(spec: &str) -> Result<SocketAddr> {
    let addr: SocketAddr = spec
        .parse()
        .map_err(|e| LoopError::Validation(format!("invalid LISTEN_ADDR: {e}")))?;
    if !addr.ip().is_loopback() {
        return Err(LoopError::Validation(
            "LISTEN_ADDR must be loopback in v1".into(),
        ));
    }
    Ok(addr)
}

pub fn app(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list([
            "http://localhost:5173".parse().expect("origin"),
            "http://127.0.0.1:5173".parse().expect("origin"),
            "tauri://localhost".parse().expect("origin"),
        ]))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);
    Router::new()
        .merge(routes::router())
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

pub async fn serve(state: Arc<AppState>, addr: SocketAddr) -> Result<()> {
    let app = app(state);
    info!("loopd listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| LoopError::Other(e.to_string()))?;
    axum::serve(listener, app)
        .await
        .map_err(|e| LoopError::Other(e.to_string()))?;
    Ok(())
}