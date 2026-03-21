use iced::widget::{
    Space, button, center, column, container, mouse_area, opaque, row, text, text_input,
};
use iced::{Background, Border, Element, Fill, Theme};

use crate::message::Message;
use crate::ui::style;

pub fn view_add_repo_modal<'a>(
    base: Element<'a, Message>,
    path_input: &str,
    error: Option<&String>,
) -> Element<'a, Message> {
    let backdrop: Element<'_, Message> = mouse_area(
        container(column![])
            .width(Fill)
            .height(Fill)
            .style(|_theme: &Theme| container::Style {
                background: Some(Background::Color(style::BACKDROP)),
                ..Default::default()
            }),
    )
    .on_press(Message::HideAddRepo)
    .into();

    let mut modal_content = column![
        text("Add Repository").size(20),
        text_input(
            "Enter repository path (e.g., /home/user/projects/my-repo)",
            path_input
        )
        .on_input(Message::AddRepoPathChanged)
        .on_submit(Message::ConfirmAddRepo)
        .padding(10)
        .size(16),
    ]
    .spacing(12);

    if let Some(err) = error {
        modal_content = modal_content.push(text(err.clone()).size(14).color(style::ERROR));
    }

    modal_content = modal_content.push(
        row![
            button(text("Cancel").size(14))
                .on_press(Message::HideAddRepo)
                .style(|theme: &Theme, status| {
                    let mut s = button::secondary(theme, status);
                    s.border = Border {
                        radius: 4.0.into(),
                        ..s.border
                    };
                    s
                })
                .padding([8, 16]),
            Space::new().width(8),
            button(text("Add").size(14))
                .on_press(Message::ConfirmAddRepo)
                .style(|theme: &Theme, status| {
                    let mut s = button::primary(theme, status);
                    s.border = Border {
                        radius: 4.0.into(),
                        ..s.border
                    };
                    s
                })
                .padding([8, 16]),
        ]
        .align_y(iced::Alignment::Center),
    );

    let modal_card = container(modal_content)
        .width(460)
        .padding(24)
        .style(|_theme: &Theme| container::Style {
            background: Some(Background::Color(style::MODAL_BG)),
            border: Border {
                radius: 8.0.into(),
                width: 1.0,
                color: style::MODAL_BORDER,
            },
            ..Default::default()
        });

    let overlay = center(opaque(modal_card)).width(Fill).height(Fill);

    iced::widget::stack![base, backdrop, overlay].into()
}
