use std::path::PathBuf;

use rusqlite::Connection;
use tauri::Manager;

use crate::error::AppError;

pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e)))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("claudette.db"))
}

pub fn open_db(app: &tauri::AppHandle) -> Result<Connection, AppError> {
    let path = db_path(app)?;
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS repositories (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                path            TEXT NOT NULL UNIQUE,
                default_branch  TEXT NOT NULL DEFAULT 'main',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id              TEXT PRIMARY KEY,
                repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                name            TEXT NOT NULL,
                branch          TEXT NOT NULL,
                worktree_path   TEXT,
                status          TEXT NOT NULL DEFAULT 'active',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                UNIQUE(repository_id, branch)
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id              TEXT PRIMARY KEY,
                workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_workspaces_repo ON workspaces(repository_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_ws ON chat_messages(workspace_id);

            PRAGMA user_version = 1;
            ",
        )?;
    }

    Ok(())
}
