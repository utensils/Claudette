# Permission Handling Design

## Problem

Claude Code CLI tools (Bash, Edit, etc.) can require user approval before executing. In `--print` mode with `stdin(null)`, these tools are auto-denied — the agent notes that permission was required and gives up. We need to support the approve/deny/provide-instructions flow like the interactive CLI.

## Solution: Bidirectional Stream-JSON Protocol

The CLI supports `--input-format stream-json` alongside `--output-format stream-json` when using `--print`. This enables a bidirectional protocol where:

1. The CLI sends **permission requests** as JSON on stdout
2. Our app sends **permission responses** as JSON on stdin

### CLI Flags

```
claude --print \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --session-id SESSION \
  PROMPT
```

### Protocol

**Permission request (stdout from CLI):**
```json
{
  "type": "control_request",
  "request_id": "unique-id",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Bash",
    "input": { "command": "git checkout main" },
    "tool_use_id": "tool-123"
  }
}
```

**Approve (stdin to CLI):**
```json
{
  "type": "control_response",
  "request_id": "unique-id",
  "response": { "behavior": "allow" }
}
```

**Deny (stdin to CLI):**
```json
{
  "type": "control_response",
  "request_id": "unique-id",
  "response": { "behavior": "deny", "message": "Not allowed" }
}
```

**Approve with modified input (stdin to CLI):**
```json
{
  "type": "control_response",
  "request_id": "unique-id",
  "response": {
    "behavior": "allow",
    "updatedInput": { "command": "git checkout -b feature" }
  }
}
```

## Implementation Plan

### 1. Update `agent.rs` (claudette-core)

- Add `--input-format stream-json` to CLI args
- Keep `--print` mode and prompt as positional arg
- Keep stdin piped (not null) — already done
- Add new event type for permission requests:
  ```rust
  pub enum AgentEvent {
      Stream(StreamEvent),
      PermissionRequest(PermissionRequest),
      ProcessExited(Option<i32>),
  }

  pub struct PermissionRequest {
      pub request_id: String,
      pub tool_name: String,
      pub tool_use_id: String,
      pub input: serde_json::Value,
  }
  ```
- Parse `control_request` events in the stdout reader task
- Expose stdin writer on `TurnHandle` for sending responses

### 2. Update `commands/chat.rs` (src-tauri)

- Store stdin writer in `AgentSessionState`
- Emit `agent-permission-request` Tauri event when a `PermissionRequest` is received
- Add `respond_to_permission` command:
  ```rust
  pub async fn respond_to_permission(
      workspace_id: String,
      request_id: String,
      behavior: String,      // "allow" or "deny"
      message: Option<String>,
  ) -> Result<(), String>
  ```
  Writes the `control_response` JSON to stdin

### 3. Update frontend

- Add `PermissionRequest` type
- In `useAgentStream`, detect `agent-permission-request` events
- Show approval UI in ChatPanel: tool name, input details, Approve/Deny buttons
- Wire buttons to `respond_to_permission` command

## Verification

1. Send a prompt that triggers a Bash command (e.g., "run git status")
2. The approval banner should appear with the command
3. Clicking Approve should send the response and the tool should execute
4. Clicking Deny should deny the tool and Claude should acknowledge it
