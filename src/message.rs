#[derive(Debug, Clone)]
pub enum Message {
    ToggleSidebar,
    SelectWorkspace(usize),
    ToggleRepoCollapsed(usize),
    ShowAddRepo,
    HideAddRepo,
    AddRepoPathChanged(String),
    ConfirmAddRepo,
}
