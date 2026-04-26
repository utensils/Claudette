import { useState } from "react";
import { Brain } from "lucide-react";
import { useTypewriter } from "../../hooks/useTypewriter";
import { HighlightedPlainText } from "./HighlightedPlainText";
import styles from "./ThinkingBlock.module.css";
import caretStyles from "./caret.module.css";

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  enableTypewriter?: boolean;
  /** Active chat-search query. When non-empty and the query matches inside
   *  this block's content, the block force-expands so matches aren't
   *  hidden behind the collapsed header. */
  searchQuery?: string;
}

export function ThinkingBlock({ content, isStreaming, enableTypewriter, searchQuery }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { displayed, showCaret } = useTypewriter(content, isStreaming, {
    enabled: enableTypewriter && expanded,
  });

  if (!content) return null;

  const label = isStreaming ? "Thinking…" : "Thinking";
  const queryMatches =
    !!searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase());
  const isExpanded = expanded || queryMatches;
  const visibleContent = enableTypewriter ? displayed : content;

  return (
    <div className={styles.container}>
      <button
        className={styles.header}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={isExpanded}
      >
        <span className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ""}`}>
          ›
        </span>
        <Brain size={14} />
        <span className={styles.label}>{label}</span>
      </button>
      {isExpanded && (
        <div className={styles.content}>
          {searchQuery ? (
            <HighlightedPlainText text={visibleContent} query={searchQuery} />
          ) : (
            visibleContent
          )}
          {showCaret && <span className={caretStyles.caret} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
