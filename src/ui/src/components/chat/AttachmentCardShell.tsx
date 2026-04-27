import { useState, type ReactNode } from "react";
import {
  FileCode,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";

import styles from "./MessageAttachment.module.css";

/** Format byte count as "B" / "KB" / "MB" with one decimal where useful. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ICONS: Record<string, LucideIcon> = {
  "text/csv": FileSpreadsheet,
  "text/markdown": FileText,
  "application/json": FileCode,
  "text/plain": FileText,
};

/**
 * Common shell used by the CSV / Markdown / JSON / plain-text cards:
 * a header (icon + filename + size) and a body that — when `collapsible`
 * is true — clamps to ~320px (set in CSS via `.body { max-height: 320px }`)
 * with a "Expand" / "Collapse" toggle.
 *
 * `onContextMenu` lets the call site wire the same Download / Copy / Open
 * menu image attachments use.
 */
export function AttachmentCardShell({
  filename,
  mediaType,
  sizeBytes,
  collapsible,
  onContextMenu,
  children,
}: {
  filename: string;
  mediaType: string;
  sizeBytes: number;
  /** When true, the body clamps to ~320px and offers an expand toggle. */
  collapsible: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[mediaType] ?? FileText;

  return (
    <div
      className={styles.card}
      onContextMenu={onContextMenu}
      data-testid="message-attachment-card"
      data-media-type={mediaType}
    >
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <Icon size={14} aria-hidden />
        </span>
        <span className={styles.filename} title={filename}>
          {filename}
        </span>
        <span className={styles.size}>{formatBytes(sizeBytes)}</span>
      </div>
      <div
        className={
          expanded || !collapsible
            ? `${styles.body} ${styles.bodyExpanded}`
            : styles.body
        }
      >
        {children}
        {collapsible && !expanded && <div className={styles.fade} aria-hidden />}
      </div>
      {collapsible && (
        <button
          type="button"
          className={styles.expandToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}
