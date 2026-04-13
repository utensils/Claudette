use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Credential types (stored in macOS Keychain / Linux credentials file)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialFile {
    pub claude_ai_oauth: OAuthCredentials,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCredentials {
    pub access_token: String,
    pub refresh_token: String,
    /// Expiry as unix milliseconds.
    pub expires_at: u64,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

// ---------------------------------------------------------------------------
// Token refresh response
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TokenRefreshResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

// ---------------------------------------------------------------------------
// Usage API response types (returned to frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageLimit {
    pub utilization: f64,
    pub resets_at: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    #[serde(default)]
    pub monthly_limit: Option<f64>,
    #[serde(default)]
    pub used_credits: Option<f64>,
    #[serde(default)]
    pub utilization: Option<f64>,
}

/// The usage API response. We accept unknown fields gracefully since the
/// API shape is not officially documented and may contain extra fields.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageData {
    #[serde(default)]
    pub five_hour: Option<UsageLimit>,
    #[serde(default)]
    pub seven_day: Option<UsageLimit>,
    #[serde(default)]
    pub seven_day_sonnet: Option<UsageLimit>,
    #[serde(default)]
    pub seven_day_opus: Option<UsageLimit>,
    #[serde(default)]
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodeUsage {
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
    pub usage: UsageData,
    pub fetched_at: u64,
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

pub struct UsageCacheEntry {
    pub access_token: String,
    /// Kept for potential future token refresh from cache.
    #[allow(dead_code)]
    pub refresh_token: String,
    pub token_expires_at: u64,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
    /// Cached usage response to avoid hammering the API.
    pub last_usage: Option<ClaudeCodeUsage>,
    /// When the usage was last fetched (unix millis).
    pub last_usage_fetched_at: u64,
}

/// Minimum interval between usage API calls (60 seconds).
const USAGE_CACHE_TTL_MS: u64 = 60_000;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_SCOPES: &str = "user:inference user:profile user:sessions:claude_code";
const ANTHROPIC_BETA: &str = "oauth-2025-04-20";

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Credential reading (platform-specific)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
async fn read_credentials_platform() -> Result<CredentialFile, String> {
    // Claude Code stores credentials under $USER, not a fixed account name.
    let user = std::env::var("USER").unwrap_or_else(|_| "root".to_string());
    let output = tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-a",
            &user,
            "-w",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run security command: {e}"))?;

    if !output.status.success() {
        return Err(
            "Claude Code credentials not found in Keychain. Sign in to Claude Code first.".into(),
        );
    }

    let json = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in credentials: {e}"))?;

    serde_json::from_str(&json).map_err(|e| format!("Failed to parse credentials: {e}"))
}

#[cfg(not(target_os = "macos"))]
async fn read_credentials_platform() -> Result<CredentialFile, String> {
    let path = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".claude")
        .join(".credentials.json");

    let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
        format!(
            "Failed to read Claude Code credentials at {}: {e}",
            path.display()
        )
    })?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse credentials: {e}"))
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async fn refresh_token(refresh_token: &str) -> Result<TokenRefreshResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
            "scope": OAUTH_SCOPES,
        }))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed ({status}): {body}"));
    }

    resp.json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {e}"))
}

// ---------------------------------------------------------------------------
// Usage API fetch
// ---------------------------------------------------------------------------

async fn fetch_usage(access_token: &str) -> Result<UsageData, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("anthropic-beta", ANTHROPIC_BETA)
        .header("Content-Type", "application/json")
        .header("User-Agent", "claudette/0.8.0")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Usage API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Usage API error ({status}): {body}"));
    }

    // Read as text first for debug visibility, then parse.
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read usage response: {e}"))?;
    eprintln!("[usage] Raw API response: {body}");

    // Parse permissively: extract only the fields we care about from
    // whatever the API returns. Unknown fields are silently ignored.
    let raw: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Usage API returned invalid JSON: {e}"))?;

    // The response may wrap usage data in a top-level object or return it
    // directly. Try to extract our known fields from the top-level.
    serde_json::from_value(raw).map_err(|e| format!("Failed to parse usage data: {e}"))
}

// ---------------------------------------------------------------------------
// High-level: resolve a valid access token
// ---------------------------------------------------------------------------

/// Resolve an access token, trying in order:
/// 1. In-memory cache (if token not expired)
/// 2. Platform keychain / credentials file (with refresh if expired)
///
/// Note: CLAUDE_CODE_OAUTH_TOKEN env var is intentionally NOT used here.
/// Those tokens only have `user:inference` scope and cannot access the
/// usage API which requires full OAuth scopes.
async fn resolve_token(
    cache: &RwLock<Option<UsageCacheEntry>>,
) -> Result<(String, Option<String>, Option<String>), String> {
    let now = now_millis();

    // 1. Check cache.
    {
        let cached = cache.read().await;
        if let Some(entry) = cached.as_ref()
            && entry.token_expires_at > now + 60_000
        {
            return Ok((
                entry.access_token.clone(),
                entry.subscription_type.clone(),
                entry.rate_limit_tier.clone(),
            ));
        }
    }

    // 2. Read from platform keychain / credentials file.
    let creds = read_credentials_platform().await?;
    let oauth = &creds.claude_ai_oauth;

    let (token, rt, expires) = if oauth.expires_at <= now + 60_000 {
        // Token expired — refresh.
        let refreshed = refresh_token(&oauth.refresh_token).await?;
        let new_expires = now + refreshed.expires_in.unwrap_or(3600) * 1000;
        let new_refresh = refreshed
            .refresh_token
            .unwrap_or_else(|| oauth.refresh_token.clone());
        (refreshed.access_token, new_refresh, new_expires)
    } else {
        (
            oauth.access_token.clone(),
            oauth.refresh_token.clone(),
            oauth.expires_at,
        )
    };

    let sub_type = oauth.subscription_type.clone();
    let tier = oauth.rate_limit_tier.clone();

    let mut w = cache.write().await;
    *w = Some(UsageCacheEntry {
        access_token: token.clone(),
        refresh_token: rt,
        token_expires_at: expires,
        subscription_type: sub_type.clone(),
        rate_limit_tier: tier.clone(),
        last_usage: None,
        last_usage_fetched_at: 0,
    });

    Ok((token, sub_type, tier))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub async fn get_usage(cache: &RwLock<Option<UsageCacheEntry>>) -> Result<ClaudeCodeUsage, String> {
    let now = now_millis();

    // Return cached usage if it's fresh enough (< 60s old).
    {
        let cached = cache.read().await;
        if let Some(entry) = cached.as_ref()
            && let Some(ref usage) = entry.last_usage
            && now - entry.last_usage_fetched_at < USAGE_CACHE_TTL_MS
        {
            return Ok(usage.clone());
        }
    }

    let (access_token, sub_type, tier) = resolve_token(cache).await?;

    match fetch_usage(&access_token).await {
        Ok(usage_data) => {
            let result = ClaudeCodeUsage {
                subscription_type: sub_type,
                rate_limit_tier: tier,
                usage: usage_data,
                fetched_at: now,
            };
            // Cache the result.
            let mut w = cache.write().await;
            if let Some(entry) = w.as_mut() {
                entry.last_usage = Some(result.clone());
                entry.last_usage_fetched_at = now;
            }
            Ok(result)
        }
        Err(e) => {
            // On 401, invalidate cache so next call re-resolves the token.
            if e.contains("401") {
                let mut w = cache.write().await;
                *w = None;
            }
            Err(e)
        }
    }
}
