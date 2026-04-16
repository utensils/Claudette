import { useAppStore } from "../../stores/useAppStore";

const PLAN_PATH_RE = /(\/[^\s)"`]+\/\.claude\/plans\/[^\s)"`]+\.md)/;

/**
 * Locate the most recent plan file path for the given workspace by scanning
 * the current in-memory state — chat messages first (newest-first), then the
 * active streaming buffer, then tool-activity input/result text, then the
 * pending plan approval's `planFilePath`.
 *
 * Returns `null` if no `.claude/plans/*.md` path has been emitted yet.
 *
 * Used by `/plan open` so that the command keeps working after the user has
 * already approved or denied the plan approval card (which clears the
 * pending approval but leaves the plan file itself on disk).
 */
export function findLatestPlanFilePath(workspaceId: string): string | null {
  const state = useAppStore.getState();

  const messages = state.chatMessages[workspaceId] ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i].content.match(PLAN_PATH_RE);
    if (match) return match[1];
  }

  const streaming = state.streamingContent[workspaceId] ?? "";
  const streamingMatch = streaming.match(PLAN_PATH_RE);
  if (streamingMatch) return streamingMatch[1];

  const activities = state.toolActivities[workspaceId] ?? [];
  for (const activity of activities) {
    const match = (activity.inputJson + activity.resultText).match(
      PLAN_PATH_RE,
    );
    if (match) return match[1];
  }

  return state.planApprovals[workspaceId]?.planFilePath ?? null;
}
