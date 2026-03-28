use std::path::Path;

use tauri::AppHandle;

use crate::db;
use crate::error::AppError;
use crate::git;
use crate::model::repository::Repository;

#[tauri::command]
pub fn add_repository(app: AppHandle, path: String) -> Result<Repository, AppError> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(AppError::Validation(format!("Path does not exist: {path}")));
    }

    if !git::is_git_repo(repo_path) {
        return Err(AppError::Validation(format!(
            "Not a git repository: {path}"
        )));
    }

    let name = git::repo_name(repo_path);
    let default_branch = git::default_branch(repo_path).unwrap_or_else(|_| "main".to_string());
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let conn = db::open_db(&app)?;
    conn.execute(
        "INSERT INTO repositories (id, name, path, default_branch, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &name, &path, &default_branch, &now, &now),
    )?;

    Ok(Repository {
        id,
        name,
        path,
        default_branch,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_repositories(app: AppHandle) -> Result<Vec<Repository>, AppError> {
    let conn = db::open_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, path, default_branch, created_at, updated_at
         FROM repositories ORDER BY updated_at DESC",
    )?;

    let repos = stmt
        .query_map([], |row| {
            Ok(Repository {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                default_branch: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(repos)
}

#[tauri::command]
pub fn get_repository(app: AppHandle, id: String) -> Result<Repository, AppError> {
    let conn = db::open_db(&app)?;
    let repo = conn
        .query_row(
            "SELECT id, name, path, default_branch, created_at, updated_at
             FROM repositories WHERE id = ?1",
            [&id],
            |row| {
                Ok(Repository {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    default_branch: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Repository not found: {id}"))
            }
            other => AppError::Database(other),
        })?;

    Ok(repo)
}

#[tauri::command]
pub fn remove_repository(app: AppHandle, id: String) -> Result<(), AppError> {
    let conn = db::open_db(&app)?;

    // Clean up worktrees for active workspaces before deleting
    let mut stmt = conn.prepare(
        "SELECT worktree_path, repository_id FROM workspaces
         WHERE repository_id = ?1 AND status = 'active' AND worktree_path IS NOT NULL",
    )?;

    let worktrees: Vec<(String, String)> = stmt
        .query_map([&id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    // Get repo path for worktree removal
    if let Ok(repo) = get_repository_by_id(&conn, &id) {
        let repo_path = Path::new(&repo.path);
        for (wt_path, _) in &worktrees {
            let _ = git::remove_worktree(repo_path, Path::new(wt_path));
        }
    }

    let deleted = conn.execute("DELETE FROM repositories WHERE id = ?1", [&id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("Repository not found: {id}")));
    }

    Ok(())
}

fn get_repository_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Repository, rusqlite::Error> {
    conn.query_row(
        "SELECT id, name, path, default_branch, created_at, updated_at
         FROM repositories WHERE id = ?1",
        [id],
        |row| {
            Ok(Repository {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                default_branch: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}
