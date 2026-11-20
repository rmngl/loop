use loop_core::adapter::{HeartbeatIn, HeartbeatOut};
use loop_core::error::Result;
use std::io::Write;

pub trait AgentAdapter: Send + Sync {
    fn heartbeat(&self, input: HeartbeatIn) -> Result<HeartbeatOut>;
}

pub fn write_ndjson_line<W: Write>(writer: &mut W, value: &HeartbeatOut) -> Result<()> {
    let line = serde_json::to_string(value).map_err(|e| {
        loop_core::error::LoopError::Other(format!("json encode: {e}"))
    })?;
    writeln!(writer, "{line}").map_err(loop_core::error::LoopError::Io)?;
    Ok(())
}