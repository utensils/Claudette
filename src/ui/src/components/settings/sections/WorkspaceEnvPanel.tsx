import { useCallback, useEffect, useState } from "react";
import {
  getWorkspaceEnvSources,
  reloadWorkspaceEnv,
} from "../../../services/env";
import type { EnvSourceInfo } from "../../../types/env";
import styles from "../Settings.module.css";

interface WorkspaceEnvPanelProps {
  workspaceId: string;
}

/**
 * Diagnostic panel showing which env-provider plugins activated for a
 * workspace (direnv, mise, dotenv, nix-devshell) and how many vars
 * each contributed. Used to answer "why is (or isn't) FOO set when
 * the agent runs Bash?"
 *
 * Clicking Reload evicts the backend's mtime cache for this workspace
 * so the next spawn / fetch re-runs every provider — the escape hatch
 * for when a user ran `direnv allow` outside Claudette and wants the
 * new env picked up immediately.
 */
export function WorkspaceEnvPanel({ workspaceId }: WorkspaceEnvPanelProps) {
  const [sources, setSources] = useState<EnvSourceInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await getWorkspaceEnvSources(workspaceId);
      setSources(result);
    } catch (e) {
      setFetchError(String(e));
      setSources(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleReload = useCallback(async () => {
    try {
      await reloadWorkspaceEnv(workspaceId);
      await refresh();
    } catch (e) {
      setFetchError(String(e));
    }
  }, [workspaceId, refresh]);

  if (fetchError) {
    return (
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Environment</div>
          <div className={styles.settingDescription} role="alert">
            Failed to load: {fetchError}
          </div>
        </div>
      </div>
    );
  }

  if (loading && sources === null) {
    return (
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Environment</div>
          <div className={styles.settingDescription}>Loading…</div>
        </div>
      </div>
    );
  }

  const active = sources?.filter((s) => s.detected) ?? [];
  const errored = sources?.filter((s) => s.error) ?? [];

  return (
    <div className={styles.settingRow}>
      <div className={styles.settingInfo}>
        <div className={styles.settingLabel}>Environment providers</div>
        <div className={styles.settingDescription}>
          Tools whose env is merged into every subprocess spawned in this
          workspace. Cache is invalidated automatically when watched files
          (<code>.envrc</code>, <code>mise.toml</code>, <code>.env</code>,{" "}
          <code>flake.lock</code>, etc.) change.
        </div>
        {active.length === 0 && errored.length === 0 ? (
          <div className={styles.settingDescription}>
            No providers detected for this worktree.
          </div>
        ) : (
          <ul>
            {active.map((s) => (
              <li key={s.plugin_name}>
                <strong>{s.plugin_name}</strong>
                {" — "}
                {s.vars_contributed} var
                {s.vars_contributed === 1 ? "" : "s"}
                {s.cached ? " (cached)" : " (fresh)"}
              </li>
            ))}
            {errored.map((s) => (
              <li key={`err-${s.plugin_name}`} role="alert">
                <strong>{s.plugin_name}</strong>: {s.error}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.settingControl}>
        <button
          type="button"
          onClick={handleReload}
          disabled={loading}
          aria-label="Reload environment providers"
        >
          {loading ? "Reloading…" : "Reload"}
        </button>
      </div>
    </div>
  );
}
