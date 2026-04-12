import { useEffect, useState } from "react";
import { useAppStore } from "../../../stores/useAppStore";
import { setAppSetting } from "../../../services/tauri";
import { applyTheme, loadAllThemes, findTheme } from "../../../utils/theme";
import type { ThemeDefinition } from "../../../types/theme";
import styles from "../Settings.module.css";

export function AppearanceSettings() {
  const currentThemeId = useAppStore((s) => s.currentThemeId);
  const setCurrentThemeId = useAppStore((s) => s.setCurrentThemeId);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);

  const [availableThemes, setAvailableThemes] = useState<ThemeDefinition[]>([]);
  const [fontSize, setFontSize] = useState(String(terminalFontSize));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAllThemes().then(setAvailableThemes).catch(() => {});
  }, []);

  const handleThemeChange = async (id: string) => {
    const theme = findTheme(availableThemes, id);
    applyTheme(theme);
    setCurrentThemeId(id);
    try {
      setError(null);
      await setAppSetting("theme", id);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleFontSizeBlur = async () => {
    const size = parseInt(fontSize, 10);
    if (isNaN(size) || size < 8 || size > 24) {
      setFontSize(String(terminalFontSize));
      return;
    }
    if (size !== terminalFontSize) {
      try {
        setError(null);
        await setAppSetting("terminal_font_size", String(size));
        setTerminalFontSize(size);
      } catch (e) {
        setFontSize(String(terminalFontSize));
        setError(String(e));
      }
    }
  };

  return (
    <div>
      <h2 className={styles.sectionTitle}>Appearance</h2>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Color theme</div>
          <div className={styles.settingDescription}>
            Add custom themes to ~/.claudette/themes/
          </div>
        </div>
        <div className={styles.settingControl}>
          <select
            className={styles.select}
            value={currentThemeId}
            onChange={(e) => handleThemeChange(e.target.value)}
          >
            {availableThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Terminal font size</div>
          <div className={styles.settingDescription}>8–24px (default: 11)</div>
        </div>
        <div className={styles.settingControl}>
          <input
            className={styles.numberInput}
            type="number"
            min={8}
            max={24}
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            onBlur={handleFontSizeBlur}
          />
        </div>
      </div>
    </div>
  );
}
