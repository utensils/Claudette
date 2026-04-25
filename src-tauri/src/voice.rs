use std::path::{Path, PathBuf};

use async_trait::async_trait;
use claudette::db::Database;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const SELECTED_PROVIDER_KEY: &str = "voice:selected_provider";
const AUTO_PROVIDER_KEY: &str = "voice:auto_provider";
const PLATFORM_ID: &str = "voice-platform-system";
const DISTIL_ID: &str = "voice-distil-whisper-candle";
const DISTIL_CACHE_DIR: &str = "distil-whisper-large-v3";
const DISTIL_ENGINE_UNAVAILABLE_MESSAGE: &str = "Distil-Whisper is downloaded, but local transcription is not available in this build yet. Use System dictation for now, or install a Claudette build compiled with the Candle voice engine.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceProviderKind {
    Platform,
    LocalModel,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceProviderStatus {
    Ready,
    NeedsSetup,
    Downloading,
    EngineUnavailable,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProviderMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: VoiceProviderKind,
    pub privacy_label: String,
    pub offline: bool,
    pub download_required: bool,
    pub model_size_label: Option<String>,
    pub cache_path: Option<String>,
    pub accelerator_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProviderInfo {
    #[serde(flatten)]
    pub metadata: VoiceProviderMetadata,
    pub status: VoiceProviderStatus,
    pub status_label: String,
    pub enabled: bool,
    pub selected: bool,
    pub setup_required: bool,
    pub can_remove_model: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadProgress {
    pub provider_id: String,
    pub filename: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub overall_downloaded_bytes: u64,
    pub overall_total_bytes: Option<u64>,
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceErrorEvent {
    pub provider_id: Option<String>,
    pub message: String,
}

#[async_trait]
pub trait VoiceProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn metadata(&self, registry: &VoiceProviderRegistry) -> VoiceProviderMetadata;
    fn status(&self, registry: &VoiceProviderRegistry, db: &Database) -> VoiceProviderInfo;
    async fn prepare(
        &self,
        registry: &VoiceProviderRegistry,
        app: &AppHandle,
        db_path: &Path,
    ) -> Result<VoiceProviderInfo, String>;
    async fn start_recording(&self) -> Result<(), String>;
    async fn stop_and_transcribe(&self) -> Result<String, String>;
    async fn cancel(&self) -> Result<(), String>;
}

#[derive(Debug)]
pub struct VoiceProviderRegistry {
    model_root: PathBuf,
}

impl VoiceProviderRegistry {
    pub fn new(model_root: PathBuf) -> Self {
        Self { model_root }
    }

    pub fn default_model_root() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claudette")
            .join("models")
            .join("voice")
    }

    pub fn distil_cache_path(&self) -> PathBuf {
        self.model_root.join(DISTIL_CACHE_DIR)
    }

    pub fn list_providers(&self, db: &Database) -> Vec<VoiceProviderInfo> {
        vec![
            PlatformVoiceProvider.status(self, db),
            DistilWhisperCandleProvider.status(self, db),
        ]
    }

    pub fn set_selected_provider(
        &self,
        db: &Database,
        provider_id: Option<&str>,
    ) -> Result<(), String> {
        if let Some(provider_id) = provider_id {
            self.ensure_known(provider_id)?;
            db.set_app_setting(SELECTED_PROVIDER_KEY, provider_id)
                .map_err(|e| e.to_string())?;
        } else {
            db.delete_app_setting(SELECTED_PROVIDER_KEY)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn set_enabled(
        &self,
        db: &Database,
        provider_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        self.ensure_known(provider_id)?;
        db.set_app_setting(
            &enabled_key(provider_id),
            if enabled { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())
    }

    pub async fn prepare_provider(
        &self,
        app: &AppHandle,
        db_path: &Path,
        provider_id: &str,
    ) -> Result<VoiceProviderInfo, String> {
        match provider_id {
            PLATFORM_ID => PlatformVoiceProvider.prepare(self, app, db_path).await,
            DISTIL_ID => {
                DistilWhisperCandleProvider
                    .prepare(self, app, db_path)
                    .await
            }
            _ => Err(format!("Unknown voice provider: {provider_id}")),
        }
    }

    pub async fn remove_provider_model(
        &self,
        db_path: &Path,
        provider_id: &str,
    ) -> Result<VoiceProviderInfo, String> {
        self.ensure_known(provider_id)?;
        if provider_id != DISTIL_ID {
            return Err("This provider does not use a removable local model".to_string());
        }

        let path = self.distil_cache_path();
        if tokio::fs::try_exists(&path)
            .await
            .map_err(|e| e.to_string())?
        {
            tokio::fs::remove_dir_all(&path)
                .await
                .map_err(|e| format!("Failed to remove model cache: {e}"))?;
        }
        let db = Database::open(db_path).map_err(|e| e.to_string())?;
        db.set_app_setting(&model_status_key(provider_id), "not-installed")
            .map_err(|e| e.to_string())?;
        Ok(DistilWhisperCandleProvider.status(self, &db))
    }

    pub async fn start_recording(&self, provider_id: &str) -> Result<(), String> {
        self.ensure_known(provider_id)?;
        match provider_id {
            PLATFORM_ID => PlatformVoiceProvider.start_recording().await,
            DISTIL_ID => DistilWhisperCandleProvider.start_recording().await,
            _ => Err(format!("Unknown voice provider: {provider_id}")),
        }
    }

    pub async fn stop_and_transcribe(&self, provider_id: &str) -> Result<String, String> {
        self.ensure_known(provider_id)?;
        match provider_id {
            PLATFORM_ID => PlatformVoiceProvider.stop_and_transcribe().await,
            DISTIL_ID => DistilWhisperCandleProvider.stop_and_transcribe().await,
            _ => Err(format!("Unknown voice provider: {provider_id}")),
        }
    }

    pub async fn cancel_recording(&self, provider_id: &str) -> Result<(), String> {
        self.ensure_known(provider_id)?;
        match provider_id {
            PLATFORM_ID => PlatformVoiceProvider.cancel().await,
            DISTIL_ID => DistilWhisperCandleProvider.cancel().await,
            _ => Err(format!("Unknown voice provider: {provider_id}")),
        }
    }

    fn ensure_known(&self, provider_id: &str) -> Result<(), String> {
        match provider_id {
            PLATFORM_ID | DISTIL_ID => Ok(()),
            _ => Err(format!("Unknown voice provider: {provider_id}")),
        }
    }

    fn selected_provider(&self, db: &Database) -> Option<String> {
        db.get_app_setting(SELECTED_PROVIDER_KEY).ok().flatten()
    }

    fn auto_provider_enabled(&self, db: &Database) -> bool {
        db.get_app_setting(AUTO_PROVIDER_KEY)
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    fn enabled(&self, db: &Database, provider_id: &str) -> bool {
        db.get_app_setting(&enabled_key(provider_id))
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    pub(crate) fn resolve_provider_id(
        &self,
        db: &Database,
        requested: Option<&str>,
    ) -> Result<String, String> {
        if let Some(requested) = requested {
            self.ensure_known(requested)?;
            return Ok(requested.to_string());
        }
        if let Some(selected) = self.selected_provider(db) {
            self.ensure_known(&selected)?;
            return Ok(selected);
        }
        if self.auto_provider_enabled(db) {
            return Ok(PLATFORM_ID.to_string());
        }
        Err("No voice provider is selected".to_string())
    }
}

struct PlatformVoiceProvider;

#[cfg(target_os = "macos")]
fn platform_voice_unavailable_reason() -> Option<&'static str> {
    Some(
        "System dictation is disabled on macOS because WKWebView speech recognition can terminate the app before permission errors are recoverable.",
    )
}

#[cfg(not(target_os = "macos"))]
fn platform_voice_unavailable_reason() -> Option<&'static str> {
    None
}

#[async_trait]
impl VoiceProvider for PlatformVoiceProvider {
    fn id(&self) -> &'static str {
        PLATFORM_ID
    }

    fn metadata(&self, _registry: &VoiceProviderRegistry) -> VoiceProviderMetadata {
        VoiceProviderMetadata {
            id: self.id().to_string(),
            name: "System dictation".to_string(),
            description:
                "Uses the webview or operating system speech recognition surface when available. Requires microphone and speech recognition permission."
                    .to_string(),
            kind: VoiceProviderKind::Platform,
            privacy_label: "Uses platform services; offline behavior varies by OS".to_string(),
            offline: false,
            download_required: false,
            model_size_label: None,
            cache_path: None,
            accelerator_label: Some("No setup".to_string()),
        }
    }

    fn status(&self, registry: &VoiceProviderRegistry, db: &Database) -> VoiceProviderInfo {
        let enabled = registry.enabled(db, self.id());
        let unavailable_reason = platform_voice_unavailable_reason();
        VoiceProviderInfo {
            metadata: self.metadata(registry),
            status: if enabled && unavailable_reason.is_none() {
                VoiceProviderStatus::Ready
            } else {
                VoiceProviderStatus::Unavailable
            },
            status_label: if !enabled {
                "Disabled".to_string()
            } else if let Some(reason) = unavailable_reason {
                reason.to_string()
            } else {
                "Ready when webview speech recognition and OS permissions are available".to_string()
            },
            enabled,
            selected: registry.selected_provider(db).as_deref() == Some(self.id()),
            setup_required: false,
            can_remove_model: false,
            error: unavailable_reason.map(str::to_string),
        }
    }

    async fn prepare(
        &self,
        registry: &VoiceProviderRegistry,
        _app: &AppHandle,
        db_path: &Path,
    ) -> Result<VoiceProviderInfo, String> {
        let db = Database::open(db_path).map_err(|e| e.to_string())?;
        Ok(self.status(registry, &db))
    }

    async fn start_recording(&self) -> Result<(), String> {
        Err("System dictation records in the webview when supported".to_string())
    }

    async fn stop_and_transcribe(&self) -> Result<String, String> {
        Err("System dictation records in the webview when supported".to_string())
    }

    async fn cancel(&self) -> Result<(), String> {
        Ok(())
    }
}

struct DistilWhisperCandleProvider;

#[async_trait]
impl VoiceProvider for DistilWhisperCandleProvider {
    fn id(&self) -> &'static str {
        DISTIL_ID
    }

    fn metadata(&self, registry: &VoiceProviderRegistry) -> VoiceProviderMetadata {
        let cache_path = registry.distil_cache_path();
        VoiceProviderMetadata {
            id: self.id().to_string(),
            name: "Distil-Whisper Large v3".to_string(),
            description: "Private offline transcription using distil-whisper/distil-large-v3 through the native provider interface.".to_string(),
            kind: VoiceProviderKind::LocalModel,
            privacy_label: "Private after download; audio stays local".to_string(),
            offline: true,
            download_required: true,
            model_size_label: Some("About 1.5 GB plus tokenizer/config files".to_string()),
            cache_path: Some(cache_path.display().to_string()),
            accelerator_label: Some("CPU now; Candle backend is isolated for Metal/CUDA builds".to_string()),
        }
    }

    fn status(&self, registry: &VoiceProviderRegistry, db: &Database) -> VoiceProviderInfo {
        let enabled = registry.enabled(db, self.id());
        let cache_path = registry.distil_cache_path();
        let model_status = db
            .get_app_setting(&model_status_key(self.id()))
            .ok()
            .flatten();
        let installed = distil_model_ready(&cache_path);
        let (status, status_label, setup_required, error) = if !enabled {
            (
                VoiceProviderStatus::Unavailable,
                "Disabled".to_string(),
                false,
                None,
            )
        } else if model_status.as_deref() == Some("downloading") {
            (
                VoiceProviderStatus::Downloading,
                "Downloading model".to_string(),
                true,
                None,
            )
        } else if installed {
            (
                VoiceProviderStatus::EngineUnavailable,
                "Model installed, engine unavailable".to_string(),
                false,
                Some(DISTIL_ENGINE_UNAVAILABLE_MESSAGE.to_string()),
            )
        } else if model_status
            .as_deref()
            .is_some_and(|status| status.starts_with("error:"))
        {
            (
                VoiceProviderStatus::Error,
                "Download failed".to_string(),
                true,
                model_status.map(|s| s.trim_start_matches("error:").to_string()),
            )
        } else {
            (
                VoiceProviderStatus::NeedsSetup,
                "Download required".to_string(),
                true,
                None,
            )
        };

        VoiceProviderInfo {
            metadata: self.metadata(registry),
            status,
            status_label,
            enabled,
            selected: registry.selected_provider(db).as_deref() == Some(self.id()),
            setup_required,
            can_remove_model: installed,
            error,
        }
    }

    async fn prepare(
        &self,
        registry: &VoiceProviderRegistry,
        app: &AppHandle,
        db_path: &Path,
    ) -> Result<VoiceProviderInfo, String> {
        let cache_path = registry.distil_cache_path();
        tokio::fs::create_dir_all(&cache_path)
            .await
            .map_err(|e| format!("Failed to create model cache: {e}"))?;
        {
            let db = Database::open(db_path).map_err(|e| e.to_string())?;
            db.set_app_setting(&model_status_key(self.id()), "downloading")
                .map_err(|e| e.to_string())?;
        }

        let result = download_distil_model(app, self.id(), &cache_path).await;
        match result {
            Ok(()) => {
                let db = Database::open(db_path).map_err(|e| e.to_string())?;
                db.set_app_setting(&model_status_key(self.id()), "installed")
                    .map_err(|e| e.to_string())?;
                let info = self.status(registry, &db);
                let _ = app.emit("voice-provider-status", &info);
                Ok(info)
            }
            Err(err) => {
                let db = Database::open(db_path).map_err(|e| e.to_string())?;
                let _ = db.set_app_setting(&model_status_key(self.id()), &format!("error:{err}"));
                let _ = app.emit(
                    "voice-error",
                    VoiceErrorEvent {
                        provider_id: Some(self.id().to_string()),
                        message: err.clone(),
                    },
                );
                Err(err)
            }
        }
    }

    async fn start_recording(&self) -> Result<(), String> {
        Err(DISTIL_ENGINE_UNAVAILABLE_MESSAGE.to_string())
    }

    async fn stop_and_transcribe(&self) -> Result<String, String> {
        Err(DISTIL_ENGINE_UNAVAILABLE_MESSAGE.to_string())
    }

    async fn cancel(&self) -> Result<(), String> {
        Ok(())
    }
}

fn enabled_key(provider_id: &str) -> String {
    format!("voice:{provider_id}:enabled")
}

fn model_status_key(provider_id: &str) -> String {
    format!("voice:{provider_id}:model_status")
}

fn distil_model_ready(cache_path: &Path) -> bool {
    let model = cache_path.join("model.safetensors");
    let tokenizer = cache_path.join("tokenizer.json");
    let config = cache_path.join("config.json");
    model.metadata().is_ok_and(|m| m.len() > 100_000_000) && tokenizer.is_file() && config.is_file()
}

async fn download_distil_model(
    app: &AppHandle,
    provider_id: &str,
    cache_path: &Path,
) -> Result<(), String> {
    let files: [(&str, Option<u64>); 5] = [
        ("config.json", None),
        ("generation_config.json", None),
        ("preprocessor_config.json", None),
        ("tokenizer.json", None),
        ("model.safetensors", Some(1_500_000_000)),
    ];
    let known_total = files.iter().filter_map(|(_, size)| *size).sum::<u64>();
    let mut overall_downloaded = 0_u64;
    let client = reqwest::Client::new();

    for (filename, known_size) in files {
        let destination = cache_path.join(filename);
        if destination.is_file() {
            overall_downloaded += destination.metadata().map(|m| m.len()).unwrap_or(0);
            continue;
        }

        let url = format!(
            "https://huggingface.co/distil-whisper/distil-large-v3/resolve/main/{filename}"
        );
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to download {filename}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Failed to download {filename}: {e}"))?;

        let total = response.content_length().or(known_size);
        let part_path = destination.with_extension("part");
        let mut file = tokio::fs::File::create(&part_path)
            .await
            .map_err(|e| format!("Failed to write {filename}: {e}"))?;
        let mut stream = response.bytes_stream();
        let mut downloaded = 0_u64;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Failed while downloading {filename}: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write {filename}: {e}"))?;
            downloaded += chunk.len() as u64;
            let denominator = known_total.max(total.unwrap_or(0));
            let percent = if denominator > 0 {
                Some(((overall_downloaded + downloaded) as f64 / denominator as f64).min(1.0))
            } else {
                None
            };
            let _ = app.emit(
                "voice-download-progress",
                VoiceDownloadProgress {
                    provider_id: provider_id.to_string(),
                    filename: filename.to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    overall_downloaded_bytes: overall_downloaded + downloaded,
                    overall_total_bytes: if known_total > 0 {
                        Some(known_total)
                    } else {
                        None
                    },
                    percent,
                },
            );
        }
        file.flush()
            .await
            .map_err(|e| format!("Failed to flush {filename}: {e}"))?;
        tokio::fs::rename(&part_path, &destination)
            .await
            .map_err(|e| format!("Failed to finalize {filename}: {e}"))?;
        overall_downloaded += downloaded;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("claudette.db");
        let db = Database::open(&db_path).expect("open db");
        drop(db);
        (dir, db_path)
    }

    fn open_test_db(path: &Path) -> Database {
        Database::open(path).expect("open db")
    }

    #[test]
    fn distil_cache_path_uses_provider_specific_directory() {
        let root = PathBuf::from("/tmp/claudette-test-models");
        let registry = VoiceProviderRegistry::new(root.clone());

        assert_eq!(
            registry.distil_cache_path(),
            root.join("distil-whisper-large-v3")
        );
    }

    #[test]
    fn selected_provider_is_persisted_and_reflected_in_status() {
        let (_dir, db_path) = test_db_path();
        let db = open_test_db(&db_path);
        let registry = VoiceProviderRegistry::new(PathBuf::from("/tmp/models"));

        registry
            .set_selected_provider(&db, Some(DISTIL_ID))
            .expect("set selected provider");

        let providers = registry.list_providers(&db);
        assert!(
            providers
                .iter()
                .any(|provider| provider.metadata.id == DISTIL_ID && provider.selected)
        );
        assert!(
            providers
                .iter()
                .any(|provider| provider.metadata.id == PLATFORM_ID && !provider.selected)
        );
    }

    #[test]
    fn disabled_provider_reports_unavailable() {
        let (_dir, db_path) = test_db_path();
        let db = open_test_db(&db_path);
        let registry = VoiceProviderRegistry::new(PathBuf::from("/tmp/models"));

        registry
            .set_enabled(&db, PLATFORM_ID, false)
            .expect("disable platform provider");

        let provider = registry
            .list_providers(&db)
            .into_iter()
            .find(|provider| provider.metadata.id == PLATFORM_ID)
            .expect("platform provider");
        assert_eq!(provider.status, VoiceProviderStatus::Unavailable);
        assert!(!provider.enabled);
        assert!(!provider.setup_required);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn platform_provider_is_unavailable_on_macos() {
        let (_dir, db_path) = test_db_path();
        let db = open_test_db(&db_path);
        let registry = VoiceProviderRegistry::new(PathBuf::from("/tmp/models"));

        let provider = registry
            .list_providers(&db)
            .into_iter()
            .find(|provider| provider.metadata.id == PLATFORM_ID)
            .expect("platform provider");

        assert_eq!(provider.status, VoiceProviderStatus::Unavailable);
        assert!(provider.enabled);
        assert!(
            provider
                .error
                .as_deref()
                .is_some_and(|error| error.contains("disabled on macOS"))
        );
    }

    #[test]
    fn missing_distil_model_requires_setup() {
        let (_db_dir, db_path) = test_db_path();
        let model_dir = tempdir().expect("model dir");
        let db = open_test_db(&db_path);
        let registry = VoiceProviderRegistry::new(model_dir.path().to_path_buf());

        let provider = registry
            .list_providers(&db)
            .into_iter()
            .find(|provider| provider.metadata.id == DISTIL_ID)
            .expect("distil provider");

        assert_eq!(provider.status, VoiceProviderStatus::NeedsSetup);
        assert!(provider.setup_required);
        assert!(!provider.can_remove_model);
    }

    #[test]
    fn complete_distil_model_reports_engine_unavailable() {
        let (_db_dir, db_path) = test_db_path();
        let model_dir = tempdir().expect("model dir");
        let cache_path = model_dir.path().join(DISTIL_CACHE_DIR);
        std::fs::create_dir_all(&cache_path).expect("create model cache");
        std::fs::write(cache_path.join("tokenizer.json"), "{}").expect("write tokenizer");
        std::fs::write(cache_path.join("config.json"), "{}").expect("write config");
        let model_file =
            std::fs::File::create(cache_path.join("model.safetensors")).expect("create model");
        model_file.set_len(100_000_001).expect("size model");

        let db = open_test_db(&db_path);
        let registry = VoiceProviderRegistry::new(model_dir.path().to_path_buf());
        let provider = registry
            .list_providers(&db)
            .into_iter()
            .find(|provider| provider.metadata.id == DISTIL_ID)
            .expect("distil provider");

        assert_eq!(provider.status, VoiceProviderStatus::EngineUnavailable);
        assert!(!provider.setup_required);
        assert!(provider.can_remove_model);
        assert!(
            provider
                .error
                .as_deref()
                .is_some_and(|error| error.contains("not available in this build"))
        );
    }

    #[tokio::test]
    async fn remove_distil_model_clears_cache_and_status() {
        let (_db_dir, db_path) = test_db_path();
        let model_dir = tempdir().expect("model dir");
        let cache_path = model_dir.path().join(DISTIL_CACHE_DIR);
        std::fs::create_dir_all(&cache_path).expect("create model cache");
        std::fs::write(cache_path.join("tokenizer.json"), "{}").expect("write tokenizer");
        let db = open_test_db(&db_path);
        db.set_app_setting(&model_status_key(DISTIL_ID), "installed")
            .expect("set model status");
        drop(db);

        let registry = VoiceProviderRegistry::new(model_dir.path().to_path_buf());
        let provider = registry
            .remove_provider_model(&db_path, DISTIL_ID)
            .await
            .expect("remove model");

        assert!(!cache_path.exists());
        assert_eq!(provider.status, VoiceProviderStatus::NeedsSetup);
        let db = open_test_db(&db_path);
        assert_eq!(
            db.get_app_setting(&model_status_key(DISTIL_ID))
                .expect("get model status"),
            Some("not-installed".to_string())
        );
    }
}
