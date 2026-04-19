import { useState } from "react";
import { Brain } from "lucide-react";
import styles from "./ThinkingBlock.module.css";

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  showCaret?: boolean;
}

export function ThinkingBlock({ content, isStreaming, showCaret }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  const label = isStreaming ? "Thinking\u2026" : "Thinking";

  return (
    <div className={styles.container}>
      <button
        className={styles.header}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>
          ›
        </span>
        <Brain size={14} />
        <span className={styles.label}>{label}</span>
      </button>
      {expanded && (
        <div className={styles.content}>
          {content}
          {showCaret && <span className={styles.caret} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
