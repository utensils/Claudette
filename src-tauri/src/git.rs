use std::path::Path;
use std::process::Command;

use crate::error::AppError;

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::Git(stderr))
    }
}

pub fn is_git_repo(path: &Path) -> bool {
    run_git(path, &["rev-parse", "--git-dir"]).is_ok()
}

pub fn default_branch(repo_path: &Path) -> Result<String, AppError> {
    // Try origin HEAD first
    if let Ok(refname) = run_git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        if let Some(branch) = refname.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    }

    // Check if 'main' exists
    if run_git(repo_path, &["show-ref", "--verify", "refs/heads/main"]).is_ok() {
        return Ok("main".to_string());
    }

    // Check if 'master' exists
    if run_git(repo_path, &["show-ref", "--verify", "refs/heads/master"]).is_ok() {
        return Ok("master".to_string());
    }

    // Fall back to current branch
    current_branch(repo_path)
}

pub fn current_branch(path: &Path) -> Result<String, AppError> {
    run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
}

pub fn create_worktree(
    repo_path: &Path,
    branch: &str,
    worktree_path: &Path,
) -> Result<(), AppError> {
    run_git(
        repo_path,
        &[
            "worktree",
            "add",
            &worktree_path.to_string_lossy(),
            "-b",
            branch,
        ],
    )?;
    Ok(())
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<(), AppError> {
    run_git(
        repo_path,
        &[
            "worktree",
            "remove",
            &worktree_path.to_string_lossy(),
            "--force",
        ],
    )?;
    Ok(())
}

pub fn repo_name(repo_path: &Path) -> String {
    repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}
