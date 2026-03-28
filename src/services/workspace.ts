import { invoke } from "@tauri-apps/api/core";
import type { Workspace, CreateWorkspaceRequest } from "../types/workspace";

export async function createWorkspace(
  request: CreateWorkspaceRequest
): Promise<Workspace> {
  return invoke<Workspace>("create_workspace", { request });
}

export async function listWorkspaces(
  repositoryId: string
): Promise<Workspace[]> {
  return invoke<Workspace[]>("list_workspaces", { repositoryId });
}

export async function listAllWorkspaces(): Promise<Workspace[]> {
  return invoke<Workspace[]>("list_all_workspaces");
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>("get_workspace", { id });
}

export async function archiveWorkspace(id: string): Promise<void> {
  return invoke<void>("archive_workspace", { id });
}
