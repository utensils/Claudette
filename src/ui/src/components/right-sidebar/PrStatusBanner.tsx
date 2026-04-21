import { memo } from "react";
import {
  GitPullRequestArrow,
  GitPullRequestDraft,
  GitMerge,
  GitPullRequestClosed,
  ExternalLink,
} from "lucide-react";
import { openUrl } from "../../services/tauri";
import { usePrBannerData, type BannerStatus } from "../../hooks/usePrBannerData";
import styles from "./PrStatusBanner.module.css";

const STATUS_CONFIG: Record<
  BannerStatus,
  {
    text: string;
    icon: typeof GitPullRequestArrow;
    bannerClass: string;
    fgClass: string;
  }
> = {
  ready: {
    text: "Ready to merge",
    icon: GitPullRequestArrow,
    bannerClass: styles.bannerReady,
    fgClass: styles.fgReady,
  },
  "ci-pending": {
    text: "CI running",
    icon: GitPullRequestArrow,
    bannerClass: styles.bannerPending,
    fgClass: styles.fgPending,
  },
  "ci-failed": {
    text: "CI failed",
    icon: GitPullRequestArrow,
    bannerClass: styles.bannerFailed,
    fgClass: styles.fgFailed,
  },
  open: {
    text: "Open",
    icon: GitPullRequestArrow,
    bannerClass: styles.bannerOpen,
    fgClass: styles.fgOpen,
  },
  draft: {
    text: "Draft",
    icon: GitPullRequestDraft,
    bannerClass: styles.bannerDraft,
    fgClass: styles.fgDraft,
  },
  merged: {
    text: "Merged",
    icon: GitMerge,
    bannerClass: styles.bannerMerged,
    fgClass: styles.fgMerged,
  },
  closed: {
    text: "Closed",
    icon: GitPullRequestClosed,
    bannerClass: styles.bannerClosed,
    fgClass: styles.fgClosed,
  },
};

export const PrStatusBanner = memo(function PrStatusBanner() {
  const { pr, status } = usePrBannerData();

  if (!pr || !status) return null;

  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className={`${styles.banner} ${config.bannerClass}`}>
      <button
        className={`${styles.prPill} ${config.fgClass}`}
        onClick={() => openUrl(pr.url)}
        title={`Open PR #${pr.number} in browser`}
      >
        <Icon size={14} />
        <span className={styles.prNumber}>#{pr.number}</span>
        <ExternalLink size={14} className={styles.externalIcon} />
      </button>
      <span className={`${styles.statusText} ${config.fgClass}`}>
        {config.text}
      </span>
    </div>
  );
});
