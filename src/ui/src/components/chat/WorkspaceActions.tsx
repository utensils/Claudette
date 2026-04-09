import { openWorkspaceInTerminal } from "../../services/tauri";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HeaderMenu } from "./HeaderMenu";

interface WorkspaceActionsProps {
  worktreePath: string | null;
  disabled?: boolean;
}

const ITEMS = [
  { value: "open-terminal", label: "Open in Terminal" },
  { value: "copy-path", label: "Copy Path" },
];

export function WorkspaceActions({
  worktreePath,
  disabled = false,
}: WorkspaceActionsProps) {
  const handleSelect = async (action: string) => {
    if (!worktreePath) return;

    switch (action) {
      case "open-terminal":
        try {
          await openWorkspaceInTerminal(worktreePath);
        } catch (err) {
          console.error("Failed to open terminal:", err);
        }
        break;
      case "copy-path":
        try {
          await writeText(worktreePath);
        } catch (err) {
          console.error("Failed to copy path:", err);
        }
        break;
    }
  };

  return (
    <HeaderMenu
      label="Actions"
      items={ITEMS}
      disabled={disabled || !worktreePath}
      title="Workspace actions"
      onSelect={handleSelect}
    />
  );
}
