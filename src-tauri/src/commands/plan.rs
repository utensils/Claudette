/// Read a plan file from disk and return its content.
#[tauri::command]
pub async fn read_plan_file(path: String) -> Result<String, String> {
    // Only allow reading .md files from .claude/plans/ directories for safety.
    if !path.contains(".claude/plans/") || !path.ends_with(".md") {
        return Err("Only .claude/plans/*.md files can be read".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read plan file: {e}"))
}
