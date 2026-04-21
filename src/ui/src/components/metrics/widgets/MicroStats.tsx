import type { ReactNode } from "react";
import styles from "../metrics.module.css";
import { useAppStore } from "../../../stores/useAppStore";
import { formatTokens } from "../../chat/formatTokens";

interface MicroStatsProps {
  workspaceId: string;
}

function formatShort(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function MicroStats({ workspaceId }: MicroStatsProps) {
  const stats = useAppStore((s) => s.workspaceMetrics[workspaceId]);
  if (!stats) return null;
  const { commitsCount, additions, deletions, totalInputTokens, totalOutputTokens } = stats;
  const totalTokens = totalInputTokens + totalOutputTokens;
  if (
    commitsCount === 0 &&
    additions === 0 &&
    deletions === 0 &&
    totalTokens === 0
  ) {
    return null;
  }
  const parts: ReactNode[] = [];
  if (additions > 0 || deletions > 0) {
    parts.push(
      <span key="churn" title="lines added / removed">
        <span className={styles.microAdd}>+{formatShort(additions)}</span>
        <span className={styles.microSep}>/</span>
        <span className={styles.microDel}>-{formatShort(deletions)}</span>
      </span>
    );
  }
  if (commitsCount > 0) {
    parts.push(<span key="commits" title="commits">{commitsCount}c</span>);
  }
  if (totalTokens > 0) {
    parts.push(<span key="tokens" title="tokens (in + out)">{formatTokens(totalTokens)}t</span>);
  }
  return (
    <div className={styles.microChip}>
      {parts.map((p, i) => (
        <span key={i} className={styles.microPart}>
          {p}
          {i < parts.length - 1 ? (
            <span className={styles.microSep}>·</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
