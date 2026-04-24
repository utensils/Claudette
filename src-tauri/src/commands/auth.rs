use serde::Serialize;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

use claudette::process::CommandWindowExt as _;

use crate::state::AppState;

/// A line of output emitted while `claude auth login` runs.
#[derive(Clone, Serialize)]
pub struct AuthLoginProgress {
    /// `"stdout"` or `"stderr"` — lets the UI highlight errors differently.
    pub stream: &'static str,
    pub line: String,
}

/// Terminal event emitted when the subprocess exits (cleanly, on error, or killed).
#[derive(Clone, Serialize)]
pub struct AuthLoginComplete {
    pub success: bool,
    /// Non-null when `success` is false.
    pub error: Option<String>,
}

/// Spawn `claude auth login` and stream its output to the frontend.
///
/// The CLI runs its own localhost HTTP listener and opens the user's browser to
/// the OAuth URL; when the browser flow completes it captures the code via the
/// local callback and writes credentials to the keychain. We don't have to pipe
/// any code back through stdin — we just need to wait for the subprocess to exit.
///
/// Events emitted on `app`:
/// - `auth://login-progress` ([`AuthLoginProgress`]) — one per line of stdout/stderr
/// - `auth://login-complete` ([`AuthLoginComplete`]) — fired exactly once when the process ends
///
/// Returns immediately after spawning; the caller should subscribe to the events
/// above to drive UI state. Call [`cancel_claude_auth_login`] to abort.
#[tauri::command]
pub async fn claude_auth_login(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state.auth_login_child.lock().await;
    if slot.is_some() {
        return Err("A sign-in flow is already in progress.".into());
    }

    let claude_path = claudette::agent::resolve_claude_path().await;
    let mut child = Command::new(&claude_path)
        .no_console_window()
        .args(["auth", "login"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn `claude auth login`: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "claude auth login: missing stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "claude auth login: missing stderr pipe".to_string())?;

    tokio::spawn(stream_lines(app.clone(), "stdout", stdout));
    tokio::spawn(stream_lines_err(app.clone(), "stderr", stderr));

    *slot = Some(child);
    drop(slot);

    // Separate task owns the waitpid + completion event so the command can return
    // immediately and the UI can render a progress state without blocking IPC.
    let app_exit = app.clone();
    tokio::spawn(async move {
        use tauri::Manager;
        let state = app_exit.state::<AppState>();
        let mut slot = state.auth_login_child.lock().await;
        let Some(mut child) = slot.take() else {
            // Cancel ran first — it already emitted the completion event.
            return;
        };
        drop(slot);
        let event = match child.wait().await {
            Ok(status) if status.success() => AuthLoginComplete {
                success: true,
                error: None,
            },
            Ok(status) => AuthLoginComplete {
                success: false,
                error: Some(format!("`claude auth login` exited with {status}")),
            },
            Err(e) => AuthLoginComplete {
                success: false,
                error: Some(format!("Failed to wait on `claude auth login`: {e}")),
            },
        };
        let _ = app_exit.emit("auth://login-complete", event);
    });

    Ok(())
}

/// Kill any in-flight `claude auth login` subprocess.
///
/// Emits `auth://login-complete` with `success: false` so the UI can transition
/// out of the progress state. Safe to call when no flow is running.
#[tauri::command]
pub async fn cancel_claude_auth_login(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut slot = state.auth_login_child.lock().await;
    if let Some(mut child) = slot.take() {
        let _ = child.start_kill();
        // Reap asynchronously so the OS doesn't hold onto a zombie.
        tokio::spawn(async move {
            let _ = child.wait().await;
        });
        let _ = app.emit(
            "auth://login-complete",
            AuthLoginComplete {
                success: false,
                error: Some("Sign-in cancelled.".into()),
            },
        );
    }
    Ok(())
}

async fn stream_lines(app: AppHandle, stream: &'static str, pipe: ChildStdout) {
    let mut reader = BufReader::new(pipe).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        let _ = app.emit("auth://login-progress", AuthLoginProgress { stream, line });
    }
}

async fn stream_lines_err(app: AppHandle, stream: &'static str, pipe: ChildStderr) {
    let mut reader = BufReader::new(pipe).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        let _ = app.emit("auth://login-progress", AuthLoginProgress { stream, line });
    }
}
