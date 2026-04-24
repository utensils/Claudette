//! Tauri commands for the env-provider diagnostic UI.
//!
//! The env-provider system runs silently in the background — every
//! workspace spawn already gets the merged env without asking. These
//! commands expose read + reload surfaces so the UI can tell the user
//! *why* a variable is (or isn't) set, and let them force a
//! re-evaluation (e.g. after running `direnv allow`).
//!
//! Nothing here mutates the workspace or database state — reload just
//! evicts the in-memory cache, and the next spawn/resolve recomputes.

use std::path::Path;

use serde::Serialize;
use tauri::State;

use claudette::db::Database;

use crate::state::AppState;

/// Snapshot of one plugin's contribution for a workspace.
///
/// Mirrors [`claudette::env_provider::ResolvedSource`] but uses
/// serializable timestamps (ms since epoch) since `SystemTime` isn't
/// directly serde-friendly across the IPC boundary.
#[derive(Serialize)]
pub struct EnvSourceInfo {
    pub plugin_name: String,
    pub detected: bool,
    pub vars_contributed: usize,
    pub cached: bool,
    /// Milliseconds since the Unix epoch. Frontend formats this
    /// relative to `Date.now()` ("evaluated 3s ago").
    pub evaluated_at_ms: u128,
    pub error: Option<String>,
}

/// Return the list of env-provider plugins that ran (or would run) for
/// this workspace, along with how many vars each contributed and
/// whether the result is cached.
///
/// Side effect: this triggers a full `resolve_for_workspace` pass,
/// which respects the mtime cache — so repeated calls during a quiet
/// period are cheap.
#[tauri::command]
pub async fn get_workspace_env_sources(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<EnvSourceInfo>, String> {
    let (worktree, ws_info) = lookup_ws_context(&state, &workspace_id).await?;
    let registry = state.plugins.read().await;
    let resolved = claudette::env_provider::resolve_with_registry(
        &registry,
        &state.env_cache,
        Path::new(&worktree),
        &ws_info,
    )
    .await;

    let sources = resolved
        .sources
        .into_iter()
        .map(|s| EnvSourceInfo {
            plugin_name: s.plugin_name,
            detected: s.detected,
            vars_contributed: s.vars_contributed,
            cached: s.cached,
            evaluated_at_ms: s
                .evaluated_at
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            error: s.error,
        })
        .collect();
    Ok(sources)
}

/// Evict the env-provider cache for a workspace, forcing a fresh
/// `export` call on the next spawn / diagnostic query.
///
/// If `plugin_name` is provided, only that plugin's cache entry is
/// dropped. Otherwise every plugin's entry for this worktree is
/// dropped.
#[tauri::command]
pub async fn reload_workspace_env(
    workspace_id: String,
    plugin_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (worktree, _) = lookup_ws_context(&state, &workspace_id).await?;
    state
        .env_cache
        .invalidate(Path::new(&worktree), plugin_name.as_deref());
    Ok(())
}

/// Load workspace + repo from the DB and build a [`WorkspaceInfo`] for
/// env-provider invocation. Shared by all commands in this module.
async fn lookup_ws_context(
    state: &AppState,
    workspace_id: &str,
) -> Result<(String, claudette::plugin_runtime::host_api::WorkspaceInfo), String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    let ws = db
        .list_workspaces()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;
    let worktree = ws
        .worktree_path
        .clone()
        .ok_or("Workspace has no worktree")?;
    let repo = db
        .get_repository(&ws.repository_id)
        .map_err(|e| e.to_string())?
        .ok_or("Repository not found")?;

    let ws_info = claudette::plugin_runtime::host_api::WorkspaceInfo {
        id: ws.id.clone(),
        name: ws.name.clone(),
        branch: ws.branch_name.clone(),
        worktree_path: worktree.clone(),
        repo_path: repo.path,
    };
    Ok((worktree, ws_info))
}
