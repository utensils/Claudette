import { useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useAppStore } from "../../../stores/useAppStore";
import { getClaudeCodeUsage } from "../../../services/tauri";
import type { UsageLimit, ExtraUsage } from "../../../types/usage";
import styles from "../Settings.module.css";

function barColor(pct: number): string {
  if (pct >= 85) return "var(--status-stopped)";
  if (pct >= 60) return "#e0a030";
  return "var(--accent-primary)";
}

function formatResetTime(resetsAt: number): string {
  const nowSec = Date.now() / 1000;
  const diffSec = resetsAt - nowSec;
  if (diffSec <= 0) return "resetting now";
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `resets in ${days}d ${remHours}h`;
  }
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTier(tier: string | null): string {
  if (!tier) return "";
  return tier
    .replace("default_claude_", "")
    .replace(/_/g, " ")
    .toUpperCase();
}

function UsageBar({
  title,
  limit,
}: {
  title: string;
  limit: UsageLimit;
}) {
  const pct = Math.min(limit.utilization, 100);
  const color = barColor(pct);

  return (
    <div className={styles.usageCard}>
      <div className={styles.usageCardHeader}>
        <span className={styles.usageCardTitle}>{title}</span>
        <span className={styles.usageCardValue} style={{ color }}>
          {Math.floor(pct)}% used
        </span>
      </div>
      <div className={styles.usageBarTrack}>
        <div
          className={styles.usageBarFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className={styles.usageReset}>{formatResetTime(limit.resets_at)}</div>
    </div>
  );
}

function ExtraUsageSection({ extra }: { extra: ExtraUsage }) {
  if (!extra.is_enabled) {
    return (
      <>
        <div className={styles.usageExtraHeader}>Extra Usage</div>
        <div className={styles.usageCard}>
          <span className={styles.usageCardTitle} style={{ color: "var(--text-dim)" }}>
            Not enabled
          </span>
        </div>
      </>
    );
  }

  const hasLimit = extra.monthly_limit !== null && extra.monthly_limit !== undefined;
  const usedDollars = (extra.used_credits ?? 0) / 100;
  const limitDollars = hasLimit ? (extra.monthly_limit as number) / 100 : null;
  const pct = extra.utilization ?? 0;

  return (
    <>
      <div className={styles.usageExtraHeader}>Extra Usage</div>
      <div className={styles.usageCard}>
        <div className={styles.usageCardHeader}>
          <span className={styles.usageCardTitle}>Monthly spend</span>
          <span className={styles.usageCardValue} style={{ color: barColor(pct) }}>
            ${usedDollars.toFixed(2)}
            {limitDollars !== null ? ` / $${limitDollars.toFixed(2)}` : " (unlimited)"}
          </span>
        </div>
        {hasLimit && (
          <div className={styles.usageBarTrack}>
            <div
              className={styles.usageBarFill}
              style={{
                width: `${Math.min(pct, 100)}%`,
                background: barColor(pct),
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

export function UsageSettings() {
  const usage = useAppStore((s) => s.claudeCodeUsage);
  const loading = useAppStore((s) => s.claudeCodeUsageLoading);
  const error = useAppStore((s) => s.claudeCodeUsageError);
  const setUsage = useAppStore((s) => s.setClaudeCodeUsage);
  const setLoading = useAppStore((s) => s.setClaudeCodeUsageLoading);
  const setError = useAppStore((s) => s.setClaudeCodeUsageError);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getClaudeCodeUsage();
      setUsage(data);
    } catch (e) {
      setError(String(e));
    }
  }, [setUsage, setLoading, setError]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const limits: { title: string; limit: UsageLimit }[] = [];
  if (usage?.usage.five_hour) {
    limits.push({ title: "Current session", limit: usage.usage.five_hour });
  }
  if (usage?.usage.seven_day) {
    limits.push({ title: "Current week (all models)", limit: usage.usage.seven_day });
  }
  if (usage?.usage.seven_day_sonnet) {
    limits.push({ title: "Current week (Sonnet)", limit: usage.usage.seven_day_sonnet });
  }
  if (usage?.usage.seven_day_opus) {
    limits.push({ title: "Current week (Opus)", limit: usage.usage.seven_day_opus });
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Usage</h2>

      {loading && !usage && (
        <div className={styles.usageEmptyState}>Loading usage data...</div>
      )}

      {error && !usage && (
        <div className={styles.usageEmptyState}>
          <span>{error}</span>
          <button className={styles.usageRefreshBtn} onClick={fetchUsage}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {usage && (
        <div className={styles.usageSection}>
          {(usage.subscription_type || usage.rate_limit_tier) && (
            <div>
              <span className={styles.usagePlanBadge}>
                {usage.subscription_type ?? "Pro"}
                {usage.rate_limit_tier && (
                  <span style={{ opacity: 0.7, fontWeight: 400 }}>
                    {formatTier(usage.rate_limit_tier)}
                  </span>
                )}
              </span>
            </div>
          )}

          {limits.length === 0 && !usage.usage.extra_usage && (
            <div className={styles.usageEmptyState}>
              No usage data available yet. Usage appears after your first Claude Code interaction.
            </div>
          )}

          {limits.map((l) => (
            <UsageBar key={l.title} title={l.title} limit={l.limit} />
          ))}

          {usage.usage.extra_usage && (
            <ExtraUsageSection extra={usage.usage.extra_usage} />
          )}

          <div className={styles.usageFooter}>
            <button
              className={styles.usageRefreshBtn}
              onClick={fetchUsage}
              disabled={loading}
            >
              <RefreshCw size={12} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <span className={styles.usageTimestamp}>
              Last updated {formatTimestamp(usage.fetched_at)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
