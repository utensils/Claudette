use std::path::{Path, PathBuf};

const MAX_FILE_SIZE: usize = 100 * 1024; // 100 KB

fn escape_xml_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Result of reading a file from a worktree with safety checks applied.
pub struct SafeFileRead {
    pub content: Option<String>,
    pub is_binary: bool,
    pub size_bytes: u64,
    pub truncated: bool,
}

/// Read a file from a worktree with path-traversal protection, binary
/// detection, and 100 KB truncation.
///
/// Returns `None` if the file is missing, the path escapes the worktree, or
/// the worktree path itself cannot be resolved.
pub async fn read_worktree_file(worktree_path: &Path, relative_path: &str) -> Option<SafeFileRead> {
    let worktree_canonical = tokio::fs::canonicalize(worktree_path).await.ok()?;
    resolve_and_read(&worktree_canonical, worktree_path, relative_path).await
}

/// Inner helper: resolve a relative path against the worktree, validate
/// containment, read with binary/truncation checks.
async fn resolve_and_read(
    worktree_canonical: &Path,
    worktree_path: &Path,
    relative_path: &str,
) -> Option<SafeFileRead> {
    let joined = worktree_path.join(relative_path);
    let file_canonical = tokio::fs::canonicalize(&joined).await.ok()?;

    if !file_canonical.starts_with(worktree_canonical) {
        return None;
    }

    read_checked(&file_canonical).await
}

/// Read a canonical path with binary detection and size truncation.
async fn read_checked(path: &PathBuf) -> Option<SafeFileRead> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let size_bytes = metadata.len();

    // Read at most MAX_FILE_SIZE + 1 bytes to detect truncation without
    // buffering the entire file for large inputs.
    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(path).await.ok()?;
    let read_limit = (MAX_FILE_SIZE + 1) as u64;
    let mut raw = Vec::with_capacity(read_limit.min(size_bytes + 1) as usize);
    file.take(read_limit).read_to_end(&mut raw).await.ok()?;

    // Binary detection: check first 8 KB for null bytes.
    let check_len = raw.len().min(8192);
    if raw[..check_len].contains(&0) {
        return Some(SafeFileRead {
            content: None,
            is_binary: true,
            size_bytes,
            truncated: false,
        });
    }

    let truncated = raw.len() > MAX_FILE_SIZE;
    let usable = if truncated {
        &raw[..MAX_FILE_SIZE]
    } else {
        &raw[..]
    };
    let text = String::from_utf8_lossy(usable).into_owned();

    Some(SafeFileRead {
        content: Some(text),
        is_binary: false,
        size_bytes,
        truncated,
    })
}

/// Expand @-file mentions into `<referenced-file>` XML blocks prepended to the
/// prompt.
///
/// For each relative path in `mentioned_files`, reads the file from
/// `worktree_path` with path-traversal protection, binary detection, and 100 KB
/// truncation. Unreadable, binary, or missing files are silently skipped.
pub async fn expand_file_mentions(
    worktree_path: &Path,
    content: &str,
    mentioned_files: &[String],
) -> String {
    if mentioned_files.is_empty() {
        return content.to_string();
    }

    let worktree_canonical = match tokio::fs::canonicalize(worktree_path).await {
        Ok(p) => p,
        Err(_) => return content.to_string(),
    };

    let mut blocks = Vec::new();

    for relative_path in mentioned_files {
        let read = match resolve_and_read(&worktree_canonical, worktree_path, relative_path).await {
            Some(r) => r,
            None => continue,
        };

        let text = match read.content {
            Some(t) => t,
            None => continue, // binary
        };

        let escaped_path = escape_xml_attr(relative_path);
        let mut block =
            format!("<referenced-file path=\"{escaped_path}\">\n{text}\n</referenced-file>");
        if read.truncated {
            block.push_str(&format!(
                "\n(Note: file truncated at 100KB, total size {} bytes)",
                read.size_bytes
            ));
        }
        blocks.push(block);
    }

    if blocks.is_empty() {
        return content.to_string();
    }

    format!("{}\n\n{content}", blocks.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_read_worktree_file_success() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.txt"), "world").unwrap();

        let result = read_worktree_file(dir.path(), "hello.txt").await.unwrap();
        assert_eq!(result.content.unwrap(), "world");
        assert!(!result.is_binary);
        assert!(!result.truncated);
    }

    #[tokio::test]
    async fn test_read_worktree_file_missing() {
        let dir = TempDir::new().unwrap();
        assert!(read_worktree_file(dir.path(), "nope.txt").await.is_none());
    }

    #[tokio::test]
    async fn test_read_worktree_file_traversal() {
        let dir = TempDir::new().unwrap();
        assert!(
            read_worktree_file(dir.path(), "../../etc/passwd")
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn test_read_worktree_file_binary() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bin"), b"\x00\x01\x02").unwrap();

        let result = read_worktree_file(dir.path(), "bin").await.unwrap();
        assert!(result.is_binary);
        assert!(result.content.is_none());
    }

    #[tokio::test]
    async fn test_expand_empty_mentions() {
        let dir = TempDir::new().unwrap();
        let result = expand_file_mentions(dir.path(), "hello", &[]).await;
        assert_eq!(result, "hello");
    }

    #[tokio::test]
    async fn test_expand_single_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("foo.txt"), "file content").unwrap();

        let result = expand_file_mentions(dir.path(), "fix this", &["foo.txt".to_string()]).await;

        assert!(result.contains("<referenced-file path=\"foo.txt\">"));
        assert!(result.contains("file content"));
        assert!(result.ends_with("fix this"));
    }

    #[tokio::test]
    async fn test_expand_missing_file_skipped() {
        let dir = TempDir::new().unwrap();

        let result =
            expand_file_mentions(dir.path(), "hello", &["nonexistent.txt".to_string()]).await;

        assert_eq!(result, "hello");
    }

    #[tokio::test]
    async fn test_expand_path_traversal_blocked() {
        let dir = TempDir::new().unwrap();

        let result =
            expand_file_mentions(dir.path(), "hello", &["../../etc/passwd".to_string()]).await;

        assert_eq!(result, "hello");
    }

    #[tokio::test]
    async fn test_expand_binary_file_skipped() {
        let dir = TempDir::new().unwrap();
        let mut data = vec![0u8; 100];
        data[50] = 0; // null byte
        fs::write(dir.path().join("binary.bin"), &data).unwrap();

        let result = expand_file_mentions(dir.path(), "hello", &["binary.bin".to_string()]).await;

        assert_eq!(result, "hello");
    }

    #[tokio::test]
    async fn test_expand_multiple_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.txt"), "aaa").unwrap();
        fs::write(dir.path().join("b.txt"), "bbb").unwrap();

        let result = expand_file_mentions(
            dir.path(),
            "fix both",
            &["a.txt".to_string(), "b.txt".to_string()],
        )
        .await;

        assert!(result.contains("<referenced-file path=\"a.txt\">"));
        assert!(result.contains("<referenced-file path=\"b.txt\">"));
        assert!(result.ends_with("fix both"));
    }

    #[tokio::test]
    async fn test_expand_truncates_large_file() {
        let dir = TempDir::new().unwrap();
        let data = "x".repeat(200 * 1024); // 200KB
        fs::write(dir.path().join("big.txt"), &data).unwrap();

        let result = expand_file_mentions(dir.path(), "check", &["big.txt".to_string()]).await;

        assert!(result.contains("(Note: file truncated at 100KB"));
        assert!(result.contains("total size 204800 bytes"));
    }
}
