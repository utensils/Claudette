import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, GitBranch, MinusCircle, X } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/useAppStore";
import {
  cancelWorkspacesBulk,
  deleteWorkspacesBulk,
  type BulkCleanupProgress,
} from "../../services/tauri";
import { RepoIcon } from "../shared/RepoIcon";
import type { Repository, Workspace } from "../../types";
import { Modal } from "./Modal";
import shared from "./shared.module.css";
import styles from "./BulkCleanupArchivedModal.module.css";
import {
  AGE_FILTERS,
  type AgeBucket,
  type AgeFilter,
  ageBucket,
  filterByAge,
  groupByRepository,
  parseCreatedAt,
} from "./BulkCleanupArchivedModal.helpers";

/** Per-row terminal state populated from `bulk-cleanup-progress` events
 *  during a run. Rows that haven't been processed yet are absent from
 *  the map — the row UI treats absence as "pending" (spinner). */
type RowProgressStatus = "deleted" | "failed" | "cancelled";

interface RowProgress {
  status: RowProgressStatus;
  error?: string;
}

/** Run lifecycle. Drives which controls render (Cancel vs Cancelling…
 *  vs Confirm). `requestId` is the UUID the modal generated when it
 *  invoked `deleteWorkspacesBulk` — kept in state so the Cancel button
 *  can target the right run and the event listener can filter events. */
type RunState =
  | { kind: "idle" }
  | { kind: "running"; requestId: string; cancelling: boolean };

export function BulkCleanupArchivedModal() {
  const { t } = useTranslation("modals");
  const { t: tCommon } = useTranslation("common");
  const closeModal = useAppStore((s) => s.closeModal);
  const modalData = useAppStore((s) => s.modalData);
  // `repoId` is one of:
  //   - a string  → single-repo mode (the per-repo Clean up… button).
  //   - `null`    → cleanup-all mode (Storage section header button).
  //   - missing / wrong type → close immediately. A future deep-link
  //     opening the modal without `repoId` set is still legal as
  //     long as the caller sets it to `null` explicitly.
  const repoId = (() => {
    if (modalData.repoId === null) return null;
    if (typeof modalData.repoId === "string" && modalData.repoId.length > 0) {
      return modalData.repoId;
    }
    return undefined;
  })();
  const workspaces = useAppStore((s) => s.workspaces);
  const repositories = useAppStore((s) => s.repositories);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const addToast = useAppStore((s) => s.addToast);

  useEffect(() => {
    if (repoId === undefined) closeModal();
  }, [repoId, closeModal]);

  const ageBucketLabel = (bucket: AgeBucket | null): string => {
    if (!bucket) return "";
    switch (bucket.kind) {
      case "today":
        return t("bulk_cleanup_age_today");
      case "days":
        return t("bulk_cleanup_age_days", { count: bucket.count });
      case "months":
        return t("bulk_cleanup_age_months", { count: bucket.count });
      case "years":
        return t("bulk_cleanup_age_years", { count: bucket.count });
    }
  };

  // Local repos only — bulk delete dispatches to the local Tauri
  // command, which can't reach workspaces owned by a paired remote
  // connection. Cleanup-all flattens across every local repo.
  const localRepoIds = useMemo(
    () =>
      new Set(
        repositories.filter((r) => !r.remote_connection_id).map((r) => r.id),
      ),
    [repositories],
  );

  const archived = useMemo<Workspace[]>(
    () =>
      workspaces
        .filter((w) => {
          if (w.status !== "Archived") return false;
          if (w.remote_connection_id) return false;
          if (!localRepoIds.has(w.repository_id)) return false;
          if (repoId !== null && w.repository_id !== repoId) return false;
          return true;
        })
        .sort((a, b) => {
          const av = parseCreatedAt(a.created_at) ?? Number.NEGATIVE_INFINITY;
          const bv = parseCreatedAt(b.created_at) ?? Number.NEGATIVE_INFINITY;
          return bv - av;
        }),
    [workspaces, repoId, localRepoIds],
  );

  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runState, setRunState] = useState<RunState>({ kind: "idle" });
  const [failures, setFailures] = useState<Map<string, string>>(new Map());
  // Live per-row status during a run, keyed by workspace_id. Cleared
  // when a fresh run starts; preserved between Cancel and the toast so
  // the user sees the final counts before the modal closes.
  const [progress, setProgress] = useState<Map<string, RowProgress>>(
    new Map(),
  );
  // Snapshot of ids dispatched at the start of the current run. Used
  // as the source of truth for the live list — `archived` may shrink
  // mid-run as the Deleted hook evicts rows from the Zustand store,
  // and we want the list to keep rendering every row through to its
  // terminal status.
  const [runIds, setRunIds] = useState<string[]>([]);

  const nowSecs = useMemo(() => Math.floor(Date.now() / 1000), []);

  const eligible = useMemo<Workspace[]>(
    () => filterByAge(archived, ageFilter, nowSecs),
    [archived, ageFilter, nowSecs],
  );

  const eligibleIds = useMemo(
    () => new Set(eligible.map((w) => w.id)),
    [eligible],
  );

  const effectiveSelection = useMemo(() => {
    const out = new Set<string>();
    for (const id of selected) {
      if (eligibleIds.has(id)) out.add(id);
    }
    return out;
  }, [selected, eligibleIds]);

  const allEligibleSelected =
    eligible.length > 0 && effectiveSelection.size === eligible.length;

  // Workspaces rendered during a run come from `runIds` (the dispatched
  // snapshot) — we look up each id in `workspaces` to get the row data.
  // If the Zustand store has already evicted it (Deleted hook fired
  // before this render), we synthesize a minimal record from the
  // progress event's `name` payload so the row still renders with a
  // visible label and its final status icon.
  const runRows = useMemo<Workspace[]>(() => {
    if (runIds.length === 0) return [];
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    return runIds.map((id) => {
      const live = byId.get(id);
      if (live) return live;
      // Synthesized fallback for evicted rows. Only the fields the
      // row renderer reads are populated; the rest stay defaults.
      const progressEntry = progress.get(id);
      const placeholder: Workspace = {
        id,
        repository_id: "",
        name: progressEntry ? `${id}` : id,
        branch_name: "",
        worktree_path: null,
        status: "Archived",
        agent_status: "Stopped",
        status_line: "",
        created_at: "",
        sort_order: 0,
        remote_connection_id: null,
      };
      // If we captured a friendly name in progress events, expose it.
      // The event payload uses `name`, but progress map values today
      // only carry status + error. Names are looked up from the
      // pre-run snapshot below instead.
      return placeholder;
    });
  }, [runIds, workspaces, progress]);

  // Name snapshot captured at run start so evicted rows can still show
  // their original workspace name in the live list. Keyed by
  // workspace_id; survives until the next run begins.
  const runNamesRef = useRef<Map<string, string>>(new Map());

  // Repo display info captured at run start so we can keep rendering
  // per-repo headers even after a repo's last workspace evicts.
  const runReposRef = useRef<Map<string, Repository>>(new Map());

  // workspace_id → repository_id snapshot at dispatch time. Used in
  // run mode to reconstruct grouping even after Zustand evictions
  // null out `row.repository_id` on the synthesized placeholder.
  const runIdToRepoIdRef = useRef<Map<string, string>>(new Map());

  const clearStaleFailures = () => {
    setFailures((prev) => (prev.size === 0 ? prev : new Map()));
  };

  const handleAgeFilterChange = (next: AgeFilter) => {
    if (runState.kind === "running") return;
    setAgeFilter(next);
    clearStaleFailures();
  };

  const toggleRow = (id: string) => {
    if (runState.kind === "running") return;
    clearStaleFailures();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (runState.kind === "running") return;
    clearStaleFailures();
    if (allEligibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((w) => w.id)));
    }
  };

  // Subscribe to per-row progress events for the current run only.
  // Filter by requestId so a concurrent cleanup in another window
  // doesn't bleed into our state.
  useEffect(() => {
    if (runState.kind !== "running") return;
    const activeRequestId = runState.requestId;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<BulkCleanupProgress>(
          "bulk-cleanup-progress",
          (event) => {
            if (cancelled) return;
            const payload = event.payload;
            if (payload.requestId !== activeRequestId) return;
            setProgress((prev) => {
              const next = new Map(prev);
              next.set(payload.workspaceId, {
                status: payload.status,
                error: payload.error,
              });
              return next;
            });
            // Capture the friendly name from the event payload too —
            // some rows arrive after the Deleted hook has already
            // evicted them from the store, and the snapshot built
            // before dispatch may miss future-runs of the same
            // workspace if a later cleanup-all races with restore.
            if (payload.name) {
              runNamesRef.current.set(payload.workspaceId, payload.name);
            }
          },
        );
      } catch {
        // No event bridge → the live list won't update incrementally,
        // but the final result still resolves. The modal still works,
        // just without the per-row animation.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [runState]);

  const handleDelete = async () => {
    const ids = [...effectiveSelection];
    if (ids.length === 0) return;

    // Snapshot names + repos before dispatch so the live list keeps
    // labels even after the Deleted hook evicts rows from the store.
    runNamesRef.current = new Map(
      eligible.filter((w) => effectiveSelection.has(w.id)).map((w) => [w.id, w.name]),
    );
    runReposRef.current = new Map(
      repositories
        .filter((r) => ids.some((id) => workspaces.find((w) => w.id === id)?.repository_id === r.id))
        .map((r) => [r.id, r]),
    );
    runIdToRepoIdRef.current = new Map(
      ids.map((id) => [
        id,
        workspaces.find((w) => w.id === id)?.repository_id ?? "",
      ]),
    );

    const requestId = crypto.randomUUID();
    setRunState({ kind: "running", requestId, cancelling: false });
    setRunIds(ids);
    setProgress(new Map());
    setFailures(new Map());

    try {
      const result = await deleteWorkspacesBulk(ids, requestId);
      for (const id of result.deleted) {
        removeWorkspace(id);
      }
      const succeeded = result.deleted.length;
      const failed = result.failed.length;
      const skipped = result.cancelled.length;

      if (failed === 0 && skipped === 0) {
        addToast(
          t(
            succeeded === 1
              ? "bulk_cleanup_success_singular"
              : "bulk_cleanup_success_plural",
            { count: succeeded },
          ),
        );
        closeModal();
        return;
      }

      if (failed === 0 && skipped > 0) {
        // Pure cancel — the user got out cleanly, nothing failed.
        addToast(
          t("bulk_cleanup_cancelled_toast", {
            succeeded,
            cancelled: skipped,
          }),
        );
        closeModal();
        return;
      }

      // Partial failure (with or without cancellations).
      const failureMap = new Map<string, string>();
      for (const f of result.failed) failureMap.set(f.id, f.error);
      setFailures(failureMap);
      setSelected(new Set(result.failed.map((f) => f.id)));
      addToast(
        t("bulk_cleanup_partial", {
          succeeded,
          failed,
        }),
      );
    } catch (e) {
      addToast(
        t("bulk_cleanup_failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setRunState({ kind: "idle" });
      setRunIds([]);
    }
  };

  const handleCancel = useCallback(() => {
    if (runState.kind !== "running") return;
    setRunState({
      kind: "running",
      requestId: runState.requestId,
      cancelling: true,
    });
    // Fire-and-forget; cooperative cancel only signals, the in-flight
    // `deleteWorkspacesBulk` promise will resolve with the partial
    // result and the finally{} above will reset state.
    void cancelWorkspacesBulk(runState.requestId).catch(() => {
      // The backend may have already finished and unregistered the
      // flag — `false` return is fine, the promise rejecting is
      // unexpected but not actionable here.
    });
  }, [runState]);

  // Close-while-running implies cancel. Cancel doesn't immediately
  // close the modal (so the user sees the run finalize), but if they
  // click X / Escape / backdrop, we cancel AND close. The dispatched
  // promise still resolves in the background; its toast still fires
  // via the global `addToast` even after the modal unmounts.
  const handleClose = useCallback(() => {
    if (runState.kind === "running") {
      void cancelWorkspacesBulk(runState.requestId).catch(() => {});
    }
    closeModal();
  }, [runState, closeModal]);

  const isRunning = runState.kind === "running";
  const cancelling = isRunning && runState.cancelling;

  // Live counters from the progress map. During a run these replace
  // the static "selected" counter; after a run they're zero again.
  const counts = useMemo(() => {
    let deleted = 0;
    let failed = 0;
    let cancelled = 0;
    for (const entry of progress.values()) {
      if (entry.status === "deleted") deleted += 1;
      else if (entry.status === "failed") failed += 1;
      else if (entry.status === "cancelled") cancelled += 1;
    }
    return { deleted, failed, cancelled };
  }, [progress]);

  const repo =
    repoId && typeof repoId === "string"
      ? repositories.find((r) => r.id === repoId) ?? null
      : null;

  const title =
    repoId && typeof repoId === "string"
      ? t("bulk_cleanup_title", {
          repo: repo?.name ?? t("bulk_cleanup_title_fallback_repo"),
        })
      : t("bulk_cleanup_title_all");

  // What we render in the list depends on whether a run is in flight.
  // - Idle / no run: render `eligible`, optionally grouped by repo in
  //   cleanup-all mode.
  // - Running: render `runRows` (the dispatched snapshot), still
  //   grouped by repo in cleanup-all mode. Selection checkboxes are
  //   replaced with status icons.
  const renderingRun = isRunning || progress.size > 0;
  const rowsForRender = renderingRun ? runRows : eligible;
  const groupedForRender = useMemo(() => {
    if (repoId !== null) {
      return [{ repo: null as Repository | null, workspaces: rowsForRender }];
    }
    // Cleanup-all mode: group by repo. During a run, fall back to the
    // snapshotted repo map for any row whose store entry has been
    // evicted (so the header doesn't disappear before the last row of
    // a fully-deleted repo lands).
    const sourceRepos: Repository[] = repositories.filter((r) =>
      localRepoIds.has(r.id),
    );
    if (!renderingRun) {
      return groupByRepository(rowsForRender, sourceRepos).map(
        ({ repo: r, workspaces: ws }) => ({
          repo: r as Repository | null,
          workspaces: ws,
        }),
      );
    }
    // Run mode: rows are runRows in dispatch order; their live
    // `repository_id` may be empty for evicted placeholders. The
    // dispatch-time snapshot map is the source of truth.
    const byRepoId = new Map<string, Workspace[]>();
    for (const row of rowsForRender) {
      const repoIdForRow =
        row.repository_id || runIdToRepoIdRef.current.get(row.id) || "";
      const bucket = byRepoId.get(repoIdForRow);
      if (bucket) bucket.push(row);
      else byRepoId.set(repoIdForRow, [row]);
    }
    // Order groups by `sourceRepos` so the visual order stays stable
    // even as rows arrive in dispatch order (which may interleave
    // across repos).
    const out: { repo: Repository | null; workspaces: Workspace[] }[] = [];
    for (const r of sourceRepos) {
      const ws = byRepoId.get(r.id);
      if (ws && ws.length > 0) out.push({ repo: r, workspaces: ws });
    }
    return out;
  }, [rowsForRender, repoId, repositories, renderingRun, localRepoIds]);

  const totalForCounter = renderingRun ? runIds.length : eligible.length;

  // All hooks above run unconditionally; the render-time bail comes
  // here. The effect at the top has already scheduled `closeModal()`
  // for the next tick — this short-circuit just suppresses the
  // otherwise-visible flash of an empty modal on the way out.
  if (repoId === undefined) return null;

  return (
    <Modal title={title} onClose={handleClose} wide bodyScroll>
      <div className={shared.warning}>{t("bulk_cleanup_warning")}</div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>
          {t("bulk_cleanup_older_than")}
        </span>
        <div className={styles.filterChoices} role="radiogroup">
          {AGE_FILTERS.map((f) => (
            <label
              key={f.key}
              className={
                ageFilter === f.key
                  ? styles.filterChipActive
                  : styles.filterChip
              }
            >
              <input
                type="radio"
                name="bulk-cleanup-age"
                value={f.key}
                checked={ageFilter === f.key}
                disabled={isRunning}
                onChange={() => handleAgeFilterChange(f.key)}
                className={styles.filterRadio}
              />
              {t(`bulk_cleanup_filter_${f.key}`)}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.headerRow}>
        {renderingRun ? (
          // During a run, the select-all checkbox is meaningless — the
          // selection is locked. Show the live progress counter
          // instead so the user can read forward motion at a glance.
          <span className={styles.progressCounter}>
            {t("bulk_cleanup_live_counter", {
              deleted: counts.deleted,
              total: totalForCounter,
              failed: counts.failed,
            })}
          </span>
        ) : (
          <label className={styles.selectAllLabel}>
            <input
              type="checkbox"
              checked={allEligibleSelected}
              disabled={eligible.length === 0}
              onChange={toggleSelectAll}
            />
            <span>{t("bulk_cleanup_select_all")}</span>
          </label>
        )}
        {!renderingRun && (
          <span className={styles.counter}>
            {t("bulk_cleanup_counter", {
              selected: effectiveSelection.size,
              total: eligible.length,
            })}
          </span>
        )}
      </div>

      {rowsForRender.length === 0 ? (
        <div className={styles.empty}>{t("bulk_cleanup_no_eligible")}</div>
      ) : (
        groupedForRender.map((group, gi) => (
          <div key={group.repo?.id ?? `group-${gi}`}>
            {repoId === null && group.repo && (
              <div className={styles.repoHeader}>
                {group.repo.icon && (
                  <RepoIcon icon={group.repo.icon} size={11} />
                )}
                {group.repo.name}
              </div>
            )}
            <ul className={styles.repoSection}>
              {group.workspaces.map((ws) => {
                const rowProgress = progress.get(ws.id);
                const isSelected = effectiveSelection.has(ws.id);
                const err = failures.get(ws.id) ?? rowProgress?.error;
                const displayName =
                  ws.name || runNamesRef.current.get(ws.id) || ws.id;
                return (
                  <li key={ws.id} className={styles.row}>
                    <div
                      className={
                        renderingRun
                          ? styles.rowLabelRunning
                          : styles.rowLabel
                      }
                    >
                      {renderingRun ? (
                        <span className={styles.rowStatus}>
                          {rowProgress?.status === "deleted" ? (
                            <Check
                              size={12}
                              className={styles.rowStatusDeleted}
                              aria-label={t("bulk_cleanup_row_deleted")}
                            />
                          ) : rowProgress?.status === "failed" ? (
                            <X
                              size={12}
                              className={styles.rowStatusFailed}
                              aria-label={t("bulk_cleanup_row_failed")}
                            />
                          ) : rowProgress?.status === "cancelled" ? (
                            <MinusCircle
                              size={12}
                              className={styles.rowStatusCancelled}
                              aria-label={t("bulk_cleanup_row_cancelled")}
                            />
                          ) : (
                            <span
                              className={styles.spinner}
                              aria-label={t("bulk_cleanup_row_pending")}
                            />
                          )}
                        </span>
                      ) : null}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={renderingRun}
                        onChange={() => toggleRow(ws.id)}
                        aria-label={displayName}
                      />
                      <span className={styles.rowName}>{displayName}</span>
                      <span className={styles.rowBranch}>
                        {ws.branch_name && (
                          <>
                            <GitBranch size={11} aria-hidden="true" />
                            {ws.branch_name}
                          </>
                        )}
                      </span>
                      <span className={styles.rowAge}>
                        {ws.created_at &&
                          ageBucketLabel(ageBucket(ws.created_at, nowSecs))}
                      </span>
                    </div>
                    {err && <div className={styles.rowError}>{err}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      <div className={shared.actions}>
        <button
          className={shared.btn}
          onClick={isRunning ? handleCancel : handleClose}
          disabled={cancelling}
        >
          {cancelling ? t("bulk_cleanup_cancelling") : tCommon("cancel")}
        </button>
        <button
          className={shared.btnDanger}
          onClick={handleDelete}
          disabled={isRunning || effectiveSelection.size === 0}
        >
          {isRunning
            ? t("bulk_cleanup_deleting")
            : t("bulk_cleanup_confirm", { count: effectiveSelection.size })}
        </button>
      </div>
    </Modal>
  );
}
