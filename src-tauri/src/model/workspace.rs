use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub repository_id: String,
    pub name: String,
    pub branch: String,
    pub worktree_path: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub repository_id: String,
    pub name: String,
    pub branch: String,
    pub base_branch: Option<String>,
}
