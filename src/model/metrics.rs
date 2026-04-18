use serde::{Deserialize, Serialize};

/// Lifecycle record for a single Claude CLI agent session.
///
/// A session spans from the first turn (when a new `session_id` is minted)
/// until the process exits cleanly, the conversation is cleared/rolled back,
/// or the workspace is archived.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub workspace_id: Option<String>,
    pub repository_id: String,
    pub started_at: String,
    pub last_message_at: String,
    pub ended_at: Option<String>,
    pub turn_count: i64,
    pub completed_ok: bool,
}

/// A git commit observed in a workspace's worktree during an agent session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommit {
    pub commit_hash: String,
    pub workspace_id: Option<String>,
    pub repository_id: String,
    pub session_id: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub files_changed: i64,
    pub committed_at: String,
}

/// Frozen lifetime aggregates captured when a workspace is hard-deleted.
///
/// Populated inside the same transaction as `delete_workspace`, BEFORE the
/// cascade wipes the raw rows. Keeps dashboard totals stable across deletes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedWorkspaceSummary {
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub repository_id: String,
    pub workspace_created_at: String,
    pub deleted_at: String,
    pub sessions_started: i64,
    pub sessions_completed: i64,
    pub total_turns: i64,
    pub total_session_duration_ms: i64,
    pub commits_made: i64,
    pub total_additions: i64,
    pub total_deletions: i64,
    pub total_files_changed: i64,
    pub messages_user: i64,
    pub messages_assistant: i64,
    pub messages_system: i64,
    pub total_cost_usd: f64,
    pub first_message_at: Option<String>,
    pub last_message_at: Option<String>,
    pub slash_commands_used: i64,
}
