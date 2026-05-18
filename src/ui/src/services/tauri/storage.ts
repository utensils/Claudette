import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceStorageEntry {
  id: string;
  name: string;
  status: "Active" | "Archived";
  worktree_path: string | null;
  size_bytes: number | null;
}

export interface RepoStorageStats {
  repository_id: string;
  active_bytes: number;
  archived_bytes: number;
  total_bytes: number;
  workspaces: WorkspaceStorageEntry[];
}

export interface RogueWorktree {
  path: string;
  size_bytes: number;
  inferred_repo_slug: string;
  inferred_repo_name: string | null;
}

export function computeStorageStats(): Promise<RepoStorageStats[]> {
  return invoke("compute_storage_stats");
}

export function scanRogueWorktrees(): Promise<RogueWorktree[]> {
  return invoke("scan_rogue_worktrees");
}

export function purgeRogueWorktree(path: string): Promise<void> {
  return invoke("purge_rogue_worktree", { path });
}
