use std::path::PathBuf;

use loop_core::adapter::{HeartbeatIn, HeartbeatOut};
use loop_core::error::Result;
use serde_json::to_string;

use crate::process::ProcessAdapter;
use crate::traits::AgentAdapter;

/// Hermes adapter: spawns `hermes` (or custom bin) with LOOP_* env until official RPC lands.
pub struct HermesAdapter {
    inner: ProcessAdapter,
}

impl HermesAdapter {
    pub fn new(hermes_bin: PathBuf) -> Self {
        Self {
            inner: ProcessAdapter::new(
                hermes_bin,
                vec!["loop-heartbeat".into()],
                None,
            ),
        }
    }

    fn apply_loop_env(adapter: ProcessAdapter, input: &HeartbeatIn) -> ProcessAdapter {
        let mut a = adapter
            .with_env("LOOP_AGENT", "1")
            .with_env("LOOP_COMPANY_ID", input.company_id.to_string())
            .with_env("LOOP_AGENT_ID", input.agent_id.to_string());
        if let Ok(ctx) = to_string(&input.context) {
            a = a.with_env("LOOP_TICKET_CONTEXT", ctx);
        }
        a
    }
}

impl AgentAdapter for HermesAdapter {
    fn heartbeat(&self, input: HeartbeatIn) -> Result<HeartbeatOut> {
        let adapter = Self::apply_loop_env(
            ProcessAdapter::new(
                self.inner.command.clone(),
                self.inner.args.clone(),
                self.inner.cwd.clone(),
            ),
            &input,
        );
        adapter.heartbeat(input)
    }
}