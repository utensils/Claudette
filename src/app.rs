use std::path::Path;

use iced::event;
use iced::keyboard::{self, Key};
use iced::widget::Row;
use iced::{Element, Subscription, Task, Theme};

use crate::message::Message;
use crate::model::{AgentStatus, Repository, Workspace};
use crate::ui;

pub struct App {
    repositories: Vec<Repository>,
    workspaces: Vec<Workspace>,
    selected_workspace: Option<usize>,
    sidebar_visible: bool,
    next_id: usize,

    // Add-repo modal
    show_add_repo: bool,
    add_repo_path_input: String,
    add_repo_error: Option<String>,
}

impl App {
    pub fn new() -> (Self, Task<Message>) {
        let mut app = Self {
            repositories: Vec::new(),
            workspaces: Vec::new(),
            selected_workspace: None,
            sidebar_visible: true,
            next_id: 1,
            show_add_repo: false,
            add_repo_path_input: String::new(),
            add_repo_error: None,
        };

        #[cfg(debug_assertions)]
        app.seed_demo_data();

        (app, Task::none())
    }

    #[cfg(debug_assertions)]
    fn seed_demo_data(&mut self) {
        let repo1_id = self.next_id();
        self.repositories.push(Repository {
            id: repo1_id,
            path: "/home/user/projects/acme-api".into(),
            name: "acme-api".into(),
            collapsed: false,
        });

        let repo2_id = self.next_id();
        self.repositories.push(Repository {
            id: repo2_id,
            path: "/home/user/projects/blog-frontend".into(),
            name: "blog-frontend".into(),
            collapsed: false,
        });

        let ws1_id = self.next_id();
        self.workspaces.push(Workspace {
            id: ws1_id,
            repository_id: repo1_id,
            name: "fix-auth-bug".into(),
            branch_name: "claudette/fix-auth-bug".into(),
            agent_status: AgentStatus::Running,
            status_line: "Investigating JWT validation...".into(),
        });

        let ws2_id = self.next_id();
        self.workspaces.push(Workspace {
            id: ws2_id,
            repository_id: repo1_id,
            name: "add-rate-limiting".into(),
            branch_name: "claudette/add-rate-limiting".into(),
            agent_status: AgentStatus::Idle,
            status_line: "Waiting for input".into(),
        });

        let ws3_id = self.next_id();
        self.workspaces.push(Workspace {
            id: ws3_id,
            repository_id: repo2_id,
            name: "dark-mode".into(),
            branch_name: "claudette/dark-mode".into(),
            agent_status: AgentStatus::Stopped,
            status_line: "Completed".into(),
        });
    }

    fn next_id(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::ToggleSidebar => {
                self.sidebar_visible = !self.sidebar_visible;
            }
            Message::SelectWorkspace(id) => {
                self.selected_workspace = Some(id);
            }
            Message::ToggleRepoCollapsed(id) => {
                if let Some(repo) = self.repositories.iter_mut().find(|r| r.id == id) {
                    repo.collapsed = !repo.collapsed;
                }
            }
            Message::ShowAddRepo => {
                self.show_add_repo = true;
                self.add_repo_path_input.clear();
                self.add_repo_error = None;
            }
            Message::HideAddRepo => {
                self.show_add_repo = false;
            }
            Message::AddRepoPathChanged(value) => {
                self.add_repo_path_input = value;
                self.add_repo_error = None;
            }
            Message::ConfirmAddRepo => {
                let path = self.add_repo_path_input.trim().to_string();
                let dir = Path::new(&path);

                if !dir.is_dir() {
                    self.add_repo_error = Some("Directory does not exist".into());
                } else if !dir.join(".git").exists() {
                    self.add_repo_error = Some("Not a git repository".into());
                } else if self.repositories.iter().any(|r| r.path == path) {
                    self.add_repo_error = Some("Repository already added".into());
                } else {
                    let name = dir
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.clone());
                    let id = self.next_id();
                    self.repositories.push(Repository {
                        id,
                        path,
                        name,
                        collapsed: false,
                    });
                    self.show_add_repo = false;
                }
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let mut layout = Row::new();

        if self.sidebar_visible {
            layout = layout.push(ui::view_sidebar(
                &self.repositories,
                &self.workspaces,
                self.selected_workspace,
            ));
        }

        layout = layout.push(ui::view_main_content(
            &self.repositories,
            &self.workspaces,
            self.selected_workspace,
        ));

        let base: Element<'_, Message> = layout.into();

        if self.show_add_repo {
            ui::view_add_repo_modal(
                base,
                &self.add_repo_path_input,
                self.add_repo_error.as_ref(),
            )
        } else {
            base
        }
    }

    pub fn subscription(&self) -> Subscription<Message> {
        event::listen_with(|event, _status, _id| {
            if let iced::Event::Keyboard(keyboard::Event::KeyPressed {
                key: Key::Character(c),
                modifiers,
                ..
            }) = &event
                && c.as_ref() == "b"
                && modifiers.command()
            {
                return Some(Message::ToggleSidebar);
            }
            None
        })
    }

    pub fn theme(&self) -> Theme {
        Theme::Dark
    }
}
