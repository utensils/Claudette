use iced::widget::{Column, Space, button, column, container, row, scrollable, text};
use iced::{Background, Border, Element, Fill, Padding, Theme};

use crate::message::Message;
use crate::model::{Repository, Workspace};
use crate::ui::style;

pub fn view_sidebar<'a>(
    repositories: &'a [Repository],
    workspaces: &'a [Workspace],
    selected_workspace: Option<usize>,
) -> Element<'a, Message> {
    let mut content = Column::new().spacing(4).padding([12, 0]);

    // Header
    content = content.push(
        container(text("Workspaces").size(12).color(style::MUTED)).padding(Padding {
            top: 0.0,
            right: 16.0,
            bottom: 8.0,
            left: 16.0,
        }),
    );

    // Repo groups
    for repo in repositories {
        content = content.push(view_repo_group(repo, workspaces, selected_workspace));
    }

    // Spacer to push "Add Repo" to bottom
    content = content.push(Space::new().height(Fill));

    // Divider
    content = content.push(
        container(column![])
            .width(Fill)
            .height(1)
            .style(|_theme: &Theme| container::Style {
                background: Some(Background::Color(style::DIVIDER)),
                ..Default::default()
            }),
    );

    // Add repo button
    content = content.push(
        button(
            row![
                text("+").size(16),
                Space::new().width(6),
                text("Add repository").size(14),
            ]
            .align_y(iced::Alignment::Center),
        )
        .on_press(Message::ShowAddRepo)
        .style(|theme: &Theme, status| {
            let mut style = button::text(theme, status);
            style.text_color = style::MUTED;
            style
        })
        .padding([10, 16])
        .width(Fill),
    );

    container(scrollable(content).height(Fill))
        .width(style::SIDEBAR_WIDTH)
        .height(Fill)
        .style(|_theme: &Theme| container::Style {
            background: Some(Background::Color(style::SIDEBAR_BG)),
            border: Border {
                width: 1.0,
                color: style::SIDEBAR_BORDER,
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

fn view_repo_group<'a>(
    repo: &'a Repository,
    workspaces: &'a [Workspace],
    selected_workspace: Option<usize>,
) -> Element<'a, Message> {
    let chevron = if repo.collapsed {
        "\u{25B6}" // right-pointing triangle
    } else {
        "\u{25BC}" // down-pointing triangle
    };

    let header = button(
        row![
            text(chevron).size(10).color(style::MUTED),
            Space::new().width(6),
            text(&repo.name).size(14),
        ]
        .align_y(iced::Alignment::Center),
    )
    .on_press(Message::ToggleRepoCollapsed(repo.id))
    .style(|theme: &Theme, status| {
        let mut s = button::text(theme, status);
        if matches!(status, button::Status::Hovered) {
            s.background = Some(Background::Color(style::HOVER_BG));
        }
        s
    })
    .padding([6, 16])
    .width(Fill);

    let mut group = Column::new().push(header);

    if !repo.collapsed {
        for ws in workspaces.iter().filter(|w| w.repository_id == repo.id) {
            group = group.push(view_workspace_entry(ws, selected_workspace));
        }
    }

    group.into()
}

fn view_workspace_entry<'a>(
    ws: &'a Workspace,
    selected_workspace: Option<usize>,
) -> Element<'a, Message> {
    let is_selected = selected_workspace == Some(ws.id);

    let status_dot = text("\u{25CF}")
        .size(10)
        .color(style::agent_status_color(&ws.agent_status));

    let entry_content = row![
        container(status_dot).padding(Padding {
            top: 2.0,
            right: 0.0,
            bottom: 0.0,
            left: 0.0,
        }),
        Space::new().width(8),
        column![
            text(&ws.name).size(13),
            text(&ws.branch_name).size(11).color(style::DIM),
            row![
                text(ws.agent_status.label())
                    .size(11)
                    .color(style::agent_status_color(&ws.agent_status)),
                text(" \u{2022} ").size(11).color(style::SEPARATOR),
                text(&ws.status_line).size(11).color(style::FAINT),
            ],
        ]
        .spacing(2),
    ]
    .align_y(iced::Alignment::Start);

    let bg = if is_selected {
        Some(Background::Color(style::SELECTED_BG))
    } else {
        None
    };

    let ws_id = ws.id;
    button(entry_content)
        .on_press(Message::SelectWorkspace(ws_id))
        .style(move |theme: &Theme, status| {
            let mut s = button::text(theme, status);
            if matches!(status, button::Status::Hovered) && !is_selected {
                s.background = Some(Background::Color(style::HOVER_BG_SUBTLE));
            } else {
                s.background = bg;
            }
            s
        })
        .padding(Padding {
            top: 8.0,
            right: 16.0,
            bottom: 8.0,
            left: 28.0,
        })
        .width(Fill)
        .into()
}
