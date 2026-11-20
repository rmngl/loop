use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use loop_core::adapter::{HeartbeatIn, HeartbeatOut};
use loop_core::error::{LoopError, Result};

use crate::traits::AgentAdapter;

pub struct ProcessAdapter {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub extra_env: HashMap<String, String>,
}

impl ProcessAdapter {
    pub fn new(command: PathBuf, args: Vec<String>, cwd: Option<PathBuf>) -> Self {
        Self {
            command,
            args,
            cwd,
            extra_env: HashMap::new(),
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.extra_env.insert(key.into(), value.into());
        self
    }
}

impl AgentAdapter for ProcessAdapter {
    fn heartbeat(&self, input: HeartbeatIn) -> Result<HeartbeatOut> {
        let mut child = Command::new(&self.command);
        child
            .args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = &self.cwd {
            child.current_dir(cwd);
        }
        for (k, v) in &self.extra_env {
            child.env(k, v);
        }
        child.env("LOOP_COMPANY_ID", input.company_id.to_string());
        child.env("LOOP_AGENT_ID", input.agent_id.to_string());
        if let Some(url) = &input.context.loopd_url {
            child.env("LOOPD_URL", url);
        } else if let Ok(url) = std::env::var("LOOPD_URL") {
            child.env("LOOPD_URL", url);
        }

        let mut child = child
            .spawn()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;

        if let Some(mut stdin) = child.stdin.take() {
            let payload = serde_json::to_string(&input)
                .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
            stdin
                .write_all(payload.as_bytes())
                .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;
            stdin.write_all(b"\n").ok();
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LoopError::AdapterFailed("no stdout".into()))?;

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;

        let status = child
            .wait()
            .map_err(|e| LoopError::AdapterFailed(e.to_string()))?;

        if !status.success() && line.trim().is_empty() {
            return Err(LoopError::AdapterFailed(format!(
                "process exited {:?}",
                status.code()
            )));
        }

        if line.trim().is_empty() {
            return Err(LoopError::AdapterFailed(
                "adapter returned empty stdout".into(),
            ));
        }

        serde_json::from_str::<HeartbeatOut>(&line)
            .map_err(|e| LoopError::AdapterFailed(format!("invalid JSON: {e}")))
    }
}