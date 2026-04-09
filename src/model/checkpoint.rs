use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationCheckpoint {
    pub id: String,
    pub workspace_id: String,
    pub message_id: String,
    pub commit_hash: Option<String>,
    pub turn_index: i32,
    pub created_at: String,
}
