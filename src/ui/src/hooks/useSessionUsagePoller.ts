import { useEffect, useRef } from "react";

import type { AgentBackendConfig } from "../services/tauri/agentBackends";
import { getSessionUsage } from "../services/tauri";
import { useAppStore } from "../stores/useAppStore";
import type { UsageSnapshot } from "../types/usage";
import type { UsageIndicatorMode } from "../components/chat/composer/usageIndicatorMode";

interface SessionUsagePollerArgs {
  workspaceId: string | null;
  sessionId: string | null;
  backend: AgentBackendConfig | null;
  mode: UsageIndicatorMode;
  usageInsightsEnabled: boolean;
}

const REFRESH_INTERVAL_MS = 5 * 60_000; // 5 minutes — fallback cadence

/**
 * Drive the unified `get_session_usage` snapshot for the active chat
 * session. No-ops while the indicator is hidden (`mode === "hidden"`)
 * so unsupported backends never touch the SQL aggregate or the
 * Anthropic OAuth path.
 *
 * Refresh signals:
 *  - immediate fetch on session / backend / mode change
 *  - re-fetch after each completed turn (so a Codex/OpenAI/Pi user
 *    doesn't sit at an empty meter for up to 5 min after their first
 *    response lands)
 *  - 5-min interval while the window is focused
 *  - paused on blur, resumed on focus (catching up if the interval
 *    elapsed during blur)
 *
 * Each `(workspaceId, sessionId)` switch evicts the prior session's
 * snapshot so the popover never flashes stale data from a sibling
 * tab — both on switch and on unmount.
 *
 * When `mode === "disabled"` (Claude-family backend with the experimental
 * Claude Code Usage flag off), we write a local stub snapshot into the
 * store instead of leaving any prior active snapshot in place. The
 * popover then reflects the disabled state correctly.
 */
export function useSessionUsagePoller({
  workspaceId,
  sessionId,
  backend,
  mode,
  usageInsightsEnabled,
}: SessionUsagePollerArgs) {
  const setSessionUsage = useAppStore((s) => s.setSessionUsage);
  const clearSessionUsage = useAppStore((s) => s.clearSessionUsage);
  // Turn-completion signal: when the count for this session changes, an
  // assistant turn landed and the chat_messages aggregate is stale.
  const completedTurnCount = useAppStore((s) =>
    sessionId ? (s.completedTurns[sessionId]?.length ?? 0) : 0,
  );
  const streamingTokenCount = useAppStore((s) =>
    sessionId ? (s.streamingContent[sessionId]?.length ?? 0) : 0,
  );

  // Track the previous (workspaceId, sessionId) so each switch can
  // evict its predecessor's snapshot. Using a ref (not state) so we
  // don't trigger an extra render — only the actual store mutation
  // does.
  const prevSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    if (mode === "hidden" || !workspaceId || !backend) {
      // Indicator isn't rendering — drop any prior snapshot for this
      // session so a later flip to "active" starts clean.
      clearSessionUsage(sessionId);
      return;
    }

    if (mode === "disabled") {
      // Claude-family backend, experimental flag off. Surface the
      // disabled stub so the popover reflects "off" rather than
      // showing a stale active snapshot from before the user toggled
      // the flag (or from when the session was on a different
      // backend).
      const stub: UsageSnapshot = {
        provider_kind: backend.kind,
        source_label: "Claude Code Usage off",
        buckets: [],
        note: "Enable Claude Code Usage in Settings → Experimental to surface subscription limits.",
        fetched_at_ms: Date.now(),
        experimental_disabled: true,
      };
      setSessionUsage(sessionId, stub);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastFetchAt = 0;
    let inFlight: Promise<void> | null = null;

    const fetchOnce = (): Promise<void> => {
      if (inFlight !== null) return inFlight;
      inFlight = (async () => {
        try {
          const snapshot = await getSessionUsage({
            workspaceId,
            chatSessionId: sessionId,
            backend,
            usageInsightsEnabled,
          });
          if (cancelled) return;
          setSessionUsage(sessionId, snapshot);
          lastFetchAt = Date.now();
        } catch {
          // Settings UI surfaces auth/error states for the gated path;
          // the indicator stays empty until the next poll cycle.
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const stop = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleNext = (delay: number) => {
      if (timeoutId !== null) return;
      timeoutId = setTimeout(async () => {
        timeoutId = null;
        if (cancelled) return;
        if (!document.hasFocus()) return;
        await fetchOnce();
        if (cancelled) return;
        scheduleNext(REFRESH_INTERVAL_MS);
      }, delay);
    };

    const start = () => {
      if (timeoutId !== null) return;
      const elapsed = Date.now() - lastFetchAt;
      if (lastFetchAt === 0 || elapsed >= REFRESH_INTERVAL_MS) {
        void fetchOnce().then(() => {
          if (!cancelled) scheduleNext(REFRESH_INTERVAL_MS);
        });
      } else {
        scheduleNext(REFRESH_INTERVAL_MS - elapsed);
      }
    };

    const handleFocus = () => {
      if (cancelled) return;
      start();
    };
    const handleBlur = () => {
      stop();
    };

    if (document.hasFocus()) start();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
    // `completedTurnCount` is intentionally in the deps so the effect
    // re-runs (and immediately fetches) whenever a new assistant turn
    // lands for the active session. `streamingTokenCount` covers the
    // initial-streaming case where a turn isn't yet committed to
    // `completedTurns` but the meter is already changing.
  }, [
    workspaceId,
    sessionId,
    backend,
    mode,
    usageInsightsEnabled,
    completedTurnCount,
    streamingTokenCount,
    setSessionUsage,
    clearSessionUsage,
  ]);

  // Cross-effect eviction: when the active session id changes, drop the
  // previous session's snapshot from the store so the popover for a
  // freshly-switched tab can't briefly render the prior session's data.
  // The unmount cleanup below handles tab close.
  useEffect(() => {
    const prev = prevSessionRef.current;
    if (prev && prev !== sessionId) {
      clearSessionUsage(prev);
    }
    prevSessionRef.current = sessionId;
  }, [sessionId, clearSessionUsage]);

  useEffect(() => {
    // Drop the snapshot on full unmount so a remount (HMR, route
    // change, workspace teardown) starts with no stale data.
    return () => {
      const prev = prevSessionRef.current;
      if (prev) clearSessionUsage(prev);
    };
  }, [clearSessionUsage]);
}
