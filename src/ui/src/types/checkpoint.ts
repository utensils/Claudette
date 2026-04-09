export interface ConversationCheckpoint {
  id: string;
  workspace_id: string;
  message_id: string;
  commit_hash: string | null;
  turn_index: number;
  created_at: string;
}
