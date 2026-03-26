# Claude Agent SDK — Rust Implementation Specification

This document specifies a Rust-native agent SDK for Claudette, derived from analysis of the
TypeScript `@anthropic-ai/claude-agent-sdk` (v2.1.85). The goal is an open-source implementation
that communicates with the Claude Code CLI subprocess over stdio using the same JSON protocol.

## Architecture Overview

The TypeScript SDK works by:

1. Spawning the `claude` CLI as a child process (Node/Bun/Deno)
2. Communicating via **stdin** (user messages, control requests) and **stdout** (SDK messages, control responses)
3. The CLI handles all Anthropic API interaction, tool execution, and session persistence internally
4. The SDK consumer iterates an async stream of `SDKMessage` events

**We do the same in Rust**: spawn `claude` as a `tokio::process::Command`, pipe stdin/stdout,
parse the JSON protocol, and surface events to the Iced UI.

## Process Spawning

```
claude --print \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  [--session-id <uuid>]          # first turn
  [--resume <session-id>]        # subsequent turns
  [--allowedTools "Read,Edit,Bash,..."]
  [--permission-mode default|acceptEdits|plan|dontAsk|bypassPermissions]
  "<prompt>"
```

### Environment Cleanup

Strip inherited Claude Code env vars to avoid auth conflicts:

```rust
cmd.env_remove("ANTHROPIC_API_KEY"); // only if not sk-ant-api* prefix
cmd.env_remove("CLAUDECODE");
cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
```

## Message Protocol

All messages are newline-delimited JSON on stdout. Each has a `type` field as discriminant.

### SDKMessage (stdout → Claudette)

A union of message types. The `type` field determines which variant:

| type | subtype | Rust Enum Variant | Description |
|------|---------|-------------------|-------------|
| `system` | `init` | `Init` | Session initialized — lists tools, model, mcp servers, permission mode |
| `system` | `status` | `Status` | Status change (e.g. `compacting`) |
| `system` | `api_retry` | `ApiRetry` | Retryable API error, will retry after delay |
| `system` | `compact_boundary` | `CompactBoundary` | Context window compaction occurred |
| `system` | `session_state_changed` | `SessionStateChanged` | State: `idle`, `running`, `requires_action` |
| `assistant` | — | `AssistantMessage` | Complete assistant response with `BetaMessage` content blocks |
| `stream_event` | — | `PartialAssistant` | Streaming delta (text chunks, tool_use blocks) |
| `user` | — | `UserMessage` | Echo of user message |
| `user_message_replay` | — | `UserMessageReplay` | Replayed user message from resumed session |
| `result` | `success` | `ResultSuccess` | Turn complete — cost, usage, num_turns |
| `result` | `error_*` | `ResultError` | Turn failed — error type, cost, usage |
| `tool_use_summary` | — | `ToolUseSummary` | Summary of a tool execution |
| `tool_progress` | — | `ToolProgress` | Progress update during long tool execution |
| `hook_started` | — | `HookStarted` | Hook execution started |
| `hook_progress` | — | `HookProgress` | Hook execution progress |
| `hook_response` | — | `HookResponse` | Hook execution result |
| `task_notification` | — | `TaskNotification` | Background task status change |
| `task_started` | — | `TaskStarted` | Background task started |
| `task_progress` | — | `TaskProgress` | Background task progress |
| `auth_status` | — | `AuthStatus` | Authentication status change |
| `local_command_output` | — | `LocalCommandOutput` | Output from slash command |
| `rate_limit_event` | — | `RateLimitEvent` | Rate limit info for subscription users |
| `files_persisted` | — | `FilesPersisted` | Files saved to disk |
| `elicitation_complete` | — | `ElicitationComplete` | MCP elicitation finished |
| `prompt_suggestion` | — | `PromptSuggestion` | Predicted next user prompt |

### SDKUserMessage (Claudette → stdin)

```json
{
  "type": "user",
  "content": "the user's prompt text"
}
```

For multi-turn conversations with streaming input, messages are written to the process stdin
as newline-delimited JSON.

### Control Protocol (stdin/stdout)

Control requests and responses are interspersed with regular messages:

**Requests (Claudette → stdin):**
- `{ "type": "control_request", "subtype": "initialize", ... }` — session init with hooks/mcp
- `{ "type": "control_request", "subtype": "interrupt" }` — abort current turn
- `{ "type": "control_request", "subtype": "set_permission_mode", "mode": "..." }`
- `{ "type": "control_request", "subtype": "set_model", "model": "..." }`
- `{ "type": "control_request", "subtype": "get_settings" }`

**Responses (stdout → Claudette):**
- `{ "type": "control_response", "subtype": "success", "request_id": "...", "response": {...} }`
- `{ "type": "control_response", "subtype": "error", "request_id": "...", "error": "..." }`

**Permission flow (stdout → Claudette → stdin):**
- stdout: `{ "type": "control_request", "subtype": "can_use_tool", "request_id": "...", "tool_name": "Bash", "tool_input": {...}, "title": "Claude wants to run: ls -la", ... }`
- stdin: `{ "type": "control_response", "subtype": "success", "request_id": "...", "response": { "behavior": "allow" } }`
- or: `{ "type": "control_response", "subtype": "success", "request_id": "...", "response": { "behavior": "deny", "message": "User denied" } }`

## Rust Data Model

### Core Message Types

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum SdkMessage {
    #[serde(rename = "system")]
    System(SystemMessage),
    #[serde(rename = "assistant")]
    Assistant(AssistantMessage),
    #[serde(rename = "stream_event")]
    StreamEvent(PartialAssistantMessage),
    #[serde(rename = "user")]
    User(UserMessage),
    #[serde(rename = "user_message_replay")]
    UserReplay(UserMessage),
    #[serde(rename = "result")]
    Result(ResultMessage),
    #[serde(rename = "tool_use_summary")]
    ToolUseSummary(ToolUseSummaryMessage),
    #[serde(rename = "tool_progress")]
    ToolProgress(ToolProgressMessage),
    #[serde(rename = "task_notification")]
    TaskNotification(TaskNotificationMessage),
    #[serde(rename = "task_started")]
    TaskStarted(TaskStartedMessage),
    #[serde(rename = "task_progress")]
    TaskProgress(TaskProgressMessage),
    #[serde(rename = "auth_status")]
    AuthStatus(AuthStatusMessage),
    #[serde(rename = "rate_limit_event")]
    RateLimitEvent(RateLimitEventMessage),
    #[serde(rename = "prompt_suggestion")]
    PromptSuggestion(PromptSuggestionMessage),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "subtype")]
pub enum SystemMessage {
    #[serde(rename = "init")]
    Init {
        tools: Vec<String>,
        model: String,
        permission_mode: PermissionMode,
        mcp_servers: Vec<McpServerInfo>,
        claude_code_version: String,
        cwd: String,
        uuid: Uuid,
        session_id: String,
    },
    #[serde(rename = "status")]
    Status {
        status: Option<String>,
        permission_mode: Option<PermissionMode>,
        uuid: Uuid,
        session_id: String,
    },
    #[serde(rename = "api_retry")]
    ApiRetry {
        attempt: u32,
        max_retries: u32,
        retry_delay_ms: u64,
        error_status: Option<u16>,
        uuid: Uuid,
        session_id: String,
    },
    #[serde(rename = "session_state_changed")]
    SessionStateChanged {
        state: SessionState,
        uuid: Uuid,
        session_id: String,
    },
    #[serde(rename = "compact_boundary")]
    CompactBoundary {
        uuid: Uuid,
        session_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssistantMessage {
    pub message: serde_json::Value, // BetaMessage — complex nested type
    pub parent_tool_use_id: Option<String>,
    pub error: Option<String>,
    pub uuid: Uuid,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartialAssistantMessage {
    pub event: serde_json::Value, // BetaRawMessageStreamEvent
    pub parent_tool_use_id: Option<String>,
    pub uuid: Uuid,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "subtype")]
pub enum ResultMessage {
    #[serde(rename = "success")]
    Success {
        result: String,
        duration_ms: u64,
        duration_api_ms: u64,
        num_turns: u32,
        total_cost_usd: f64,
        usage: Usage,
        uuid: Uuid,
        session_id: String,
    },
    #[serde(rename = "error_during_execution")]
    ErrorDuringExecution { errors: Vec<String>, uuid: Uuid, session_id: String },
    #[serde(rename = "error_max_turns")]
    ErrorMaxTurns { uuid: Uuid, session_id: String },
    #[serde(rename = "error_max_budget_usd")]
    ErrorMaxBudget { uuid: Uuid, session_id: String },
}
```

### Permission Types

```rust
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    DontAsk,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub title: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "behavior")]
pub enum PermissionResponse {
    #[serde(rename = "allow")]
    Allow {
        #[serde(skip_serializing_if = "Option::is_none")]
        updated_input: Option<serde_json::Value>,
    },
    #[serde(rename = "deny")]
    Deny {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        interrupt: Option<bool>,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Running,
    RequiresAction,
}
```

### Usage / Cost

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}
```

## Rust Runtime Layer

### AgentSession

```rust
pub struct AgentSession {
    child: tokio::process::Child,
    stdin_tx: mpsc::Sender<String>,       // write JSON lines to stdin
    message_rx: mpsc::Receiver<SdkMessage>,
    permission_rx: mpsc::Receiver<PermissionRequest>,
    permission_tx: mpsc::Sender<ControlResponse>,
    session_id: String,
    state: SessionState,
}

impl AgentSession {
    /// Spawn a new claude session
    pub async fn start(config: SessionConfig) -> Result<Self, AgentError>;

    /// Send a user message (first turn or continuation)
    pub async fn send(&self, message: &str) -> Result<(), AgentError>;

    /// Interrupt the current turn
    pub async fn interrupt(&self) -> Result<(), AgentError>;

    /// Respond to a permission request
    pub async fn respond_permission(
        &self,
        request_id: &str,
        response: PermissionResponse,
    ) -> Result<(), AgentError>;

    /// Close the session and kill the process
    pub fn close(&mut self);
}

pub struct SessionConfig {
    pub working_dir: PathBuf,
    pub session_id: Option<String>,     // None = new session
    pub resume: bool,
    pub model: Option<String>,
    pub permission_mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub max_turns: Option<u32>,
    pub include_partial_messages: bool,
}
```

### Integration with Iced

The `AgentSession` maps to Iced's architecture:

1. **Message variants** (in `message.rs`):
   - `AgentMessage(SdkMessage)` — streamed from stdout reader task
   - `AgentPermissionRequest(PermissionRequest)` — surfaces approval dialog
   - `AgentPermissionResponse(String, PermissionResponse)` — user approved/denied

2. **Subscription**: A tokio task reads stdout line by line, deserializes `SdkMessage`,
   and sends them as Iced messages via a channel.

3. **Permission UI**: When `SessionState::RequiresAction` or a `can_use_tool` control
   request arrives, the UI shows an approval modal with:
   - `title`: "Claude wants to run: ls -la"
   - `display_name`: "Run command"
   - `description`: Context about the operation
   - Allow / Deny buttons
   - "Always allow" option (returns `updated_permissions`)

## Implementation Phases

### Phase 1: Replace current agent spawning
- Replace `agent::run_turn()` with `AgentSession::start()` / `send()`
- Parse `SdkMessage` from stdout instead of ad-hoc stream parsing
- Keep `--print` mode with `--output-format stream-json`
- Map SDK messages to existing chat panel UI

### Phase 2: Permission handling
- Parse `can_use_tool` control requests from stdout
- Build approval modal in `ui/modal.rs`
- Write `control_response` to stdin on user decision
- Track `SessionState` for UI indicators

### Phase 3: Session management
- Use `--session-id` / `--resume` for conversation continuity
- Persist session ID in SQLite alongside workspace
- Support `--continue` for resuming most recent session

### Phase 4: Advanced features
- MCP server configuration passthrough
- Hook support
- Rate limit display
- Structured output
- Subagent support

## Key Differences from TypeScript SDK

| Aspect | TS SDK | Rust Implementation |
|--------|--------|-------------------|
| Runtime | Node/Bun subprocess | Same (spawns `claude` CLI) |
| Serialization | Internal bundled code | `serde_json` with tagged enums |
| Async model | AsyncGenerator | `tokio::mpsc` channels + Iced subscriptions |
| Permission UI | Callback (`canUseTool`) | Iced modal dialog via message passing |
| MCP servers | In-process SDK servers | CLI-managed only (Phase 4 for in-process) |
| Session storage | JSONL files in `~/.claude/` | CLI handles persistence; we track session_id |

## References

- SDK types: `@anthropic-ai/claude-agent-sdk/sdk.d.ts` (4155 lines)
- SDK tools: `@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` (2710 lines)
- Bridge types: `@anthropic-ai/claude-agent-sdk/bridge.d.ts` (199 lines)
- Browser types: `@anthropic-ai/claude-agent-sdk/browser-sdk.d.ts` (52 lines)
- Runtime: `sdk.mjs` (spawns CLI, pipes stdio, parses JSON)
