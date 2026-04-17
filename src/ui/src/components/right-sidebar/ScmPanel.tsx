import { memo, useCallback, useEffect, useState } from "react";
import {
  GitPullRequestArrow,
  GitPullRequestDraft,
  GitMerge,
  GitPullRequestClosed,
  Check,
  X,
  Loader2,
  RefreshCw,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import { loadScmDetail, scmRefresh, openUrl } from "../../services/tauri";
import type { PullRequest, CiCheck } from "../../types/plugin";
import styles from "./ScmPanel.module.css";

export const ScmPanel = memo(function ScmPanel() {
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const scmDetail = useAppStore((s) => s.scmDetail);
  const scmDetailLoading = useAppStore((s) => s.scmDetailLoading);
  const setScmDetail = useAppStore((s) => s.setScmDetail);
  const setScmDetailLoading = useAppStore((s) => s.setScmDetailLoading);
  const setScmSummary = useAppStore((s) => s.setScmSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const updateSummaryFromDetail = useCallback(
    (workspaceId: string, detail: Awaited<ReturnType<typeof loadScmDetail>>) => {
      if (detail.pull_request) {
        setScmSummary(workspaceId, {
          hasPr: true,
          prState: detail.pull_request.state,
          ciState: detail.pull_request.ci_status,
          lastUpdated: Date.now(),
        });
      } else {
        setScmSummary(workspaceId, {
          hasPr: false,
          prState: null,
          ciState: null,
          lastUpdated: Date.now(),
        });
      }
    },
    [setScmSummary],
  );

  const fetchDetail = useCallback(
    async (workspaceId: string) => {
      setScmDetailLoading(true);
      setLoadError(null);
      try {
        const detail = await loadScmDetail(workspaceId);
        // Guard against workspace-switch race: the user may have moved on
        // while this request was in flight. Drop the response if so.
        if (useAppStore.getState().selectedWorkspaceId !== workspaceId) {
          return;
        }
        setScmDetail(detail);
        updateSummaryFromDetail(workspaceId, detail);
      } catch (e) {
        if (useAppStore.getState().selectedWorkspaceId === workspaceId) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setScmDetailLoading(false);
      }
    },
    [setScmDetail, setScmDetailLoading, updateSummaryFromDetail],
  );

  useEffect(() => {
    // Clear stale detail on workspace switch so the UI doesn't flash the
    // previous workspace's PR/provider while the new fetch is in flight.
    if (scmDetail && scmDetail.workspace_id !== selectedWorkspaceId) {
      setScmDetail(null);
    }
    if (selectedWorkspaceId) {
      fetchDetail(selectedWorkspaceId);
    } else {
      setScmDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  const handleRefresh = useCallback(async () => {
    if (!selectedWorkspaceId || refreshing) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const detail = await scmRefresh(selectedWorkspaceId);
      if (useAppStore.getState().selectedWorkspaceId !== selectedWorkspaceId) {
        return;
      }
      setScmDetail(detail);
      updateSummaryFromDetail(selectedWorkspaceId, detail);
    } catch (e) {
      if (useAppStore.getState().selectedWorkspaceId === selectedWorkspaceId) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRefreshing(false);
    }
  }, [selectedWorkspaceId, refreshing, setScmDetail, updateSummaryFromDetail]);

  if (!selectedWorkspaceId) {
    return <div className={styles.empty}>Select a workspace</div>;
  }

  // Treat detail from a different workspace as "not yet loaded" to avoid
  // flashing stale PR/provider info during a workspace switch.
  const relevantDetail =
    scmDetail && scmDetail.workspace_id === selectedWorkspaceId ? scmDetail : null;

  if (scmDetailLoading && !relevantDetail) {
    return (
      <div className={styles.empty}>
        <Loader2 size={16} className={styles.spin} />
        Loading SCM data...
      </div>
    );
  }

  // A failed load is distinct from "provider exists but has no PR" — show
  // an explicit error rather than the misleading "No SCM provider" copy.
  if (loadError && !relevantDetail) {
    return (
      <div className={styles.empty}>
        <AlertCircle size={16} />
        <span>Failed to load SCM data</span>
        <span className={styles.hint}>{loadError}</span>
      </div>
    );
  }

  if (!relevantDetail?.provider) {
    return (
      <div className={styles.empty}>
        <AlertCircle size={16} />
        <span>No SCM provider detected</span>
        <span className={styles.hint}>
          Install a CLI tool like <code>gh</code> or <code>glab</code>
        </span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.providerBadge}>{relevantDetail.provider}</span>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
        >
          <RefreshCw size={13} className={refreshing ? styles.spin : ""} />
        </button>
      </div>

      {relevantDetail.error && (
        <div className={styles.error}>{relevantDetail.error}</div>
      )}

      {relevantDetail.pull_request ? (
        <PrCard pr={relevantDetail.pull_request} />
      ) : (
        <div className={styles.noPr}>No pull request for this branch</div>
      )}

      {relevantDetail.ci_checks.length > 0 && (
        <div className={styles.checksSection}>
          <div className={styles.sectionTitle}>CI Checks</div>
          {relevantDetail.ci_checks.map((check) => (
            <CiCheckRow key={check.name} check={check} />
          ))}
        </div>
      )}
    </div>
  );
});

function PrCard({ pr }: { pr: PullRequest }) {
  const PrIcon = getPrIcon(pr);
  const prColor = getPrColor(pr);

  return (
    <div className={styles.prCard}>
      <div className={styles.prHeader}>
        <PrIcon size={16} style={{ color: prColor }} />
        <span className={styles.prNumber}>#{pr.number}</span>
        <span className={styles.prState} style={{ color: prColor }}>
          {pr.state}
        </span>
        {pr.url && (
          <button
            className={styles.prLink}
            title="Open in browser"
            onClick={() => openUrl(pr.url)}
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>
      <div className={styles.prTitle}>{pr.title}</div>
      <div className={styles.prMeta}>
        <span>{pr.author}</span>
        <span>
          {pr.branch} → {pr.base}
        </span>
      </div>
    </div>
  );
}

function CiCheckRow({ check }: { check: CiCheck }) {
  const StatusIcon = getCheckIcon(check.status);
  const color = getCheckColor(check.status);

  return (
    <div className={styles.checkRow}>
      <StatusIcon size={14} style={{ color }} />
      <span className={styles.checkName}>{check.name}</span>
      {check.url && (
        <button
          className={styles.checkLink}
          title="View details"
          onClick={() => openUrl(check.url!)}
        >
          <ExternalLink size={10} />
        </button>
      )}
    </div>
  );
}

function getPrIcon(pr: PullRequest) {
  switch (pr.state) {
    case "merged":
      return GitMerge;
    case "closed":
      return GitPullRequestClosed;
    case "draft":
      return GitPullRequestDraft;
    default:
      return GitPullRequestArrow;
  }
}

function getPrColor(pr: PullRequest): string {
  switch (pr.state) {
    case "merged":
      return "var(--purple, #a855f7)";
    case "closed":
      return "var(--red, #ef4444)";
    case "draft":
      return "var(--text-dim)";
    default:
      return "var(--green, #22c55e)";
  }
}

function getCheckIcon(status: CiCheck["status"]) {
  switch (status) {
    case "success":
      return Check;
    case "failure":
    case "cancelled":
      return X;
    default:
      return Loader2;
  }
}

function getCheckColor(status: CiCheck["status"]): string {
  switch (status) {
    case "success":
      return "var(--green, #22c55e)";
    case "failure":
      return "var(--red, #ef4444)";
    case "cancelled":
      return "var(--text-dim)";
    default:
      return "var(--yellow, #eab308)";
  }
}
