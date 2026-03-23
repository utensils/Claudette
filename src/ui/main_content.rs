use std::collections::HashMap;

use iced::widget::{Column, Space, center, column, container, markdown, text};
use iced::{Element, Fill};
use iced_term::Terminal;

use crate::message::Message;
use crate::model::diff::DiffViewState;
use crate::model::{AgentStatus, ChatMessage, Repository, TerminalTab, Workspace};
use crate::ui::{chat_panel, diff_viewer, style, terminal_panel};

#[allow(clippy::too_many_arguments)]
pub fn view_main_content<'a>(
    repositories: &'a [Repository],
    workspaces: &'a [Workspace],
    selected_workspace: Option<&str>,
    chat_messages: &'a [ChatMessage],
    chat_input: &str,
    streaming_text: &'a str,
    markdown_items: &'a [Vec<markdown::Item>],
    diff: &DiffViewState<'a>,
    terminals: &'a HashMap<u64, Terminal>,
    terminal_tabs: &[TerminalTab],
    active_terminal_tab: Option<u64>,
    terminal_panel_visible: bool,
) -> Element<'a, Message> {
    let content: Element<'_, Message> = if let Some(ws_id) = selected_workspace {
        if let Some(ws) = workspaces.iter().find(|w| w.id == ws_id) {
            if diff.visible {
                diff_viewer::view_diff_viewer(
                    diff.files,
                    diff.selected_file,
                    diff.content,
                    diff.view_mode,
                    diff.loading,
                    diff.error,
                )
            } else {
                let is_running = ws.agent_status == AgentStatus::Running;
                let chat = chat_panel::view_chat_panel(
                    ws,
                    repositories,
                    chat_messages,
                    chat_input,
                    streaming_text,
                    markdown_items,
                    is_running,
                );

                let terminal = terminal_panel::view_terminal_panel(
                    terminals,
                    terminal_tabs,
                    active_terminal_tab,
                    terminal_panel_visible,
                    ws_id,
                );

                Column::new()
                    .push(container(chat).width(Fill).height(Fill))
                    .push(terminal)
                    .width(Fill)
                    .height(Fill)
                    .into()
            }
        } else {
            center(text("Workspace not found").size(16).color(style::FAINT)).into()
        }
    } else {
        center(
            column![
                text("Claudette").size(28),
                Space::new().height(8),
                text("Select a workspace to get started")
                    .size(16)
                    .color(style::FAINT),
            ]
            .align_x(iced::Alignment::Center),
        )
        .into()
    };

    container(content).width(Fill).height(Fill).into()
}
