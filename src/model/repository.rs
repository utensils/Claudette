#[derive(Debug, Clone)]
pub struct Repository {
    pub id: usize,
    pub path: String,
    pub name: String,
    pub collapsed: bool,
}
