//! `claudette__send_to_user` — agent-callable MCP tool that delivers an image,
//! PDF, or small text/data file to the user inline in chat.
//!
//! This module owns only the *policy* layer (validation) and metadata. The
//! IPC plumbing that actually persists the file into `attachments` and emits
//! the Tauri event lives in `agent_mcp::bridge` (slice 5).

/// Hard upper bound a tool argument's `media_type` string is allowed to take
/// before validation rejects it as malformed input. Mirrors a defensive check
/// against unbounded strings reaching `policy()`.
pub const MAX_MEDIA_TYPE_LEN: usize = 128;

/// Hard upper bound on filename length to keep DB rows and UI labels sane.
pub const MAX_FILENAME_LEN: usize = 255;

/// Allowed image MIME types. Mirrors `SUPPORTED_IMAGE_TYPES` in
/// `src/ui/src/utils/attachmentValidation.ts` plus `image/svg+xml` — SVG is
/// rendered via `<img src="data:image/svg+xml;base64,…">` in
/// `AttachmentLightbox.tsx`, which the browser sandboxes (no script execution,
/// no external loads) so it's safe to accept from the agent.
pub const ALLOWED_IMAGE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
];

/// Allowed document types — currently PDF only, matches inbound rules.
pub const ALLOWED_DOCUMENT_TYPES: &[&str] = &["application/pdf"];

/// Allowed text/data MIME types. Each renders with a type-specific preview
/// card on the frontend (see `src/ui/src/components/chat/MessageAttachment.tsx`).
/// Adding a type here without a matching preview falls back to the plain-text
/// card.
pub const ALLOWED_TEXT_TYPES: &[&str] = &[
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
];

/// Per-type size caps (raw bytes, pre-base64). Mirrors the constants in
/// `src/ui/src/utils/attachmentValidation.ts`.
pub const MAX_IMAGE_BYTES: u64 = 3_932_160; // 3.75 MiB
pub const MAX_PDF_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_TEXT_BYTES: u64 = 1024 * 1024;
pub const MAX_CSV_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_MARKDOWN_BYTES: u64 = 1024 * 1024;
pub const MAX_JSON_BYTES: u64 = 1024 * 1024;

/// Decide whether the agent is allowed to send this file to the user.
/// Returns `Ok(())` to accept; `Err(reason)` to reject. The `reason` string
/// is surfaced back to the agent in the MCP tool result so the model can
/// adjust and retry.
///
/// Inputs:
/// - `media_type` — MIME type the agent declared (e.g. `"image/png"`).
/// - `size_bytes` — raw file size on disk before base64.
/// - `filename` — basename of the file (no directory components — the bridge
///   strips path before calling this).
///
/// Symmetry with the inbound user-side rules in
/// `src/ui/src/utils/attachmentValidation.ts` is the default. Loosening this
/// would let the agent deliver content the user can't compose; tightening it
/// would limit the feature.
///
pub fn policy(media_type: &str, size_bytes: u64, filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("filename is required".into());
    }
    if filename.len() > MAX_FILENAME_LEN {
        return Err(format!(
            "filename too long ({} > {MAX_FILENAME_LEN})",
            filename.len()
        ));
    }
    if media_type.len() > MAX_MEDIA_TYPE_LEN {
        return Err(format!(
            "media_type too long ({} > {MAX_MEDIA_TYPE_LEN})",
            media_type.len()
        ));
    }

    let max = if ALLOWED_IMAGE_TYPES.contains(&media_type) {
        MAX_IMAGE_BYTES
    } else if ALLOWED_DOCUMENT_TYPES.contains(&media_type) {
        MAX_PDF_BYTES
    } else {
        match max_text_bytes_for(media_type) {
            Some(m) => m,
            None => {
                return Err(format!(
                    "media type {media_type:?} is not supported inline. Supported: \
                     images (png/jpeg/gif/webp/svg), application/pdf, text/plain, \
                     text/csv, text/markdown, application/json. The file at \
                     {filename:?} is on disk — for unsupported types, just tell \
                     the user that path so they can retrieve it manually instead \
                     of calling this tool."
                ));
            }
        }
    };

    if size_bytes > max {
        return Err(format!(
            "file too large for {media_type}: {size_bytes} bytes (max {max}). \
             The file at {filename:?} is on disk — tell the user that path so \
             they can open it directly instead of retrying this tool."
        ));
    }
    Ok(())
}

/// Per-text-type cap, or `None` if the type isn't a recognized text/data type.
fn max_text_bytes_for(media_type: &str) -> Option<u64> {
    match media_type {
        "text/plain" => Some(MAX_TEXT_BYTES),
        "text/csv" => Some(MAX_CSV_BYTES),
        "text/markdown" => Some(MAX_MARKDOWN_BYTES),
        "application/json" => Some(MAX_JSON_BYTES),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each row: (media_type, size_bytes, filename, expected).
    /// `expected = Ok(())` means accept; `Err(_)` means the policy must
    /// reject (the exact error string is up to the implementer).
    #[allow(clippy::type_complexity)]
    fn cases() -> Vec<(&'static str, u64, &'static str, Result<(), ()>)> {
        vec![
            // --- accepted: typical happy paths ---
            ("image/png", 1024, "screenshot.png", Ok(())),
            ("image/jpeg", 500_000, "photo.jpg", Ok(())),
            ("image/gif", 100_000, "anim.gif", Ok(())),
            ("image/webp", 200_000, "pic.webp", Ok(())),
            ("image/svg+xml", 100, "vec.svg", Ok(())),
            ("application/pdf", 1_000_000, "report.pdf", Ok(())),
            ("text/plain", 1024, "notes.txt", Ok(())),
            ("text/csv", 50_000, "rows.csv", Ok(())),
            ("text/markdown", 5_000, "README.md", Ok(())),
            ("application/json", 100, "config.json", Ok(())),
            // --- rejected: disallowed types ---
            ("application/x-msdownload", 100, "evil.exe", Err(())),
            ("application/zip", 100, "bundle.zip", Err(())),
            ("text/html", 100, "page.html", Err(())),
            ("application/x-tar", 100, "bundle.tar", Err(())),
            ("text/yaml", 100, "config.yaml", Err(())),
            // --- rejected: oversize ---
            ("image/png", MAX_IMAGE_BYTES + 1, "huge.png", Err(())),
            ("application/pdf", MAX_PDF_BYTES + 1, "huge.pdf", Err(())),
            ("text/plain", MAX_TEXT_BYTES + 1, "huge.txt", Err(())),
            ("text/csv", MAX_CSV_BYTES + 1, "huge.csv", Err(())),
            ("text/markdown", MAX_MARKDOWN_BYTES + 1, "huge.md", Err(())),
            ("application/json", MAX_JSON_BYTES + 1, "huge.json", Err(())),
            // --- rejected: empty filename ---
            ("image/png", 100, "", Err(())),
            // --- rejected: malformed media_type ---
            (
                // 200-char garbage string — exceeds MAX_MEDIA_TYPE_LEN.
                "x".repeat(200).leak(),
                100,
                "x.png",
                Err(()),
            ),
        ]
    }

    #[test]
    fn policy_table() {
        for (mime, size, name, expected) in cases() {
            let got = super::policy(mime, size, name);
            match (expected, got) {
                (Ok(()), Ok(())) | (Err(()), Err(_)) => {}
                (Ok(()), Err(e)) => {
                    panic!("expected accept for ({mime:?}, {size}, {name:?}); got reject: {e}")
                }
                (Err(()), Ok(())) => panic!("expected reject for ({mime:?}, {size}, {name:?})"),
            }
        }
    }

    /// The model uses the rejection text to decide what to do next. Both
    /// reject paths must mention the filename so it can fall back to
    /// "tell the user the path on disk" instead of retrying blindly.
    #[test]
    fn rejection_text_is_actionable() {
        let unsupported = super::policy("application/x-tar", 100, "bundle.tar.gz")
            .expect_err("unsupported should reject");
        assert!(
            unsupported.contains("bundle.tar.gz"),
            "expected filename in rejection: {unsupported}"
        );
        assert!(
            unsupported.contains("on disk"),
            "expected fallback hint in rejection: {unsupported}"
        );

        let oversize = super::policy("text/csv", MAX_CSV_BYTES + 1, "huge.csv")
            .expect_err("oversize should reject");
        assert!(
            oversize.contains("huge.csv"),
            "expected filename in oversize rejection: {oversize}"
        );
        assert!(
            oversize.contains("on disk"),
            "expected fallback hint in oversize rejection: {oversize}"
        );
    }
}
