mod commands;
mod db;
mod error;
mod git;
mod model;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::repository::add_repository,
            commands::repository::list_repositories,
            commands::repository::get_repository,
            commands::repository::remove_repository,
            commands::workspace::create_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::list_all_workspaces,
            commands::workspace::get_workspace,
            commands::workspace::archive_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
