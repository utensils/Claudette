use tauri::State;

use crate::commands::agent_backends::load_backend_secret;
use crate::state::AppState;
use crate::usage::{self, ClaudeCodeUsage};
use claudette::agent_backend::{AgentBackendConfig, AgentBackendKind};
use claudette::db::Database;
use claudette::process::CommandWindowExt as _;
use claudette::usage::{UsageSnapshot, anthropic_oauth, local_aggregate, openrouter};

#[tauri::command]
pub async fn get_claude_code_usage(state: State<'_, AppState>) -> Result<ClaudeCodeUsage, String> {
    usage::get_usage(&state.usage_cache).await
}

/// Per-session usage snapshot. Dispatches to the right source based on
/// the backend's kind and whether the user has opted in to the
/// experimental Anthropic OAuth Usage API.
///
/// The frontend passes the active backend config (kind, base_url, id,
/// default_model) rather than letting Rust look it up — the active
/// `selectedModelProvider` mapping lives in the Zustand toolbar slice
/// and isn't persisted to SQLite, so the frontend is the source of
/// truth. Any secret the backend needs (currently only the OpenRouter
/// `/auth/key` token) is loaded server-side via [`load_backend_secret`]
/// against the keychain, so the API key never crosses the IPC boundary.
#[tauri::command]
pub async fn get_session_usage(
    state: State<'_, AppState>,
    workspace_id: String,
    chat_session_id: String,
    backend: AgentBackendConfig,
    usage_insights_enabled: bool,
) -> Result<UsageSnapshot, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();

    // Anthropic-family backends (subscription OAuth lives behind the
    // experimental gate). When the gate is off, return the disabled-state
    // stub so the frontend renders the indicator in greyed mode without
    // leaking any per-session token data the user hasn't asked for.
    //
    // OpenAI / Custom OpenAI / Ollama / LM Studio also default to the
    // `claude_code` harness for gateway translation, but they go to the
    // local-aggregate branch below — the meter shows tokens recorded
    // by Claudette, not Anthropic OAuth quotas, so no gate applies.
    if is_claude_family(&backend.kind) {
        if !usage_insights_enabled {
            return Ok(UsageSnapshot::experimental_stub(backend.kind, now_ms));
        }
        return match anthropic_oauth::get_usage(&state.usage_cache).await {
            Ok(usage) => Ok(anthropic_oauth::snapshot_from_usage(
                &usage,
                backend.kind,
                now_ms,
            )),
            Err(e) => Err(e),
        };
    }

    // Non-Claude path: every backend gets the local-aggregate baseline,
    // and OpenRouter merges in its provider-specific credit bucket.
    let db = Database::open(&state.db_path).map_err(|e| format!("DB open failed: {e}"))?;

    let session = db
        .usage_session_totals(&chat_session_id)
        .map_err(|e| format!("session aggregate failed: {e}"))?;
    let today = db
        .usage_workspace_24h_totals(&workspace_id)
        .map_err(|e| format!("daily aggregate failed: {e}"))?;

    let default_model = backend.default_model.as_deref();

    // Provider-specific extras and label.
    let (source_label, extra_buckets) = match backend.kind {
        AgentBackendKind::CodexNative => {
            // Codex's app-server only exposes `plan_type` via `account/read`,
            // but the dispatcher doesn't currently hold a live app-server
            // connection. Until that's wired (deferred from this PR), the
            // label is just "Codex"; the local-aggregate token totals carry
            // the meter on their own. `codex_account::format_plan_label`
            // stays available so the wiring is a one-line change later.
            (String::from("Codex"), Vec::new())
        }
        AgentBackendKind::CustomOpenAi
            if openrouter::is_openrouter_base_url(backend.base_url.as_deref()) =>
        {
            // Read the user's OpenRouter API key from the keychain via the
            // same `load_secure_secret` path the agent runtime uses to
            // authenticate the model call itself. Frontend never sees the
            // key. Network errors are swallowed — the bucket simply doesn't
            // appear, and local-aggregate still carries the meter.
            let mut extras = Vec::new();
            if let Ok(Some(key)) = load_backend_secret(&backend.id)
                && !key.is_empty()
                && let Ok(Some(bucket)) = openrouter::fetch_credit_bucket(&key).await
            {
                extras.push(bucket);
            }
            (String::from("OpenRouter"), extras)
        }
        AgentBackendKind::OpenAiApi | AgentBackendKind::CustomOpenAi => {
            (String::from("OpenAI"), Vec::new())
        }
        AgentBackendKind::Ollama => (String::from("Ollama"), Vec::new()),
        AgentBackendKind::LmStudio => (String::from("LM Studio"), Vec::new()),
        #[cfg(feature = "pi-sdk")]
        AgentBackendKind::PiSdk => (String::from("Pi"), Vec::new()),
        // Anthropic-family already handled above; fall through for
        // forward-compat if a new variant is added without a matching
        // dispatch arm.
        AgentBackendKind::Anthropic
        | AgentBackendKind::CustomAnthropic
        | AgentBackendKind::CodexSubscription => (String::from("Claude"), Vec::new()),
    };

    Ok(local_aggregate::snapshot_from_locals(
        backend.kind,
        source_label,
        session,
        today,
        default_model,
        extra_buckets,
        now_ms,
    ))
}

fn is_claude_family(kind: &AgentBackendKind) -> bool {
    matches!(
        kind,
        AgentBackendKind::Anthropic
            | AgentBackendKind::CustomAnthropic
            | AgentBackendKind::CodexSubscription
    )
}

#[tauri::command]
pub async fn open_usage_settings() -> Result<(), String> {
    open_external_url("https://claude.ai/settings/usage").await
}

#[tauri::command]
pub async fn open_release_notes() -> Result<(), String> {
    open_external_url("https://github.com/utensils/Claudette/releases").await
}

async fn open_external_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .no_console_window()
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        // `start` treats its first quoted argument as a window title, so an
        // unquoted target containing spaces or quotes can be misparsed as a
        // title with no real target. The empty `""` slot neutralises that
        // quirk — current callers pass controlled URLs, but the defensive
        // form costs nothing and protects future callers.
        tokio::process::Command::new("cmd")
            .no_console_window()
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        tokio::process::Command::new("xdg-open")
            .no_console_window()
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
    }

    Ok(())
}
