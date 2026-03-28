export interface Workspace {
  id: string;
  repository_id: string;
  name: string;
  branch: string;
  worktree_path: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  repository_id: string;
  name: string;
  branch: string;
  base_branch?: string;
}
