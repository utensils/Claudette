import { memo } from "react";
import { useTaskTracker } from "../../hooks/useTaskTracker";
import { useAppStore } from "../../stores/useAppStore";
import styles from "./TaskProgressBadge.module.css";

/**
 * Compact inline badge showing task progress. Clicking opens
 * the right sidebar's Tasks tab.
 */
export const TaskProgressBadge = memo(function TaskProgressBadge({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { totalCount, completedCount } = useTaskTracker(workspaceId);
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab);
  const rightSidebarVisible = useAppStore((s) => s.rightSidebarVisible);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);

  if (totalCount === 0) return null;

  const allDone = completedCount === totalCount;

  const handleClick = () => {
    setRightSidebarTab("tasks");
    if (!rightSidebarVisible) {
      toggleRightSidebar();
    }
  };

  return (
    <button
      className={`${styles.badge} ${allDone ? styles.allDone : ""}`}
      onClick={handleClick}
      title="View tasks in sidebar"
    >
      <span className={styles.icon}>{allDone ? "●" : "◐"}</span>
      <span className={styles.label}>
        {completedCount}/{totalCount} tasks
      </span>
    </button>
  );
});
