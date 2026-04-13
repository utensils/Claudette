// MCP (Model Context Protocol) server configuration types
// These match the Rust types in src/mcp.rs

export type McpScope = 'user' | 'project' | 'local';

export interface McpServer {
  name: string;
  config: McpServerConfig;
  scope: McpScope;
}

export type McpServerConfig =
  | McpServerConfigStdio
  | McpServerConfigHttp
  | McpServerConfigSse;

export interface McpServerConfigStdio {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerConfigHttp {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  oauth?: OAuthConfig;
}

export interface McpServerConfigSse {
  type: 'sse';
  url: string;
}

export interface OAuthConfig {
  authServerMetadataUrl?: string;
}
