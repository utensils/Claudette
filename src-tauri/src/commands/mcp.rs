//! Tauri commands for MCP configuration detection and management

use claudette::db::Database;
use claudette::mcp::{detect_mcp_servers as detect_mcp, write_workspace_mcp_config, McpServer};
use std::path::PathBuf;
use tauri::State;

use crate::state::AppState;

/// Detect all MCP servers for a repository
#[tauri::command]
pub async fn detect_mcp_servers(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<McpServer>, String> {
    // Get repository path from database
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    let repo = db
        .get_repository(&repo_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Repository not found: {}", repo_id))?;

    let repo_path = PathBuf::from(&repo.path);

    // Detect MCP servers
    detect_mcp(&repo_path).await
}

/// Write MCP configuration to workspace .claude.json
#[tauri::command]
pub async fn configure_workspace_mcps(
    workspace_id: String,
    servers: Vec<McpServer>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get workspace worktree path from database
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    let workspaces = db.list_workspaces().map_err(|e| e.to_string())?;

    let workspace = workspaces
        .into_iter()
        .find(|ws| ws.id == workspace_id)
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?;

    let worktree_path = workspace
        .worktree_path
        .ok_or_else(|| format!("Workspace {} has no worktree path", workspace_id))?;

    let worktree_path = PathBuf::from(&worktree_path);

    // Write MCP configuration
    write_workspace_mcp_config(&worktree_path, &servers).await
}

/// Read workspace .claude.json MCP configuration
#[tauri::command]
pub async fn read_workspace_mcps(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<McpServer>, String> {
    use claudette::mcp::McpScope;

    // Get workspace worktree path
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    let workspaces = db.list_workspaces().map_err(|e| e.to_string())?;

    let workspace = workspaces
        .into_iter()
        .find(|ws| ws.id == workspace_id)
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?;

    let worktree_path = workspace
        .worktree_path
        .ok_or_else(|| format!("Workspace {} has no worktree path", workspace_id))?;

    let worktree_path = PathBuf::from(&worktree_path);
    let config_path = worktree_path.join(".claude.json");

    // Parse .claude.json in worktree (use Local scope since it's workspace-specific)
    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read .claude.json: {}", e))?;

    #[derive(serde::Deserialize)]
    struct ClaudeConfig {
        #[serde(rename = "mcpServers")]
        #[serde(default)]
        mcp_servers: Option<std::collections::HashMap<String, claudette::mcp::McpServerConfig>>,
    }

    let config: ClaudeConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Malformed .claude.json: {}", e))?;

    let Some(mcp_servers) = config.mcp_servers else {
        return Ok(Vec::new());
    };

    let mut servers = Vec::new();
    for (name, config) in mcp_servers {
        servers.push(McpServer {
            name,
            config,
            scope: McpScope::Local,
        });
    }

    Ok(servers)
}
