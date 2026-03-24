use std::sync::Arc;

use tokio::sync::Mutex;

use iced::Task;
use iced::widget::markdown;

use crate::agent;
use crate::app::ActiveTurn;
use crate::db::Database;
use crate::message::Message;
use crate::model::{ChatMessage, ChatRole};

use super::App;

impl App {
    pub(crate) fn handle_chat_input_changed(&mut self, text: String) {
        self.chat_input = text;
        self.chat_history_index = None;
        self.chat_history_draft.clear();
    }

    pub(crate) fn handle_chat_send(&mut self) -> Task<Message> {
        let Some(ws_id) = self.selected_workspace.clone() else {
            return Task::none();
        };
        let content = self.chat_input.trim().to_string();
        if content.is_empty() {
            return Task::none();
        }
        let Some(session) = self.agents.get(&ws_id) else {
            return Task::none();
        };
        // Don't send if a turn is already in progress
        if session.active_turn.is_some() {
            return Task::none();
        }
        let session_id = session.session_id.clone();
        let is_resume = session.turn_count > 0;
        self.chat_input.clear();
        self.chat_history_index = None;
        self.chat_history_draft.clear();

        // Get worktree path for spawning the turn
        let worktree_path = self
            .workspaces
            .iter()
            .find(|w| w.id == ws_id)
            .and_then(|w| w.worktree_path.clone());
        let Some(worktree_path) = worktree_path else {
            return Task::none();
        };

        // Create user message
        let user_msg = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: ws_id.clone(),
            role: ChatRole::User,
            content: content.clone(),
            cost_usd: None,
            duration_ms: None,
            created_at: String::new(),
        };

        self.chat_messages
            .entry(ws_id.clone())
            .or_default()
            .push(user_msg.clone());
        self.rebuild_markdown_cache(&ws_id);

        // Spawn per-turn agent process
        let mut tasks = vec![];
        tasks.push(Task::perform(
            async move {
                let turn_handle = agent::run_turn(
                    std::path::Path::new(&worktree_path),
                    &session_id,
                    &content,
                    is_resume,
                )
                .await?;

                let active_turn = ActiveTurn {
                    event_rx: Arc::new(Mutex::new(Some(turn_handle.event_rx))),
                    pid: turn_handle.pid,
                };

                Ok((ws_id.clone(), active_turn))
            },
            Message::AgentTurnStarted,
        ));

        // Persist user message
        let db_path = self.db_path.clone();
        tasks.push(Task::perform(
            async move {
                let db = Database::open(&db_path).map_err(|e| e.to_string())?;
                db.insert_chat_message(&user_msg)
                    .map_err(|e| e.to_string())?;
                Ok(user_msg)
            },
            Message::ChatMessageSaved,
        ));

        Task::batch(tasks)
    }

    pub(crate) fn handle_chat_message_saved(&self, result: Result<ChatMessage, String>) {
        if let Err(e) = result {
            eprintln!("Failed to save chat message: {e}");
        }
    }

    pub(crate) fn handle_chat_history_loaded(
        &mut self,
        ws_id: String,
        result: Result<Vec<ChatMessage>, String>,
    ) {
        match result {
            Ok(messages) => {
                self.chat_messages.insert(ws_id.clone(), messages);
                self.rebuild_markdown_cache(&ws_id);
            }
            Err(e) => {
                eprintln!("Failed to load chat history: {e}");
            }
        }
    }

    pub(crate) fn handle_chat_history_up(&mut self) {
        let history = self.user_message_history();
        if history.is_empty() {
            return;
        }
        match self.chat_history_index {
            None => {
                self.chat_history_draft = self.chat_input.clone();
                self.chat_history_index = Some(0);
                self.chat_input = history[0].clone();
            }
            Some(i) => {
                if i + 1 < history.len() {
                    self.chat_history_index = Some(i + 1);
                    self.chat_input = history[i + 1].clone();
                }
            }
        }
    }

    pub(crate) fn handle_chat_history_down(&mut self) {
        match self.chat_history_index {
            None => {}
            Some(0) => {
                self.chat_input = std::mem::take(&mut self.chat_history_draft);
                self.chat_history_index = None;
            }
            Some(i) => {
                let history = self.user_message_history();
                self.chat_history_index = Some(i - 1);
                if let Some(msg) = history.get(i - 1) {
                    self.chat_input = msg.clone();
                }
            }
        }
    }

    /// Returns user-sent messages for the current workspace, newest first.
    fn user_message_history(&self) -> Vec<String> {
        let Some(ws_id) = &self.selected_workspace else {
            return vec![];
        };
        let Some(messages) = self.chat_messages.get(ws_id) else {
            return vec![];
        };
        messages
            .iter()
            .rev()
            .filter(|m| m.role == ChatRole::User)
            .map(|m| m.content.clone())
            .collect()
    }

    pub(crate) fn handle_chat_link_clicked(&self, url: &str) {
        if let Err(e) = open::that(url) {
            eprintln!("Failed to open URL {url}: {e}");
        }
    }

    pub(crate) fn rebuild_markdown_cache(&mut self, ws_id: &str) {
        if let Some(messages) = self.chat_messages.get(ws_id) {
            let cache = self
                .markdown_cache
                .entry(ws_id.to_string())
                .or_insert_with(|| Vec::with_capacity(messages.len()));

            // Truncate if messages were removed
            if cache.len() > messages.len() {
                cache.truncate(messages.len());
            }

            // Only parse new messages beyond what's already cached
            for msg in messages.iter().skip(cache.len()) {
                if msg.role == ChatRole::Assistant {
                    cache.push(markdown::parse(&msg.content).collect());
                } else {
                    cache.push(Vec::new());
                }
            }
        }
    }

    /// Resets chat history navigation state.
    pub(crate) fn reset_chat_history(&mut self) {
        self.chat_history_index = None;
        self.chat_history_draft.clear();
    }
}
