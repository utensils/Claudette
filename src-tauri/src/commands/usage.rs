use tauri::State;

use crate::state::AppState;
use crate::usage::{self, ClaudeCodeUsage};

#[tauri::command]
pub async fn get_claude_code_usage(state: State<'_, AppState>) -> Result<ClaudeCodeUsage, String> {
    usage::get_usage(&state.usage_cache).await
}
