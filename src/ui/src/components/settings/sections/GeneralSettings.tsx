import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useAppStore } from "../../../stores/useAppStore";
import { getAppSetting, setAppSetting } from "../../../services/tauri";
import { checkForUpdate } from "../../../hooks/useAutoUpdater";
import styles from "../Settings.module.css";

export function GeneralSettings() {
  const worktreeBaseDir = useAppStore((s) => s.worktreeBaseDir);
  const setWorktreeBaseDir = useAppStore((s) => s.setWorktreeBaseDir);
  const updateAvailable = useAppStore((s) => s.updateAvailable);

  const [path, setPath] = useState(worktreeBaseDir);
  const [trayEnabled, setTrayEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [checkState, setCheckState] = useState<"idle" | "checking" | "up-to-date">("idle");

  useEffect(() => {
    setPath(worktreeBaseDir);
  }, [worktreeBaseDir]);

  useEffect(() => {
    getAppSetting("tray_enabled")
      .then((val) => setTrayEnabled(val !== "false"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Auto-reset "up to date" message after 4 seconds.
  useEffect(() => {
    if (checkState !== "up-to-date") return;
    const timer = setTimeout(() => setCheckState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [checkState]);

  // If an update becomes available (e.g. from the banner), reset to idle.
  useEffect(() => {
    if (updateAvailable) setCheckState("idle");
  }, [updateAvailable]);

  const handleCheckForUpdates = async () => {
    setCheckState("checking");
    const found = await checkForUpdate();
    if (!found) {
      setCheckState("up-to-date");
    }
  };

  const handlePathBlur = async () => {
    const trimmed = path.trim();
    if (trimmed && trimmed !== worktreeBaseDir) {
      try {
        setError(null);
        await setAppSetting("worktree_base_dir", trimmed);
        setWorktreeBaseDir(trimmed);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const handleTrayToggle = async () => {
    const next = !trayEnabled;
    setTrayEnabled(next);
    try {
      setError(null);
      await setAppSetting("tray_enabled", next ? "true" : "false");
    } catch (e) {
      setTrayEnabled(!next);
      setError(String(e));
    }
  };

  return (
    <div>
      <h2 className={styles.sectionTitle}>General</h2>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>App version</div>
          <div className={styles.settingDescription}>
            {appVersion ? `v${appVersion}` : "\u2026"}
          </div>
        </div>
        <div className={styles.settingControl}>
          <button
            className={styles.iconBtn}
            onClick={handleCheckForUpdates}
            disabled={checkState === "checking"}
          >
            {checkState === "checking"
              ? "Checking\u2026"
              : checkState === "up-to-date"
                ? "Up to date"
                : "Check for Updates"}
          </button>
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Worktree base directory</div>
          <div className={styles.settingDescription}>
            Where new workspaces are created
          </div>
        </div>
        <div className={styles.settingControl}>
          <div className={styles.inlineControl}>
            <input
              className={styles.input}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onBlur={handlePathBlur}
              placeholder="~/.claudette/workspaces"
            />
            <button
              className={styles.iconBtn}
              onClick={async () => {
                try {
                  const selected = await open({ directory: true, multiple: false });
                  if (selected) {
                    setPath(selected);
                    setError(null);
                    await setAppSetting("worktree_base_dir", selected);
                    setWorktreeBaseDir(selected);
                  }
                } catch (e) {
                  setError(String(e));
                }
              }}
              title="Browse"
            >
              <FolderOpen size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>System tray</div>
          <div className={styles.settingDescription}>
            Show Claudette in the system tray. Closing the window will minimize
            to tray when enabled.
          </div>
        </div>
        <div className={styles.settingControl}>
          <button
            className={styles.toggle}
            role="switch"
            aria-checked={trayEnabled}
            aria-label="System tray"
            data-checked={trayEnabled}
            onClick={handleTrayToggle}
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>
    </div>
  );
}
