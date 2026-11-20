//! Build with: `rustc echo_adapter.rs -o echo_adapter`
//! Reads one line JSON HeartbeatIn, writes one line HeartbeatOut.

use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let line = stdin.lock().lines().next();
    let _ = line;

    let out = r#"{"status":"ok","messages":["echo"],"cost":{"input_tokens":1,"output_tokens":1,"usd":0.1},"trace_events":[{"name":"echo","detail_json":{},"at":"2026-01-01T00:00:00Z"}]}"#;
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{out}").unwrap();
}