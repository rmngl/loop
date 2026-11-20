use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};

struct LoopdGuard(Mutex<Option<Child>>);

fn loopd_binary() -> PathBuf {
    if let Ok(path) = std::env::var("LOOPD_BIN") {
        return PathBuf::from(path);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let debug = manifest.join("../../../target/debug/loopd");
    if debug.exists() {
        return debug;
    }
    let release = manifest.join("../../../target/release/loopd");
    if release.exists() {
        return release;
    }
    PathBuf::from("loopd")
}

fn data_dir() -> PathBuf {
    std::env::var("LOOP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("loop"))
}

fn spawn_loopd() -> std::io::Result<Child> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let db = dir.join("loop.db");
    Command::new(loopd_binary())
        .env("LOOP_DB_PATH", db)
        .env("LISTEN_ADDR", "127.0.0.1:7841")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn wait_for_health() {
    for _ in 0..60 {
        if std::net::TcpStream::connect("127.0.0.1:7841").is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let child = if std::net::TcpStream::connect("127.0.0.1:7841").is_ok() {
        None
    } else {
        let c = spawn_loopd().expect("failed to spawn loopd");
        wait_for_health();
        Some(c)
    };

    tauri::Builder::default()
        .manage(LoopdGuard(Mutex::new(child)))
        .build(tauri::generate_context!())
        .expect("error building tauri")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(guard) = app_handle.try_state::<LoopdGuard>() {
                    if let Ok(mut slot) = guard.0.lock() {
                        if let Some(mut child) = slot.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}