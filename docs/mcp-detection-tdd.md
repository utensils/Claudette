# Technical Design: MCP Configuration Detection and Repository Integration

**Status**: Draft
**Date**: 2026-04-13
**Issue**: [#170](https://github.com/utensils/Claudette/issues/170)
**Supersedes**: Previous TDD (workspace-centric, file-based approach)
**Author**: Claude Code

## Problem Statement

Claudette creates workspaces as git worktrees in a separate directory from the original repository. When Claude CLI runs inside a worktree, it automatically discovers:

- **`~/.claude.json`** (user scope) — global MCPs, always available
- **`.mcp.json`** (project scope) — committed to git, checked out in worktrees automatically

However, two categories of MCP configuration are **not** available inside worktrees:

1. **Project-scoped MCPs in `~/.claude.json`** — Claude Code stores per-project MCPs keyed by absolute path (e.g., `~/.claude.json` → `projects["/home/user/my-repo"].mcpServers`). Worktrees live at a different path, so these don't match.
2. **Gitignored repo-level configs** — Files like `.claude.json` at the repo root (typically gitignored) contain local MCP overrides that are never checked out in worktrees.

Users need a way to carry these "invisible" MCP configurations into their Claudette workspaces. The previous approach (writing `.claude.json` files into worktrees) was rejected because it created file management complexity and diverged from the user's actual configuration. The correct approach is to:

1. Detect these non-portable MCP configs when a repository is added
2. Let the user select which ones to enable
3. Store selections in the database
4. Inject them at agent spawn time via Claude CLI's `--mcp-config` flag

## User Stories

### US1: Select MCP Servers When Adding a Repository
**As a** Claudette user adding a new repository
**I want to** see which MCP servers are configured for this project (outside the repo itself) and select which ones to carry into workspaces
**So that** my Claude agents in worktrees have the same MCP tools I use when working in the original repo

**Acceptance Criteria:**
- [ ] After adding a repo, display detected non-portable MCP servers
- [ ] Show server name, transport type (stdio/http/sse), and source location
- [ ] Allow selecting/deselecting individual servers
- [ ] Allow skipping MCP selection entirely
- [ ] Selected configs are persisted to the database

### US2: MCP Servers Injected at Agent Spawn Time
**As a** Claudette user chatting with an agent in a workspace
**I want** the agent to automatically have access to the MCP servers I selected for this repository
**So that** I don't have to manually configure MCP servers for each workspace

**Acceptance Criteria:**
- [ ] Selected MCP configs are passed via `--mcp-config` when spawning `claude`
- [ ] MCP injection only happens on the first turn (session-level flag)
- [ ] Agents can use the injected MCP tools (verified by `claude mcp list`)
- [ ] No `.claude.json` files are written to worktrees

### US3: Manage MCP Configuration for Existing Repository
**As a** Claudette user with an existing repository
**I want to** view and modify the MCP server selections in repository settings
**So that** I can update MCP access as my configuration changes over time

**Acceptance Criteria:**
- [ ] Repository settings UI shows current MCP selections
- [ ] User can re-detect available MCPs (refresh)
- [ ] User can add/remove MCP servers from the selection
- [ ] Changes apply to new agent sessions (not mid-session)

## Background Research

### Claude CLI `--mcp-config` Flag

```
--mcp-config <configs...>    Load MCP servers from JSON files or strings (space-separated)
--strict-mcp-config          Only use MCP servers from --mcp-config, ignoring all other sources
```

The flag accepts one or more arguments, each of which can be:
- A **file path** to a JSON file containing an `mcpServers` object
- An **inline JSON string** containing an `mcpServers` object

**JSON format:**
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {}
    }
  }
}
```

**Important**: `--mcp-config` is additive — it loads servers alongside any auto-detected configs. The `--strict-mcp-config` variant restricts to only the provided configs. We should use the non-strict version so that `.mcp.json` (committed) and user-global MCPs still work normally.

### Where Non-Portable MCPs Live

#### 1. User-level project-scoped MCPs (`~/.claude.json`)

Claude Code stores per-project MCP configurations in a nested structure:

```json
{
  "projects": {
    "/absolute/path/to/repo": {
      "mcpServers": {
        "my-server": { "command": "...", "args": [] }
      }
    }
  }
}
```

These are keyed by the **absolute path to the repository root**. When Claude CLI runs in a worktree at a different path (e.g., `~/.claudette/worktrees/my-repo/feature-branch/`), it won't find these project-scoped MCPs because the path doesn't match.

#### 2. Gitignored repo-level config (`.claude.json` at repo root)

The file `{repo}/.claude.json` is typically listed in `.gitignore` (Claude Code's own convention). It may contain:

```json
{
  "mcpServers": {
    "local-server": { "type": "stdio", "command": "..." }
  }
}
```

Since it's gitignored, it is **never** checked out in worktrees.

#### What We Do NOT Need to Detect

- **`.mcp.json`** (project root) — committed to git, auto-available in worktrees
- **Global user MCPs** (non-project-specific entries in `~/.claude.json`) — Claude CLI reads these regardless of working directory
- **Plugin MCPs** (`~/.claude/plugins/`) — managed by Claude Code's plugin system, always available

### Current Claudette Architecture

**Repository addition** (`add_repository` command):
- Validates git repo, canonicalizes path, inserts to DB
- No MCP awareness currently

**Agent spawning** (`send_chat_message` → `agent::run_turn`):
- Sets `working_dir` to worktree path
- Builds CLI args via `build_claude_args()`
- `AgentSettings` struct controls session-level flags (model, chrome, etc.)
- No `--mcp-config` support currently

**Database**: SQLite, migration version 14. No MCP tables.

## Requirements

### Functional Requirements

#### FR1: MCP Detection
- **FR1.1**: Detect project-scoped MCPs from `~/.claude.json` (nested `projects[repo_path].mcpServers`)
- **FR1.2**: Detect MCPs from `{repo}/.claude.json` only when the file is explicitly gitignored (via `git check-ignore`)
- **FR1.3**: Parse all three transport types: stdio, http, sse
- **FR1.4**: Handle missing or malformed config files gracefully (return empty, not error)
- **FR1.5**: Do NOT scan `.mcp.json` or global (non-project) user MCPs (these are auto-available)

#### FR2: MCP Selection UI
- **FR2.1**: Show MCP selection modal after adding a repository
- **FR2.2**: Display server name, transport type, and source for each detected server
- **FR2.3**: Default all detected servers to selected (opt-out, not opt-in)
- **FR2.4**: Allow skipping MCP selection entirely
- **FR2.5**: Show MCP management in repository settings for existing repos

#### FR3: Database Storage
- **FR3.1**: Store selected MCP server configurations in a new `repository_mcp_servers` table
- **FR3.2**: Each row stores one MCP server: name, config JSON, source label
- **FR3.3**: Support add/remove operations for individual servers
- **FR3.4**: Cascade delete when repository is removed

#### FR4: Agent Spawn Injection
- **FR4.1**: On first turn, load selected MCPs from database for the workspace's repository
- **FR4.2**: Serialize selected MCPs as JSON and pass via `--mcp-config` flag
- **FR4.3**: Use additive mode (not `--strict-mcp-config`) so auto-detected MCPs still work
- **FR4.4**: Only inject on first turn (session-level — subsequent `--resume` turns inherit)

### Non-Functional Requirements

#### NFR1: Performance
- **NFR1.1**: MCP detection should complete in < 200ms
- **NFR1.2**: MCP injection should add < 10ms to agent spawn time (just a DB read + arg append)

#### NFR2: Security
- **NFR2.1**: Mask sensitive values (API keys, tokens) in the selection UI
- **NFR2.2**: Store config JSON as-is in DB (including `${VAR}` syntax) — don't resolve env vars
- **NFR2.3**: Validate JSON structure before storing to prevent injection

#### NFR3: Compatibility
- **NFR3.1**: Generated `--mcp-config` JSON must be readable by Claude CLI
- **NFR3.2**: Do not modify source files (`~/.claude.json`, repo `.claude.json`)
- **NFR3.3**: Gracefully handle repos with no detectable non-portable MCPs (skip modal)

## Architecture

### Design Principles

1. **Detect, Don't Duplicate**: Scan source files read-only; store selections in DB, inject at runtime
2. **Repository-Scoped**: MCP selections belong to the repository, not individual workspaces — all workspaces in a repo share the same MCP config
3. **Additive Injection**: Use `--mcp-config` (not `--strict-mcp-config`) so committed `.mcp.json` and global MCPs still work
4. **Database as Source of Truth**: Selected MCPs live in SQLite, not in worktree files
5. **Opt-Out Default**: Pre-select all detected MCPs — users remove what they don't want

### Data Flow

```
┌───────────────────────┐
│  User Adds Repository │
└──────────┬────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Detect Non-Portable MCPs        │
│  1. ~/.claude.json projects[path]│
│  2. {repo}/.claude.json (if      │
│     gitignored)                  │
└──────────┬───────────────────────┘
           │
           ▼
      ┌────┴──────────┐
      │  Any MCPs     │
      │  detected?    │
      └────┬──────┬───┘
           │      │
         Yes      No
           │      │
           ▼      └──► (skip modal, done)
┌─────────────────────┐
│  MCP Selection Modal │
│  (pre-selected,      │
│   user can deselect) │
└──────────┬──────────┘
           │
      ┌────┴──────────┐
      │  User saves   │
      │  or skips     │
      └────┬──────┬───┘
           │      │
         Save    Skip
           │      │
           ▼      └──► (done, no MCPs stored)
┌──────────────────────┐
│  Store in DB          │
│  repository_mcp_      │
│  servers table        │
└──────────────────────┘
           ·
           · (later, when agent runs)
           ·
┌──────────────────────┐
│  send_chat_message    │
│  (first turn)         │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Load MCPs from DB for repo      │
│  Serialize as JSON               │
│  Append --mcp-config <json>      │
│  to build_claude_args()          │
└──────────────────────────────────┘
```

### Component Design

#### Backend Components

##### 1. MCP Detection Module (`src/mcp.rs`)

**Purpose**: Detect non-portable MCP configurations for a given repository path.

```rust
use std::path::Path;
use serde::{Deserialize, Serialize};

/// A detected MCP server with its full configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    /// Server name (key in the mcpServers object).
    pub name: String,
    /// Full server configuration (passed through to --mcp-config).
    pub config: serde_json::Value,
    /// Human-readable label for where this config was found.
    pub source: McpSource,
}

/// Where the MCP server configuration was detected from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSource {
    /// Project-scoped entry in ~/.claude.json
    UserProjectConfig,
    /// Gitignored .claude.json at repo root
    RepoLocalConfig,
}

/// Detect non-portable MCP servers for the given repository path.
///
/// Scans two locations:
/// 1. `~/.claude.json` → `projects[repo_path].mcpServers`
/// 2. `{repo_path}/.claude.json` (only if gitignored / not tracked)
///
/// Returns an empty Vec if no non-portable MCPs are found.
pub fn detect_mcp_servers(repo_path: &Path) -> Vec<McpServer> {
    let mut servers = Vec::new();

    // 1. Check ~/.claude.json for project-scoped MCPs
    if let Some(user_servers) = detect_user_project_mcps(repo_path) {
        servers.extend(user_servers);
    }

    // 2. Check {repo}/.claude.json (only if gitignored)
    if let Some(local_servers) = detect_repo_local_mcps(repo_path) {
        servers.extend(local_servers);
    }

    servers
}

/// Parse project-scoped MCPs from ~/.claude.json.
///
/// Claude Code stores per-project configs at:
///   projects["/absolute/path/to/repo"].mcpServers
fn detect_user_project_mcps(repo_path: &Path) -> Option<Vec<McpServer>> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".claude.json");
    let content = std::fs::read_to_string(&config_path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&content).ok()?;

    let repo_key = repo_path.to_string_lossy();
    let mcp_servers = root
        .get("projects")?
        .get(repo_key.as_ref())?
        .get("mcpServers")?
        .as_object()?;

    let servers = mcp_servers
        .iter()
        .map(|(name, config)| McpServer {
            name: name.clone(),
            config: config.clone(),
            source: McpSource::UserProjectConfig,
        })
        .collect();

    Some(servers)
}

/// Parse MCPs from {repo}/.claude.json, but only if it's gitignored.
fn detect_repo_local_mcps(repo_path: &Path) -> Option<Vec<McpServer>> {
    let config_path = repo_path.join(".claude.json");
    if !config_path.exists() {
        return None;
    }

    // Only include if the file is explicitly gitignored.
    // A newly created but not-yet-ignored .claude.json should NOT be picked
    // up — it may be an accidental file the user hasn't committed or ignored.
    if !is_gitignored(repo_path, ".claude.json") {
        return None;
    }

    let content = std::fs::read_to_string(&config_path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&content).ok()?;
    let mcp_servers = root.get("mcpServers")?.as_object()?;

    let servers = mcp_servers
        .iter()
        .map(|(name, config)| McpServer {
            name: name.clone(),
            config: config.clone(),
            source: McpSource::RepoLocalConfig,
        })
        .collect();

    Some(servers)
}

/// Check if a file is explicitly gitignored (returns true if ignored).
///
/// Uses `git check-ignore -q` which exits 0 if the file matches a gitignore
/// rule. This is stricter than checking "not tracked" — an untracked file
/// that isn't in any .gitignore will return false.
fn is_gitignored(repo_path: &Path, file: &str) -> bool {
    std::process::Command::new("git")
        .args(["check-ignore", "-q", file])
        .current_dir(repo_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Serialize selected MCP servers into the JSON format expected by
/// `--mcp-config`. Returns a JSON string like:
///
/// ```json
/// {"mcpServers":{"name":{"type":"stdio","command":"..."}}}
/// ```
pub fn serialize_for_cli(servers: &[McpServer]) -> String {
    let mut mcp_servers = serde_json::Map::new();
    for server in servers {
        mcp_servers.insert(server.name.clone(), server.config.clone());
    }
    let wrapper = serde_json::json!({ "mcpServers": mcp_servers });
    wrapper.to_string()
}
```

##### 2. Database Schema (migration v15)

```sql
-- Migration 15: MCP server storage per repository
CREATE TABLE repository_mcp_servers (
    id              TEXT PRIMARY KEY,
    repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    config_json     TEXT NOT NULL,
    source          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repository_id, name)
);

PRAGMA user_version = 15;
```

**Database functions** (in `src/db.rs`):

```rust
/// Row type returned by DB queries and accepted by bulk replace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryMcpServer {
    pub id: String,
    pub repository_id: String,
    pub name: String,
    pub config_json: String,
    pub source: String,
    pub created_at: String,
}

/// Insert a selected MCP server for a repository.
pub fn insert_repository_mcp_server(
    &self,
    server: &RepositoryMcpServer,
) -> Result<(), rusqlite::Error>

/// List all selected MCP servers for a repository.
pub fn list_repository_mcp_servers(
    &self,
    repository_id: &str,
) -> Result<Vec<RepositoryMcpServer>, rusqlite::Error>

/// Delete a single MCP server by ID.
pub fn delete_repository_mcp_server(
    &self,
    id: &str,
) -> Result<(), rusqlite::Error>

/// Replace all MCP servers for a repository (delete + re-insert in a
/// transaction).
pub fn replace_repository_mcp_servers(
    &self,
    repository_id: &str,
    servers: &[RepositoryMcpServer],
) -> Result<(), rusqlite::Error>
```

##### 3. Tauri Commands (`src-tauri/src/commands/mcp.rs`)

```rust
/// Detect non-portable MCP servers for a repository.
/// Called by the frontend after adding a repo or from repo settings.
#[tauri::command]
pub async fn detect_mcp_servers(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<McpServer>, String>

/// Save selected MCP servers for a repository (replaces any existing).
#[tauri::command]
pub async fn save_repository_mcps(
    repo_id: String,
    servers: Vec<McpServer>,
    state: State<'_, AppState>,
) -> Result<(), String>

/// Load saved MCP servers for a repository.
/// Returns the DB row type (includes id, created_at) so the frontend
/// can reference individual rows for delete operations.
#[tauri::command]
pub async fn load_repository_mcps(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepositoryMcpServer>, String>

/// Delete a single MCP server from a repository's saved config.
#[tauri::command]
pub async fn delete_repository_mcp(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<(), String>
```

##### 4. Agent Spawn Integration (`src/agent.rs`)

Add an `mcp_config` field to `AgentSettings`:

```rust
pub struct AgentSettings {
    pub model: Option<String>,
    pub fast_mode: bool,
    pub thinking_enabled: bool,
    pub plan_mode: bool,
    pub effort: Option<String>,
    pub chrome_enabled: bool,
    /// MCP config JSON string for --mcp-config. Session-level: only applied
    /// on the first turn.
    pub mcp_config: Option<String>,
}
```

In `build_claude_args()`, add after the chrome flag block:

```rust
// MCP config is session-level — only inject on the first turn.
// Resumed sessions inherit MCP servers from the initial turn.
if !is_resume && let Some(ref mcp_json) = settings.mcp_config {
    args.push("--mcp-config".to_string());
    args.push(mcp_json.clone());
}
```

In `send_chat_message` (chat command), load MCPs from DB:

```rust
// Load repository MCP configs for injection on first turn.
let mcp_config = if !is_resume {
    let db_rows = db.list_repository_mcp_servers(&ws.repository_id)
        .unwrap_or_default();
    if db_rows.is_empty() {
        None
    } else {
        // Convert DB rows (config_json: String) to McpServer (config: Value)
        let mcp_servers: Vec<claudette::mcp::McpServer> = db_rows
            .iter()
            .filter_map(|row| {
                let config = serde_json::from_str(&row.config_json).ok()?;
                Some(claudette::mcp::McpServer {
                    name: row.name.clone(),
                    config,
                    source: claudette::mcp::McpSource::UserProjectConfig, // source doesn't matter for serialization
                })
            })
            .collect();
        if mcp_servers.is_empty() {
            None
        } else {
            Some(claudette::mcp::serialize_for_cli(&mcp_servers))
        }
    }
} else {
    None
};

let agent_settings = AgentSettings {
    model: if !is_resume { model } else { None },
    fast_mode: fast_mode.unwrap_or(false),
    thinking_enabled: thinking_enabled.unwrap_or(false),
    plan_mode: plan_mode.unwrap_or(false),
    effort,
    chrome_enabled: chrome_enabled.unwrap_or(false),
    mcp_config,
};
```

#### Frontend Components

##### 1. MCP Selection Modal (`src/ui/src/components/modals/McpSelectionModal.tsx`)

**Purpose**: Display detected non-portable MCP servers after adding a repository.

**Trigger**: Opened by `AddRepoModal` after successful `add_repository()`, but only if detection finds servers.

**UI Layout**:
```
┌─────────────────────────────────────────────────┐
│ MCP Servers Detected                            │
├─────────────────────────────────────────────────┤
│                                                 │
│ These MCP servers are configured for this       │
│ project but won't be automatically available    │
│ in workspaces. Select which to include:         │
│                                                 │
│ ☑ github (http)                     ~/.claude…  │
│   url: https://api.githubcopilot.com/mcp/       │
│                                                 │
│ ☑ my-db (stdio)                     .claude.…   │
│   command: docker exec postgres-mcp             │
│                                                 │
│ ☐ legacy-tool (sse)                 ~/.claude…  │
│   url: https://old.example.com/sse              │
│                                                 │
│               [Skip]  [Save Selections]         │
└─────────────────────────────────────────────────┘
```

**Behavior**:
- Calls `detect_mcp_servers(repoId)` on mount
- Shows loading spinner during detection
- If no servers detected, closes automatically (nothing to show)
- All servers pre-selected by default
- "Skip" closes without saving anything
- "Save Selections" calls `save_repository_mcps(repoId, selectedServers)`

##### 2. Repository Settings: MCP Tab

**Purpose**: View and manage saved MCP selections for an existing repository.

**Location**: New section in the existing repository settings modal.

**Features**:
- List currently saved MCP servers
- "Re-detect" button to scan again and show new/changed servers
- Remove individual servers
- Shows source label (user project config / repo local config)

##### 3. Frontend Services (`src/ui/src/services/mcp.ts`)

```typescript
export interface McpServer {
  name: string;
  config: Record<string, unknown>;
  source: 'user_project_config' | 'repo_local_config';
}

export interface SavedMcpServer extends McpServer {
  id: string;
  repository_id: string;
  created_at: string;
}

export async function detectMcpServers(repoId: string): Promise<McpServer[]>;
export async function saveRepositoryMcps(repoId: string, servers: McpServer[]): Promise<void>;
export async function loadRepositoryMcps(repoId: string): Promise<SavedMcpServer[]>;
export async function deleteRepositoryMcp(serverId: string): Promise<void>;
```

### Alternative Approaches Considered

#### Alternative 1: Write `.claude.json` to Worktrees (Previous TDD)

**Approach**: Detect all MCPs, write selected ones to `{worktree}/.claude.json`.

**Why Rejected**:
- Creates file management complexity (merge existing content, handle conflicts)
- Duplicates configuration (source files + worktree copies can diverge)
- Triggers at workspace creation time (wrong granularity — MCPs are repo-level, not workspace-level)
- Risk of orphaned `.claude.json` files if workspace creation fails
- `.claude.json` in worktrees can interfere with Claude CLI's own config detection

#### Alternative 2: Symlink Repo `.claude.json` into Worktrees

**Approach**: Create symlink from `{worktree}/.claude.json` → `{repo}/.claude.json`.

**Why Rejected**:
- Only solves the gitignored repo config problem, not user project MCPs
- Symlinks can cause unexpected behavior with Claude CLI
- Doesn't allow per-repo customization of which MCPs to include

#### Alternative 3: Use `--strict-mcp-config` for Full Control

**Approach**: Use `--strict-mcp-config` to ignore all auto-detected MCPs, providing the full set explicitly.

**Why Rejected**:
- Would require detecting AND injecting `.mcp.json` contents (which are already auto-available)
- Would require detecting global user MCPs (also already auto-available)
- Much more config to maintain; higher chance of divergence from user's actual setup
- Breaks the principle of minimal intervention

## Implementation Plan

### Phase 1: Detection + Storage (P0)

**Goal**: Detect non-portable MCPs and store selections in the database.

**Tasks**:
1. Create `src/mcp.rs` module:
   - `McpServer`, `McpSource` types
   - `detect_mcp_servers()` — scans `~/.claude.json` project MCPs and gitignored repo `.claude.json`
   - `serialize_for_cli()` — formats for `--mcp-config`
   - `is_tracked_by_git()` helper
   - Unit tests
2. Add database migration v15:
   - `repository_mcp_servers` table
   - CRUD functions in `db.rs`
3. Add Tauri commands in `src-tauri/src/commands/mcp.rs`:
   - `detect_mcp_servers`
   - `save_repository_mcps`
   - `load_repository_mcps`
   - `delete_repository_mcp`
4. Register commands in `main.rs` invoke handler

**Acceptance Criteria**:
- [ ] Detection finds project-scoped MCPs in `~/.claude.json`
- [ ] Detection finds MCPs in gitignored `{repo}/.claude.json`
- [ ] Detection ignores `.mcp.json` and global (non-project) MCPs
- [ ] Detection ignores tracked `.claude.json` (not gitignored)
- [ ] Database CRUD works for MCP server storage
- [ ] Unit tests pass for all parsing and edge cases

### Phase 2: Selection UI (P0)

**Goal**: Present MCP selection modal in the add-repo flow.

**Tasks**:
1. Create `McpSelectionModal.tsx`:
   - Server list with checkboxes (pre-selected)
   - Transport type and source labels
   - Loading/empty/error states
   - Skip and Save actions
2. Add frontend service functions (`services/mcp.ts`)
3. Add TypeScript types (`types/mcp.ts`)
4. Integrate into `AddRepoModal.tsx`:
   - After `add_repository()` succeeds, call `detect_mcp_servers()`
   - If servers found, open `McpSelectionModal`
   - If no servers found, proceed normally
5. Add `mcpSelection` case to `ModalRouter.tsx`

**Acceptance Criteria**:
- [ ] Modal shows after adding a repo with non-portable MCPs
- [ ] Modal does NOT show when no non-portable MCPs exist
- [ ] All detected servers pre-selected by default
- [ ] Skip closes modal without saving
- [ ] Save persists selections to database
- [ ] UI handles loading and error states

### Phase 3: Agent Injection (P0)

**Goal**: Inject stored MCPs at agent spawn time via `--mcp-config`.

**Tasks**:
1. Add `mcp_config: Option<String>` to `AgentSettings`
2. Update `build_claude_args()` to append `--mcp-config` on first turn
3. Update `send_chat_message` to load MCPs from DB and pass to `AgentSettings`
4. Add `serialize_for_cli()` call in the command layer
5. End-to-end test: add repo → select MCPs → create workspace → chat → verify MCPs available

**Acceptance Criteria**:
- [ ] First turn includes `--mcp-config <json>` in CLI args
- [ ] Resumed turns do NOT include `--mcp-config` (session inherits)
- [ ] Repos with no saved MCPs spawn without `--mcp-config`
- [ ] `serialize_for_cli()` produces valid JSON accepted by Claude CLI
- [ ] Agent can use injected MCP tools

### Phase 4: Settings Management (P1)

**Goal**: Manage MCP selections for existing repos in settings UI.

**Tasks**:
1. Add MCP section to repository settings modal
2. Display saved MCP servers with name, type, source
3. Add "Re-detect" button to scan for new/changed MCPs
4. Add remove button per server
5. Wire up to existing `update_repository_settings` flow or dedicated save

**Acceptance Criteria**:
- [ ] Saved MCPs visible in repo settings
- [ ] Re-detect finds newly added MCPs
- [ ] Removing a server updates DB immediately
- [ ] Changes reflected in next agent spawn

## Testing Strategy

### Unit Tests (`src/mcp.rs`)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| User project MCPs found | `~/.claude.json` with `projects[path].mcpServers` | Vec of McpServer with `UserProjectConfig` source |
| No project entry | `~/.claude.json` without matching project key | Empty Vec |
| Gitignored `.claude.json` | Untracked `.claude.json` with `mcpServers` | Vec of McpServer with `RepoLocalConfig` source |
| Tracked `.claude.json` | Git-tracked `.claude.json` with `mcpServers` | Empty Vec (skipped) |
| Missing `~/.claude.json` | File doesn't exist | Empty Vec |
| Malformed JSON | Invalid JSON in config file | Empty Vec (graceful fallback) |
| No `mcpServers` key | Valid JSON without MCP section | Empty Vec |
| Mixed sources | MCPs from both user config and repo config | Combined Vec with correct sources |
| `serialize_for_cli` | Vec of McpServers | Valid JSON string with `mcpServers` wrapper |
| Name collision across sources | Same server name in both sources | Modal shows conflict; user picks one (or skips). Only one saved per name per repo. |

### Integration Tests

1. **Database round-trip**: Insert MCPs → list → verify match
2. **Delete cascade**: Delete repo → verify MCPs removed
3. **Agent args**: Build args with mcp_config → verify `--mcp-config` present
4. **Agent args (resume)**: Build args for resumed turn → verify no `--mcp-config`
5. **Agent args (no MCPs)**: Build args with no mcp_config → verify no `--mcp-config`

### Manual Testing

1. Add repo that has project-scoped MCPs in `~/.claude.json` → verify modal shows
2. Add repo with no non-portable MCPs → verify modal does NOT show
3. Add repo with gitignored `.claude.json` containing MCPs → verify detection
4. Select MCPs → create workspace → send message → verify `claude mcp list` shows servers
5. Skip MCPs → verify agent spawns without `--mcp-config`
6. Open repo settings → verify saved MCPs displayed
7. Remove an MCP from settings → verify next agent session doesn't include it

## Edge Cases and Error Handling

### Edge Case 1: Large `~/.claude.json`

**Scenario**: User has a very large `~/.claude.json` with many projects.

**Handling**: The implementation deserializes the entire file into a `serde_json::Value`, then indexes into `projects[repo_path]` to extract only the relevant entry. Full-file parsing is simple and fast enough for typical configs. If parsing fails, return empty Vec and log warning. If large-file performance becomes a real issue, we can switch to a streaming `serde_json::Deserializer` approach that scans project keys without materializing the entire document.

### Edge Case 2: Duplicate Server Names Across Sources

**Scenario**: Same MCP server name appears in both `~/.claude.json` project config and gitignored `.claude.json`.

**Handling**: The DB enforces `UNIQUE(repository_id, name)` and `serialize_for_cli()` builds a JSON object (which cannot have duplicate keys), so at most one config per server name can be stored. In the selection modal, group entries by server name and show each candidate with its source label and config summary. The user may select **at most one** variant for a given name (radio-button behavior within the group, not checkboxes). If neither variant is selected, that server name is skipped entirely. Only the chosen variant is persisted.

### Edge Case 3: Repository Path Changes

**Scenario**: User moves the repository directory. The project key in `~/.claude.json` no longer matches.

**Handling**: Stored MCPs in the database remain valid (they're self-contained configs). "Re-detect" in settings will use the new canonical path. Old project-keyed MCPs won't be found, but the DB-stored versions still work.

### Edge Case 4: `~/.claude.json` Not Valid JSON

**Scenario**: File exists but contains invalid JSON.

**Handling**: `serde_json::from_str` returns `Err`, we convert to `None` via `.ok()`, return empty Vec. No error shown to user since this isn't a critical failure.

### Edge Case 5: MCP Server Config with Environment Variables

**Scenario**: Config contains `${API_KEY}` or `${VAR:-default}` syntax.

**Handling**: Store the raw config including variable references. Claude CLI resolves these at runtime. Display raw syntax in UI (e.g., `${API_KEY}`). Do not attempt to resolve variables in Claudette.

### Edge Case 6: Agent Session Started Before MCPs Configured

**Scenario**: User adds repo, skips MCP selection, creates workspace and starts chatting. Later configures MCPs in repo settings.

**Handling**: Changes only apply to new sessions. The current session (already initialized with `--session-id`) cannot retroactively gain MCP access. User must start a new session (e.g., new workspace or reset session) for MCPs to take effect.

## Security Considerations

### S1: Sensitive Values in MCP Configs

**Risk**: Config may contain API keys, tokens, or credentials in `env`, `headers`, or `url` fields.

**Mitigation**:
- Mask values in the selection UI that look like secrets (length > 20, contains mix of alphanumeric chars)
- Store configs as-is in DB (needed for `--mcp-config` injection) — DB file is local and user-owned
- Never log full MCP configs; log only server names
- Environment variable references (`${VAR}`) are preferred over inline secrets

### S2: JSON Injection via Config

**Risk**: Maliciously crafted config JSON could cause issues when passed to `--mcp-config`.

**Mitigation**:
- Validate that `config_json` stored in DB is valid JSON via `serde_json::from_str`
- Use `serde_json::to_string` for serialization (handles escaping)
- The JSON is passed as a single CLI argument (shell-escaped by `Command::arg()`)

### S3: Git Command Injection

**Risk**: The `is_tracked_by_git()` helper runs `git ls-files`. A crafted filename could inject commands.

**Mitigation**:
- The filename is hardcoded (`.claude.json`), not user-provided
- Use `Command::args()` (array form), not shell string interpolation
- `current_dir` is the validated repo path from database

## Open Questions

### Q1: Should we detect MCPs from `~/.claude/plugins/`?

**Question**: Claude Code's plugin system stores MCP configs in `~/.claude/plugins/`. Should we detect these?

**Recommendation**: No. Plugin MCPs are globally available to Claude CLI regardless of working directory. They don't need injection.

### Q2: Should MCP selections be workspace-level instead of repo-level?

**Question**: Different workspaces might need different MCPs. Should we allow per-workspace overrides?

**Recommendation**: Start with repo-level (simpler, covers 90% of cases). If users need per-workspace MCPs, add an override table later. The `--mcp-config` injection point in `send_chat_message` can easily be extended to check workspace-level overrides first.

### Q3: What if the user modifies `~/.claude.json` after adding the repo?

**Question**: Should we watch for changes and prompt to re-detect?

**Recommendation**: No automated watching. Provide a "Re-detect" button in repo settings. File watching adds complexity and edge cases (debouncing, race conditions) for a rare scenario.

### Q4: Should we support adding custom MCP servers not from detection?

**Question**: Should users be able to manually add MCP configs that don't exist in any config file?

**Recommendation**: Defer to Phase 4+. The initial implementation focuses on carrying existing configs into worktrees. Manual MCP management is a separate feature.

## Success Metrics

1. **Detection accuracy**: 100% of non-portable MCPs correctly identified
2. **Zero false positives**: Never detect MCPs that are already auto-available in worktrees
3. **Injection success**: Agents can use injected MCP tools in 100% of cases
4. **Minimal friction**: Modal only appears when there are MCPs to configure; skip takes one click
5. **No regressions**: Auto-detected MCPs (`.mcp.json`, global user MCPs) continue to work without `--mcp-config`

## Appendix

### A1: `--mcp-config` JSON Format

The JSON string passed to `--mcp-config` wraps server configs in an `mcpServers` object:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "API_KEY": "${MY_API_KEY}" }
    },
    "my-api": {
      "type": "http",
      "url": "https://mcp.example.com/api",
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      }
    }
  }
}
```

### A2: `~/.claude.json` Project-Scoped Structure

```json
{
  "projects": {
    "/home/user/my-repo": {
      "mcpServers": {
        "project-db": {
          "command": "docker",
          "args": ["exec", "postgres-mcp", "serve"],
          "env": {}
        }
      },
      "allowedTools": ["Bash", "Read"]
    },
    "/home/user/other-repo": {
      "mcpServers": { ... }
    }
  },
  "numStartups": 42,
  ...other user-level state...
}
```

### A3: Database Schema

```sql
CREATE TABLE repository_mcp_servers (
    id              TEXT PRIMARY KEY,        -- UUID
    repository_id   TEXT NOT NULL            -- FK to repositories.id
        REFERENCES repositories(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,           -- MCP server name
    config_json     TEXT NOT NULL,           -- Full server config as JSON
    source          TEXT NOT NULL,           -- 'user_project_config' | 'repo_local_config'
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repository_id, name)             -- One server per name per repo
);
```

### A4: References

- Claude Code `--mcp-config` flag: `claude --help`
- MCP Specification: https://modelcontextprotocol.io/
- Claudette Architecture: `CLAUDE.md`
- Previous TDD (superseded): git history of this file
- Related Issue: [#170](https://github.com/utensils/Claudette/issues/170)
- Related PR (closed): [#174](https://github.com/utensils/Claudette/pull/174)

---

**Next Steps**:
1. Review this TDD
2. Close PR #174 (previous approach)
3. Implement Phase 1-3 (detection, UI, injection) as a single PR
4. Phase 4 (settings management) as follow-up PR
