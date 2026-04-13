import { invoke } from '@tauri-apps/api/core';
import type { McpServer } from '../types/mcp';

/**
 * Detect all MCP servers configured for a repository
 * Reads from user (~/.claude.json), project (.mcp.json), and local (.claude.json) scopes
 */
export async function detectMcpServers(repoId: string): Promise<McpServer[]> {
  return invoke<McpServer[]>('detect_mcp_servers', { repoId });
}

/**
 * Write selected MCP servers to workspace .claude.json
 */
export async function configureWorkspaceMcps(
  workspaceId: string,
  servers: McpServer[]
): Promise<void> {
  return invoke('configure_workspace_mcps', { workspaceId, servers });
}

/**
 * Read MCP configuration from workspace .claude.json
 */
export async function readWorkspaceMcps(workspaceId: string): Promise<McpServer[]> {
  return invoke<McpServer[]>('read_workspace_mcps', { workspaceId });
}
