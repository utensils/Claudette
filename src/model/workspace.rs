#[derive(Debug, Clone, PartialEq)]
pub enum AgentStatus {
    Running,
    Idle,
    Stopped,
}

impl AgentStatus {
    pub fn label(&self) -> &str {
        match self {
            Self::Running => "Running",
            Self::Idle => "Idle",
            Self::Stopped => "Stopped",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Workspace {
    pub id: usize,
    pub repository_id: usize,
    pub name: String,
    pub branch_name: String,
    pub agent_status: AgentStatus,
    pub status_line: String,
}
