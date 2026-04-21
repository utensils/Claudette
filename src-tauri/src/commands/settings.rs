use std::collections::HashMap;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use claudette::db::Database;
use claudette::model::SoundPackManifest;

use crate::state::AppState;

/// Spawn a short-lived process and reap it in a background thread to prevent zombies.
pub(crate) fn spawn_and_reap(mut child: std::process::Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[derive(Serialize, Deserialize)]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub colors: HashMap<String, String>,
}

#[tauri::command]
pub async fn get_app_setting(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    db.get_app_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_app_setting(
    key: String,
    value: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    db.set_app_setting(&key, &value)
        .map_err(|e| e.to_string())?;

    // If updating worktree base dir, also update in-memory state.
    if key == "worktree_base_dir" {
        let mut dir = state.worktree_base_dir.write().await;
        *dir = std::path::PathBuf::from(&value);
    }

    // Toggle system tray on/off.
    if key == "tray_enabled" {
        if value == "true" {
            if let Err(e) = crate::tray::setup_tray(&app) {
                let _ = db.set_app_setting("tray_enabled", "false");
                return Err(format!("Failed to enable tray: {e}"));
            }
            // Immediately sync icon/tooltip to current agent state.
            crate::tray::rebuild_tray(&app);
        } else {
            crate::tray::destroy_tray(&app);
        }
    }

    // Live-apply tray icon style changes. `rebuild_tray` re-reads the
    // setting from the DB, so the value we just wrote takes effect on
    // the next call — no restart required. No-op if the tray isn't
    // currently active (destroy_tray clears the handle).
    if key == "tray_icon_style" {
        crate::tray::rebuild_tray(&app);
    }

    Ok(())
}

/// Read the global `git config user.name` and return it as a branch-safe slug.
#[tauri::command]
pub async fn get_git_username() -> Result<Option<String>, String> {
    let name = claudette::git::get_git_username()
        .await
        .map_err(|e| e.to_string())?;
    Ok(name.map(|n| claudette::agent::sanitize_branch_name(&n, 30)))
}

/// Return available notification sound names for the current platform.
#[tauri::command]
pub fn list_notification_sounds() -> Vec<String> {
    #[allow(unused_mut)]
    let mut sounds = vec!["Default".to_string(), "None".to_string()];
    #[cfg(target_os = "macos")]
    if let Ok(entries) = std::fs::read_dir("/System/Library/Sounds") {
        let mut system: Vec<String> = entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if path.extension().is_some_and(|ext| ext == "aiff") {
                    path.file_stem().map(|n| n.to_string_lossy().to_string())
                } else {
                    None
                }
            })
            .collect();
        system.sort();
        sounds.extend(system);
    }
    sounds
}

/// Cached system font list — populated on first call, reused thereafter.
static SYSTEM_FONTS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// Return available system font family names for the current platform.
///
/// - macOS: queries Core Text via a small Swift script (always available).
/// - Linux: queries fontconfig via `fc-list`.
///
/// Result is cached after the first call.
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    if let Some(cached) = SYSTEM_FONTS.get() {
        return cached.clone();
    }
    let mut families = std::collections::BTreeSet::<String>::new();

    #[cfg(target_os = "macos")]
    {
        // Swift is always available on macOS; NSFontManager is the canonical API.
        let script = r#"import AppKit; NSFontManager.shared.availableFontFamilies.sorted().forEach { print($0) }"#;
        if let Ok(output) = tokio::process::Command::new("/usr/bin/swift")
            .arg("-e")
            .arg(script)
            .output()
            .await
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim();
                if !name.is_empty() && !name.starts_with('.') {
                    families.insert(name.to_string());
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // fontconfig is standard on all Linux desktops.
        if let Ok(output) = tokio::process::Command::new("fc-list")
            .args([":", "family"])
            .output()
            .await
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                // fc-list may return comma-separated aliases: "DejaVu Sans,DejaVu Sans Condensed"
                for name in line.split(',') {
                    let name = name.trim();
                    if !name.is_empty() {
                        families.insert(name.to_string());
                    }
                }
            }
        }
    }

    let result: Vec<String> = families.into_iter().collect();
    // Only cache if we got results — an empty list likely means the
    // subprocess failed, and we don't want to permanently cache that.
    if !result.is_empty() {
        let _ = SYSTEM_FONTS.set(result.clone());
    }
    result
}

/// Play a notification sound by name (for settings preview and agent-finished events).
#[tauri::command]
pub fn play_notification_sound(sound: String) {
    if sound == "None" {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let path = if sound == "Default" {
            "/System/Library/Sounds/Tink.aiff".to_string()
        } else {
            format!("/System/Library/Sounds/{sound}.aiff")
        };
        if let Ok(child) = std::process::Command::new("afplay").arg(&path).spawn() {
            spawn_and_reap(child);
        }
    }
    #[cfg(target_os = "linux")]
    {
        // On Linux, play the system "bell" or "message" sound via paplay/canberra.
        // "Default" maps to the desktop notification sound; named sounds are
        // looked up via the XDG sound theme.
        let sound_name = if sound == "Default" {
            "bell".to_string()
        } else {
            sound.to_lowercase()
        };
        if let Ok(child) = std::process::Command::new("canberra-gtk-play")
            .arg("-i")
            .arg(&sound_name)
            .spawn()
            .or_else(|_| {
                std::process::Command::new("paplay")
                    .arg(format!(
                        "/usr/share/sounds/freedesktop/stereo/{sound_name}.oga"
                    ))
                    .spawn()
            })
        {
            spawn_and_reap(child);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = sound;
    }
}

/// Build a Command for the notification shell command with workspace env vars.
/// Returns None if the command is empty.
pub(crate) fn build_notification_command(
    cmd: &str,
    ws_env: &claudette::env::WorkspaceEnv,
) -> Option<std::process::Command> {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return None;
    }
    // Reject bare shell reserved keywords that will always fail with `sh -c`.
    // Users sometimes enter "done" instead of `say "done"`.
    if is_bare_shell_keyword(cmd) {
        return None;
    }
    let mut command = std::process::Command::new("sh");
    command.arg("-c").arg(cmd);
    ws_env.apply_std(&mut command);
    Some(command)
}

/// Returns true if `cmd` is a single shell reserved keyword that cannot
/// be executed standalone (e.g. `done`, `then`, `fi`, `esac`).
fn is_bare_shell_keyword(cmd: &str) -> bool {
    matches!(
        cmd,
        "done" | "then" | "else" | "elif" | "fi" | "esac" | "do" | "in"
    )
}

/// Run the user-configured notification command (if set) with workspace env vars.
#[tauri::command]
pub fn run_notification_command(
    workspace_name: String,
    workspace_id: String,
    workspace_path: String,
    root_path: String,
    default_branch: String,
    branch_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ws_env = claudette::env::WorkspaceEnv {
        workspace_name,
        workspace_id,
        workspace_path,
        root_path,
        default_branch,
        branch_name,
    };
    let db = Database::open(&state.db_path).map_err(|e| e.to_string())?;
    if let Ok(Some(cmd)) = db.get_app_setting("notification_command")
        && let Some(mut command) = build_notification_command(&cmd, &ws_env)
        && let Ok(child) = command.spawn()
    {
        spawn_and_reap(child);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_user_themes() -> Result<Vec<ThemeDefinition>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let themes_dir = dirs::home_dir()
            .ok_or("Could not determine home directory")?
            .join(".claudette")
            .join("themes");

        if !themes_dir.exists() {
            return Ok(Vec::new());
        }

        let mut themes = Vec::new();
        let entries = std::fs::read_dir(&themes_dir).map_err(|e| e.to_string())?;
        const MAX_THEME_FILE_BYTES: u64 = 1024 * 1024;

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("[themes] Skipping unreadable directory entry: {e}");
                    continue;
                }
            };

            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }

            match std::fs::metadata(&path) {
                Ok(meta) if meta.len() > MAX_THEME_FILE_BYTES => {
                    eprintln!(
                        "[themes] Skipping {}: file too large ({} bytes)",
                        path.display(),
                        meta.len()
                    );
                    continue;
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[themes] Skipping {}: {e}", path.display());
                    continue;
                }
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[themes] Skipping {}: {e}", path.display());
                    continue;
                }
            };

            match serde_json::from_str::<ThemeDefinition>(&content) {
                Ok(theme) => themes.push(theme),
                Err(e) => eprintln!("[themes] Skipping {}: {e}", path.display()),
            }
        }

        Ok(themes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct SoundPackInfo {
    pub dir_name: String,
    pub name: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub event_counts: HashMap<String, usize>,
}

fn sound_packs_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".claudette").join("sound-packs"))
}

#[tauri::command]
pub async fn list_sound_packs() -> Result<Vec<SoundPackInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let packs_dir = sound_packs_dir().ok_or("Could not determine home directory")?;

        if !packs_dir.exists() {
            return Ok(Vec::new());
        }

        let mut packs = Vec::new();
        let entries = std::fs::read_dir(&packs_dir).map_err(|e| e.to_string())?;
        const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("pack.json");
            if !manifest_path.exists() {
                continue;
            }
            match std::fs::metadata(&manifest_path) {
                Ok(meta) if meta.len() > MAX_MANIFEST_BYTES => {
                    eprintln!(
                        "[sound-packs] Skipping {}: manifest too large ({} bytes)",
                        path.display(),
                        meta.len()
                    );
                    continue;
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[sound-packs] Skipping {}: {e}", path.display());
                    continue;
                }
            }
            let content = match std::fs::read_to_string(&manifest_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[sound-packs] Skipping {}: {e}", path.display());
                    continue;
                }
            };
            let manifest: SoundPackManifest = match serde_json::from_str(&content) {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[sound-packs] Skipping {}: {e}", path.display());
                    continue;
                }
            };
            let dir_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let event_counts = manifest
                .events
                .iter()
                .map(|(event, files)| {
                    let valid = files.iter().filter(|f| path.join(f).exists()).count();
                    (event.clone(), valid)
                })
                .filter(|(_, count)| *count > 0)
                .collect();
            packs.push(SoundPackInfo {
                dir_name,
                name: manifest.name,
                author: manifest.author,
                description: manifest.description,
                event_counts,
            });
        }
        Ok(packs)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Play an arbitrary audio file by absolute path.
pub(crate) fn play_sound_file(path: &str) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(child) = std::process::Command::new("afplay").arg(path).spawn() {
            spawn_and_reap(child);
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(child) = std::process::Command::new("paplay")
            .arg(path)
            .spawn()
            .or_else(|_| std::process::Command::new("aplay").arg(path).spawn())
        {
            spawn_and_reap(child);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
    }
}

/// Resolve a random audio file path from a sound pack for a given event.
pub(crate) fn resolve_random_pack_sound_path(dir_name: &str, event: &str) -> Option<String> {
    let pack_dir = sound_packs_dir()?.join(dir_name);
    let manifest_path = pack_dir.join("pack.json");
    let content = std::fs::read_to_string(&manifest_path).ok()?;
    let manifest: SoundPackManifest = serde_json::from_str(&content).ok()?;
    let files = manifest.events.get(event)?;
    let valid_files: Vec<_> = files
        .iter()
        .map(|f| pack_dir.join(f))
        .filter(|p| p.exists())
        .collect();
    if valid_files.is_empty() {
        return None;
    }
    let idx = rand::thread_rng().gen_range(0..valid_files.len());
    Some(valid_files[idx].to_string_lossy().to_string())
}

#[tauri::command]
pub fn preview_pack_sound(dir_name: String, event: String) -> Result<(), String> {
    let path = resolve_random_pack_sound_path(&dir_name, &event)
        .ok_or_else(|| format!("No sounds found for event '{event}' in pack '{dir_name}'"))?;
    play_sound_file(&path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_notification_sounds_always_has_default_and_none() {
        let sounds = list_notification_sounds();
        assert!(sounds.len() >= 2);
        assert_eq!(sounds[0], "Default");
        assert_eq!(sounds[1], "None");
    }

    #[test]
    fn test_list_notification_sounds_no_duplicates() {
        let sounds = list_notification_sounds();
        let mut seen = std::collections::HashSet::new();
        for s in &sounds {
            assert!(seen.insert(s), "Duplicate sound: {s}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_list_notification_sounds_includes_system_sounds() {
        let sounds = list_notification_sounds();
        // macOS always has at least a few sounds in /System/Library/Sounds
        assert!(sounds.len() > 2, "Expected system sounds on macOS");
    }

    #[test]
    fn test_play_notification_sound_none_is_noop() {
        // Should not panic or spawn any process.
        play_notification_sound("None".to_string());
    }

    // --- Notification command tests ---

    fn sample_ws_env() -> claudette::env::WorkspaceEnv {
        claudette::env::WorkspaceEnv {
            workspace_name: "my-workspace".into(),
            workspace_id: "ws-123".into(),
            workspace_path: "/tmp/worktrees/repo/my-workspace".into(),
            root_path: "/home/user/repo".into(),
            default_branch: "main".into(),
            branch_name: "claudette/my-workspace".into(),
        }
    }

    #[test]
    fn test_build_notification_command_empty_returns_none() {
        assert!(build_notification_command("", &sample_ws_env()).is_none());
    }

    #[test]
    fn test_build_notification_command_sets_shell_and_args() {
        let cmd = build_notification_command("echo hello", &sample_ws_env()).unwrap();
        let program = cmd.get_program().to_string_lossy().to_string();
        assert_eq!(program, "sh");
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["-c", "echo hello"]);
    }

    #[test]
    fn test_build_notification_command_sets_env_vars() {
        let cmd = build_notification_command("echo test", &sample_ws_env()).unwrap();
        let envs: std::collections::HashMap<String, String> = cmd
            .get_envs()
            .filter_map(|(k, v)| {
                Some((
                    k.to_string_lossy().to_string(),
                    v?.to_string_lossy().to_string(),
                ))
            })
            .collect();
        assert_eq!(
            envs.get("CLAUDETTE_WORKSPACE_NAME").unwrap(),
            "my-workspace"
        );
        assert_eq!(envs.get("CLAUDETTE_WORKSPACE_ID").unwrap(), "ws-123");
        assert_eq!(
            envs.get("CLAUDETTE_WORKSPACE_PATH").unwrap(),
            "/tmp/worktrees/repo/my-workspace"
        );
        assert_eq!(envs.get("CLAUDETTE_ROOT_PATH").unwrap(), "/home/user/repo");
        assert_eq!(envs.get("CLAUDETTE_DEFAULT_BRANCH").unwrap(), "main");
        assert_eq!(
            envs.get("CLAUDETTE_BRANCH_NAME").unwrap(),
            "claudette/my-workspace"
        );
    }

    #[test]
    fn test_notification_command_runs_and_receives_env() {
        // Actually spawn a process and verify env vars are passed through.
        let tmp = std::env::temp_dir().join("claudette-test-notify-cmd.txt");
        let cmd_str = format!(
            "echo $CLAUDETTE_WORKSPACE_NAME,$CLAUDETTE_ROOT_PATH > {}",
            tmp.display()
        );
        let mut command = build_notification_command(&cmd_str, &sample_ws_env()).unwrap();
        let mut child = command.spawn().expect("Failed to spawn test command");
        child.wait().expect("Failed to wait for test command");
        let output = std::fs::read_to_string(&tmp).expect("Failed to read output file");
        std::fs::remove_file(&tmp).ok();
        assert_eq!(output.trim(), "my-workspace,/home/user/repo");
    }

    // --- Sound pack tests ---

    fn create_test_pack(dir: &std::path::Path, name: &str, events: &[(&str, &[&str])]) {
        let pack_dir = dir.join(name);
        std::fs::create_dir_all(&pack_dir).unwrap();
        let mut events_map = HashMap::new();
        for (event, files) in events {
            let event_dir = pack_dir.join(event);
            std::fs::create_dir_all(&event_dir).unwrap();
            let mut paths = Vec::new();
            for file in *files {
                let rel = format!("{event}/{file}");
                std::fs::write(pack_dir.join(&rel), b"fake audio").unwrap();
                paths.push(rel);
            }
            events_map.insert(
                event.to_string(),
                paths
                    .iter()
                    .map(|p| serde_json::Value::String(p.clone()))
                    .collect::<Vec<_>>(),
            );
        }
        let manifest = serde_json::json!({
            "name": format!("Test Pack {name}"),
            "version": "1.0.0",
            "author": "tester",
            "description": "A test sound pack",
            "events": events_map,
        });
        std::fs::write(
            pack_dir.join("pack.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn test_resolve_random_pack_sound_nonexistent_dir() {
        assert!(resolve_random_pack_sound_path("nonexistent-pack-xyz", "ask").is_none());
    }

    #[test]
    fn test_resolve_random_pack_sound_missing_event() {
        let tmp = tempfile::tempdir().unwrap();
        // Temporarily override the packs dir by creating a pack in a known location.
        // Since resolve_random_pack_sound_path uses sound_packs_dir() which resolves
        // to ~/.claudette/sound-packs, we test the internal logic via a direct manifest
        // parse instead.
        let pack_dir = tmp.path().join("test-pack");
        std::fs::create_dir_all(&pack_dir).unwrap();
        let manifest = serde_json::json!({
            "name": "Test",
            "events": {
                "ask": ["ask/sound.wav"]
            }
        });
        std::fs::write(
            pack_dir.join("pack.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let content = std::fs::read_to_string(pack_dir.join("pack.json")).unwrap();
        let parsed: SoundPackManifest = serde_json::from_str(&content).unwrap();
        assert!(parsed.events.get("plan").is_none());
        assert!(parsed.events.get("ask").is_some());
    }

    #[test]
    fn test_sound_pack_manifest_deserializes() {
        let json = r#"{
            "name": "Fun Pack",
            "version": "1.0.0",
            "author": "someone",
            "description": "A playful set",
            "events": {
                "ask": ["ask/chirp.wav", "ask/ding.wav"],
                "plan": ["plan/tada.wav"],
                "finished": ["finished/fanfare.wav"]
            }
        }"#;
        let manifest: SoundPackManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.name, "Fun Pack");
        assert_eq!(manifest.author.as_deref(), Some("someone"));
        assert_eq!(manifest.events.len(), 3);
        assert_eq!(manifest.events["ask"].len(), 2);
    }

    #[test]
    fn test_sound_pack_manifest_optional_fields() {
        let json = r#"{"name": "Minimal", "events": {}}"#;
        let manifest: SoundPackManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.name, "Minimal");
        assert!(manifest.version.is_none());
        assert!(manifest.author.is_none());
        assert!(manifest.description.is_none());
        assert!(manifest.events.is_empty());
    }

    #[test]
    fn test_sound_pack_info_event_counts_only_valid_files() {
        let tmp = tempfile::tempdir().unwrap();
        create_test_pack(
            tmp.path(),
            "my-pack",
            &[("ask", &["sound1.wav", "sound2.wav"])],
        );

        let pack_dir = tmp.path().join("my-pack");
        let content = std::fs::read_to_string(pack_dir.join("pack.json")).unwrap();
        let manifest: SoundPackManifest = serde_json::from_str(&content).unwrap();

        let event_counts: HashMap<String, usize> = manifest
            .events
            .iter()
            .map(|(event, files)| {
                let valid = files.iter().filter(|f| pack_dir.join(f).exists()).count();
                (event.clone(), valid)
            })
            .filter(|(_, count)| *count > 0)
            .collect();

        assert_eq!(event_counts["ask"], 2);
        assert!(!event_counts.contains_key("plan"));
    }

    #[test]
    fn test_sound_pack_info_skips_missing_files() {
        let tmp = tempfile::tempdir().unwrap();
        let pack_dir = tmp.path().join("broken-pack");
        std::fs::create_dir_all(&pack_dir).unwrap();
        let manifest = serde_json::json!({
            "name": "Broken",
            "events": {
                "ask": ["ask/exists.wav", "ask/missing.wav"]
            }
        });
        std::fs::write(
            pack_dir.join("pack.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();
        let ask_dir = pack_dir.join("ask");
        std::fs::create_dir_all(&ask_dir).unwrap();
        std::fs::write(ask_dir.join("exists.wav"), b"fake").unwrap();

        let content = std::fs::read_to_string(pack_dir.join("pack.json")).unwrap();
        let parsed: SoundPackManifest = serde_json::from_str(&content).unwrap();
        let valid: Vec<_> = parsed.events["ask"]
            .iter()
            .filter(|f| pack_dir.join(f).exists())
            .collect();
        assert_eq!(valid.len(), 1);
    }
}
