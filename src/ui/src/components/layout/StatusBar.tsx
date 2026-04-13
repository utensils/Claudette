import { useMemo } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useShallow } from "zustand/react/shallow";
import styles from "./StatusBar.module.css";

function usageDotColor(pct: number): string {
  if (pct >= 85) return "var(--status-stopped)";
  if (pct >= 60) return "#e0a030";
  return "var(--accent-primary)";
}

export function StatusBar() {
  const runningCount = useAppStore(
    (s) => s.workspaces.filter((ws) => ws.agent_status === "Running").length
  );
  const activeCount = useAppStore(
    (s) => s.workspaces.filter((ws) => ws.status === "Active").length
  );
  const updateAvailable = useAppStore((s) => s.updateAvailable);
  const updateVersion = useAppStore((s) => s.updateVersion);
  const setUpdateDismissed = useAppStore((s) => s.setUpdateDismissed);
  const openSettings = useAppStore((s) => s.openSettings);
  const connectedRemoteNames = useAppStore(
    useShallow((s) =>
      s.remoteConnections
        .filter((c) => s.activeRemoteIds.includes(c.id))
        .map((c) => c.name)
    )
  );
  const claudeCodeUsage = useAppStore((s) => s.claudeCodeUsage);

  const peakUtilization = useMemo(() => {
    if (!claudeCodeUsage) return null;
    const u = claudeCodeUsage.usage;
    const vals = [u.five_hour, u.seven_day, u.seven_day_sonnet, u.seven_day_opus]
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => l.utilization);
    if (vals.length === 0) return null;
    return Math.max(...vals);
  }, [claudeCodeUsage]);

  return (
    <div className={styles.bar}>
      <div className={styles.stats}>
        {runningCount > 0 && (
          <span className={styles.statRunning}>
            <span className={styles.statDot} />
            {runningCount} running
          </span>
        )}
        <span className={styles.statMuted}>
          {activeCount} workspace{activeCount !== 1 ? "s" : ""}
        </span>
        {connectedRemoteNames.length > 0 && (
          <span className={styles.statMuted}>
            {connectedRemoteNames.join(", ")}
          </span>
        )}
      </div>
      {peakUtilization !== null && (
        <button
          className={styles.statUsage}
          onClick={() => openSettings("usage")}
          title={`Claude Code usage: ${Math.floor(peakUtilization)}%`}
        >
          <span
            className={styles.usageDot}
            style={{ background: usageDotColor(peakUtilization) }}
          />
          {Math.floor(peakUtilization)}%
        </button>
      )}
      {updateAvailable && (
        <button
          className={styles.statUpdate}
          onClick={() => setUpdateDismissed(false)}
          title={`Update available: v${updateVersion}`}
        >
          update available
        </button>
      )}
    </div>
  );
}
