mod gateway_client;
mod hermes;
mod mock;
mod process;
mod registry;
mod traits;
mod webhook;

pub use gateway_client::{GatewayClient, ToolEvaluateResponse, ToolInvokeResponse};
pub use hermes::HermesAdapter;
pub use mock::MockAdapter;
pub use process::ProcessAdapter;
pub use registry::adapter_for;
pub use webhook::WebhookAdapter;
pub use traits::{write_ndjson_line, AgentAdapter};