import { useAppStore } from "../../stores/useAppStore";

/**
 * Apply the global `default_plan_mode` to a workspace only if the store has no
 * runtime value for that workspace yet. A remount mid-flow (workspace swap,
 * remote reconnect, HMR) must not clobber an agent-driven clear of plan mode.
 */
export function applyPlanModeMountDefault(
  workspaceId: string,
  defaultValue: boolean,
): void {
  const store = useAppStore.getState();
  if (store.planMode[workspaceId] === undefined) {
    store.setPlanMode(workspaceId, defaultValue);
  }
}
