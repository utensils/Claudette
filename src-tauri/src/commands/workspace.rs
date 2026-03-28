use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::db;
use crate::error::AppError;
use crate::git;
use crate::model::workspace::{CreateWorkspaceRequest, Workspace};

fn worktree_base(repo_path: &Path) -> PathBuf {
    repo_path
        .parent()
        .unwrap_or(repo_path)
        .join(".claudette-worktrees")
}

fn sanitize_branch(name: &str) -> String {
    name.strip_prefix("claudette/").unwrap_or(name).to_string()
}

#[tauri::command]
pub fn create_workspace(
    app: AppHandle,
    request: CreateWorkspaceRequest,
) -> Result<Workspace, AppError> {
    let conn = db::open_db(&app)?;

    // Look up the repository
    let repo = conn
        .query_row(
            "SELECT id, name, path, default_branch, created_at, updated_at
             FROM repositories WHERE id = ?1",
            [&request.repository_id],
            |row| {
                Ok(crate::model::repository::Repository {
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
                AppError::NotFound(format!("Repository not found: {}", request.repository_id))
            }
            other => AppError::Database(other),
        })?;

    let repo_path = Path::new(&repo.path);
    let branch = format!("claudette/{}", request.branch);
    let dir_name = sanitize_branch(&request.branch);

    let wt_path = worktree_base(repo_path).join(&repo.name).join(&dir_name);

    // Create worktree (creates branch from HEAD by default, or from base_branch)
    if let Some(ref base) = request.base_branch {
        // Create worktree from specific base branch
        let output = std::process::Command::new("git")
            .args([
                "worktree",
                "add",
                &wt_path.to_string_lossy(),
                "-b",
                &branch,
                base,
            ])
            .current_dir(repo_path)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::Git(stderr));
        }
    } else {
        git::create_worktree(repo_path, &branch, &wt_path)?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();
    let wt_str = wt_path.to_string_lossy().to_string();

    conn.execute(
        "INSERT INTO workspaces (id, repository_id, name, branch, worktree_path, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)",
        (&id, &request.repository_id, &request.name, &branch, &wt_str, &now, &now),
    )?;

    Ok(Workspace {
        id,
        repository_id: request.repository_id,
        name: request.name,
        branch,
        worktree_path: Some(wt_str),
        status: "active".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_workspaces(app: AppHandle, repository_id: String) -> Result<Vec<Workspace>, AppError> {
    let conn = db::open_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, repository_id, name, branch, worktree_path, status, created_at, updated_at
         FROM workspaces WHERE repository_id = ?1 AND status = 'active'
         ORDER BY updated_at DESC",
    )?;

    let workspaces = stmt
        .query_map([&repository_id], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                repository_id: row.get(1)?,
                name: row.get(2)?,
                branch: row.get(3)?,
                worktree_path: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(workspaces)
}

#[tauri::command]
pub fn list_all_workspaces(app: AppHandle) -> Result<Vec<Workspace>, AppError> {
    let conn = db::open_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, repository_id, name, branch, worktree_path, status, created_at, updated_at
         FROM workspaces WHERE status = 'active'
         ORDER BY updated_at DESC",
    )?;

    let workspaces = stmt
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                repository_id: row.get(1)?,
                name: row.get(2)?,
                branch: row.get(3)?,
                worktree_path: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(workspaces)
}

#[tauri::command]
pub fn get_workspace(app: AppHandle, id: String) -> Result<Workspace, AppError> {
    let conn = db::open_db(&app)?;
    let workspace = conn
        .query_row(
            "SELECT id, repository_id, name, branch, worktree_path, status, created_at, updated_at
             FROM workspaces WHERE id = ?1",
            [&id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    repository_id: row.get(1)?,
                    name: row.get(2)?,
                    branch: row.get(3)?,
                    worktree_path: row.get(4)?,
                    status: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Workspace not found: {id}"))
            }
            other => AppError::Database(other),
        })?;

    Ok(workspace)
}

#[tauri::command]
pub fn archive_workspace(app: AppHandle, id: String) -> Result<(), AppError> {
    let conn = db::open_db(&app)?;

    let workspace = conn
        .query_row(
            "SELECT id, repository_id, name, branch, worktree_path, status, created_at, updated_at
             FROM workspaces WHERE id = ?1",
            [&id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    repository_id: row.get(1)?,
                    name: row.get(2)?,
                    branch: row.get(3)?,
                    worktree_path: row.get(4)?,
                    status: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Workspace not found: {id}"))
            }
            other => AppError::Database(other),
        })?;

    // Remove worktree if it exists
    if let Some(ref wt_path) = workspace.worktree_path {
        let repo = conn
            .query_row(
                "SELECT path FROM repositories WHERE id = ?1",
                [&workspace.repository_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(AppError::Database)?;

        let _ = git::remove_worktree(Path::new(&repo), Path::new(wt_path));
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET status = 'archived', worktree_path = NULL, updated_at = ?1 WHERE id = ?2",
        (&now, &id),
    )?;

    Ok(())
}
