import { PanelLeft, PanelBottom, PanelRight } from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import styles from "./PanelToggles.module.css";

const isMac =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
const mod = isMac ? "⌘" : "Ctrl+";

export function PanelToggles() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const terminalPanelVisible = useAppStore((s) => s.terminalPanelVisible);
  const rightSidebarVisible = useAppStore((s) => s.rightSidebarVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleTerminalPanel = useAppStore((s) => s.toggleTerminalPanel);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);

  return (
    <div className={styles.toggles}>
      <button
        className={`${styles.toggle} ${sidebarVisible ? styles.active : ""}`}
        onClick={toggleSidebar}
        title={`Toggle sidebar (${mod}B)`}
      >
        <PanelLeft size={16} />
      </button>
      <button
        className={`${styles.toggle} ${terminalPanelVisible ? styles.active : ""}`}
        onClick={toggleTerminalPanel}
        title={`Toggle terminal (${mod}\`)`}
      >
        <PanelBottom size={16} />
      </button>
      <button
        className={`${styles.toggle} ${rightSidebarVisible ? styles.active : ""}`}
        onClick={toggleRightSidebar}
        title={`Toggle changes (${mod}D)`}
      >
        <PanelRight size={16} />
      </button>
    </div>
  );
}
