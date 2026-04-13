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
    pub resets_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: Option<f64>,
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    pub five_hour: Option<UsageLimit>,
    pub seven_day: Option<UsageLimit>,
    pub seven_day_sonnet: Option<UsageLimit>,
    pub seven_day_opus: Option<UsageLimit>,
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
    pub refresh_token: String,
    pub token_expires_at: u64,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

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
    let output = tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-a",
            "root",
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

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read usage response: {e}"))?;
    eprintln!("[usage] Raw API response: {body}");
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse usage response: {e}"))
}

// ---------------------------------------------------------------------------
// High-level: ensure valid token, fetch usage, update cache
// ---------------------------------------------------------------------------

pub async fn get_usage(cache: &RwLock<Option<UsageCacheEntry>>) -> Result<ClaudeCodeUsage, String> {
    // Try to use cached token first.
    let now = now_millis();
    let cached = cache.read().await;
    let (access_token, refresh_tok, sub_type, tier) = if let Some(entry) = cached.as_ref() {
        if entry.token_expires_at > now + 60_000 {
            // Token still valid (with 60s margin).
            (
                entry.access_token.clone(),
                entry.refresh_token.clone(),
                entry.subscription_type.clone(),
                entry.rate_limit_tier.clone(),
            )
        } else {
            // Token expired, need refresh.
            drop(cached);
            let creds_for_refresh = {
                let c = cache.read().await;
                c.as_ref().map(|e| {
                    (
                        e.refresh_token.clone(),
                        e.subscription_type.clone(),
                        e.rate_limit_tier.clone(),
                    )
                })
            };
            if let Some((rt, st, rl)) = creds_for_refresh {
                let refreshed = refresh_token(&rt).await?;
                let new_expires = now + refreshed.expires_in.unwrap_or(3600) * 1000;
                let new_refresh = refreshed.refresh_token.unwrap_or(rt);
                let mut w = cache.write().await;
                *w = Some(UsageCacheEntry {
                    access_token: refreshed.access_token.clone(),
                    refresh_token: new_refresh,
                    token_expires_at: new_expires,
                    subscription_type: st.clone(),
                    rate_limit_tier: rl.clone(),
                });
                (
                    refreshed.access_token,
                    w.as_ref().unwrap().refresh_token.clone(),
                    st,
                    rl,
                )
            } else {
                return Err("No cached credentials to refresh".into());
            }
        }
    } else {
        // No cache — read from keychain.
        drop(cached);
        let creds = read_credentials_platform().await?;
        let oauth = &creds.claude_ai_oauth;

        let (token, rt, expires) = if oauth.expires_at <= now + 60_000 {
            // Token expired, refresh immediately.
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
            refresh_token: rt.clone(),
            token_expires_at: expires,
            subscription_type: sub_type.clone(),
            rate_limit_tier: tier.clone(),
        });

        (token, rt, sub_type, tier)
    };

    // Fetch usage with valid token.
    match fetch_usage(&access_token).await {
        Ok(usage) => Ok(ClaudeCodeUsage {
            subscription_type: sub_type,
            rate_limit_tier: tier,
            usage,
            fetched_at: now,
        }),
        Err(e) => {
            // If we get a 401, the token might be stale despite not being expired.
            // Try one refresh cycle.
            if e.contains("401") {
                let refreshed = refresh_token(&refresh_tok).await?;
                let new_expires = now_millis() + refreshed.expires_in.unwrap_or(3600) * 1000;
                let new_refresh = refreshed.refresh_token.unwrap_or(refresh_tok);

                let mut w = cache.write().await;
                *w = Some(UsageCacheEntry {
                    access_token: refreshed.access_token.clone(),
                    refresh_token: new_refresh,
                    token_expires_at: new_expires,
                    subscription_type: sub_type.clone(),
                    rate_limit_tier: tier.clone(),
                });

                let usage = fetch_usage(&refreshed.access_token).await?;
                Ok(ClaudeCodeUsage {
                    subscription_type: sub_type,
                    rate_limit_tier: tier,
                    usage,
                    fetched_at: now_millis(),
                })
            } else {
                Err(e)
            }
        }
    }
}
