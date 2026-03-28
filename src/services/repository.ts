import { invoke } from "@tauri-apps/api/core";
import type { Repository } from "../types/repository";

export async function addRepository(path: string): Promise<Repository> {
  return invoke<Repository>("add_repository", { path });
}

export async function listRepositories(): Promise<Repository[]> {
  return invoke<Repository[]>("list_repositories");
}

export async function getRepository(id: string): Promise<Repository> {
  return invoke<Repository>("get_repository", { id });
}

export async function removeRepository(id: string): Promise<void> {
  return invoke<void>("remove_repository", { id });
}
