use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use claudette::db::Database;
use claudette::git;
use claudette::model::{Repository, Workspace};

use crate::state::AppState;

#[derive(Serialize)]
pub struct InitialData {
    pub repositories: Vec<Repository>,
    pub workspaces: Vec<Workspace>,
    pub worktree_base_dir: String,
    /// Maps repo ID → default branch name (e.g., "main", "master").
    pub default_branches: HashMap<String, String>,
}

#[tauri::command]
pub async fn load_initial_data(state: State<'_, AppState>) -> Result<InitialData, String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;

    let repositories = db.list_repositories().map_err(|e| e.to_string())?;
    let workspaces = db.list_workspaces().map_err(|e| e.to_string())?;

    let worktree_base_dir = {
        let dir = state.worktree_base_dir.read().await;
        dir.to_string_lossy().to_string()
    };

    // Check which repo paths are still valid on disk.
    let repositories: Vec<Repository> = repositories
        .into_iter()
        .map(|mut r| {
            r.path_valid = std::path::Path::new(&r.path).is_dir();
            r
        })
        .collect();

    // Resolve default branch for each valid repo (best-effort).
    let mut default_branches = HashMap::new();
    for repo in &repositories {
        if repo.path_valid
            && let Ok(branch) = git::default_branch(&repo.path).await
        {
            default_branches.insert(repo.id.clone(), branch);
        }
    }

    Ok(InitialData {
        repositories,
        workspaces,
        worktree_base_dir,
        default_branches,
    })
}
