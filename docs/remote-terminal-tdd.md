# Technical Design: Remote Terminal via WebSocket

**Status**: Draft
**Date**: 2026-04-07
**Issue**: [#79](https://github.com/utensils/Claudette/issues/79) (Option 4)

## 1. Overview

Add remote terminal access so that opening a terminal on a remote workspace spawns a PTY on the remote `claudette-server` and streams I/O over the existing WebSocket connection to the local xterm.js instance. The user experience should be identical to a local terminal — the only visual distinction is a label indicating the terminal is remote.

## 2. Current Architecture

### Local Terminal Flow

```
User opens terminal tab
  → TerminalPanel calls spawnPty(worktreePath) → Tauri command
  → Rust spawns PTY via portable_pty, starts background reader thread
  → Reader emits Tauri "pty-output" events with { pty_id, data: [u8] }
  → Frontend listens on "pty-output", writes to xterm.js
  → User types → term.onData() → writePty(ptyId, bytes) → Tauri command
  → Rust writes to PTY master
```

### Key Files

| Component | File | Role |
|-----------|------|------|
| Frontend component | `src/ui/src/components/terminal/TerminalPanel.tsx` | xterm.js lifecycle, tab management |
| Frontend services | `src/ui/src/services/tauri.ts` | `spawnPty`, `writePty`, `resizePty`, `closePty` wrappers |
| Frontend store | `src/ui/src/stores/useAppStore.ts` | Terminal tabs, active tab, panel visibility |
| Tauri PTY backend | `src-tauri/src/pty.rs` | PTY spawn, read loop, write, resize, close |
| Tauri state | `src-tauri/src/state.rs` | `PtyHandle`, `AppState.ptys` HashMap |
| Server handler | `src-server/src/handler.rs` | `spawn_pty`, `write_pty`, `resize_pty`, `close_pty` RPC handlers |
| Server state | `src-server/src/ws.rs` | `ServerState.ptys` HashMap, `PtyHandle` |

### Server-Side PTY (Already Implemented)

The `claudette-server` already supports PTY operations over its JSON-RPC protocol:

| Method | Params | Returns | Events |
|--------|--------|---------|--------|
| `spawn_pty` | `workspace_id`, `cwd`, `rows`, `cols` | `{ pty_id }` | Streams `pty-output` events with `{ pty_id, data }` |
| `write_pty` | `pty_id`, `data` (byte array) | `null` | — |
| `resize_pty` | `pty_id`, `rows`, `cols` | `null` | — |
| `close_pty` | `pty_id` | `null` | — |

Server PTY output is sent as WebSocket events:
```json
{ "event": "pty-output", "payload": { "pty_id": 1, "data": [72, 101, 108, 108, 111] } }
```

These events are already forwarded to the Tauri event bus by `RemoteConnectionManager::add()` under their original event name (`pty-output`), so the existing `TerminalPanel` event listener will receive them.

### Gap Analysis

The server-side PTY infrastructure is complete. The gap is entirely on the client side:

1. `TerminalPanel` always calls local Tauri commands (`spawn_pty`, `write_pty`, etc.) — no remote routing
2. No way to distinguish local vs remote PTY IDs (both are `u64` counters starting at 1, so they can collide)
3. Terminal tab creation always goes through the local database
4. `WorkspaceActions` "Open in Terminal" doesn't work for remote workspaces

## 3. Design

### 3.1 PTY ID Namespacing

Local and remote PTY IDs can collide (both use independent atomic counters). To distinguish them, the frontend will use a composite key:

```typescript
type PtyKey = {
  ptyId: number;
  connectionId: string | null; // null = local
};
```

The `pty-output` event listener already receives events from both local Tauri emissions and remote WebSocket forwarding on the same `"pty-output"` channel. To route output to the correct terminal instance, each `TermInstance` stores its `PtyKey` and the listener matches on both `pty_id` and source.

**Event disambiguation**: Remote `pty-output` events arrive via `RemoteConnectionManager` event forwarding, which emits them as Tauri events under the same `"pty-output"` name. Since both local and remote events hit the same listener, we need to add `connection_id` to the payload so the frontend can match events to the correct terminal instance.

### 3.2 Remote PTY Command Routing

Instead of branching in every call site, introduce a thin routing layer in the service module:

```typescript
// New functions that handle local/remote routing internally
export function spawnRemotePty(
  connectionId: string,
  workspaceId: string,
  cwd: string,
  rows: number,
  cols: number,
): Promise<number>

export function writeRemotePty(
  connectionId: string,
  ptyId: number,
  data: number[],
): Promise<void>

export function resizeRemotePty(
  connectionId: string,
  ptyId: number,
  rows: number,
  cols: number,
): Promise<void>

export function closeRemotePty(
  connectionId: string,
  ptyId: number,
): Promise<void>
```

These call `sendRemoteCommand()` with the appropriate method and params. The existing local `spawnPty`/`writePty`/`resizePty`/`closePty` functions remain unchanged.

### 3.3 TerminalPanel Changes

`TerminalPanel` needs to know whether the current workspace is remote so it can route PTY operations. The component already has access to the workspace via the store.

**Instance tracking** — extend the `TermInstance` type:

```typescript
interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  ptyId: number;
  connectionId: string | null; // NEW — null for local
  unlisten: () => void;
  container: HTMLDivElement;
  resizeObserver: ResizeObserver;
}
```

**Spawn flow change**:

```
if workspace.remote_connection_id:
  ptyId = await spawnRemotePty(connectionId, wsId, worktreePath, rows, cols)
  // Listen for "pty-output" events, filter by pty_id AND connection_id
else:
  ptyId = await spawnPty(worktreePath)
  // Listen for "pty-output" events, filter by pty_id only (connection_id absent)
```

**Write/resize/close** — check `instance.connectionId` to decide routing:

```
if instance.connectionId:
  writeRemotePty(connectionId, ptyId, data)
else:
  writePty(ptyId, data)
```

### 3.4 Event Forwarding Enhancement

Currently `RemoteConnectionManager::add()` forwards all remote events with their original name and payload:

```rust
let _ = app.emit(&event.event, &event.payload);
```

For `pty-output` events, the payload from the server is `{ pty_id, data }`. The frontend needs to know which remote connection the event came from to avoid PTY ID collisions. Two options:

**Option A — Annotate in Rust**: Modify the event forwarding to inject `connection_id` into `pty-output` payloads before emitting.

**Option B — Separate event name**: Emit remote PTY events as `"remote-pty-output"` with `{ connection_id, pty_id, data }`.

**Chosen: Option A** — keeps a single listener and is consistent with how `agent-stream` events already work (workspace_id in the payload disambiguates). The change is small and localized to `RemoteConnectionManager::add()`.

```rust
// In the event forwarding task:
while let Ok(event) = event_rx.recv().await {
    if event.event == "pty-output" {
        // Inject connection_id so frontend can disambiguate
        let mut payload = event.payload.clone();
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("connection_id".to_string(),
                serde_json::Value::String(connection_id.clone()));
        }
        let _ = app.emit("pty-output", &payload);
    } else {
        let _ = app.emit(&event.event, &event.payload);
    }
}
```

### 3.5 Terminal Tab Creation for Remote Workspaces

Local terminal tabs are persisted in the local SQLite database via `create_terminal_tab`. For remote workspaces, tabs should be managed locally (they're UI state for the local client, not meaningful to the server). The tab's association with a remote workspace is implicit through the `workspace_id`.

No changes needed to terminal tab DB operations — they work the same regardless of whether the workspace is local or remote.

### 3.6 WorkspaceActions Integration

Update `WorkspaceActions` to enable "Open in Terminal" for remote workspaces. The action should work identically — open the terminal panel and create a tab. The `TerminalPanel` handles the routing internally based on `workspace.remote_connection_id`.

### 3.7 Visual Distinction

Remote terminal tabs should be visually distinguishable. Add a subtle indicator (e.g., a globe icon or "remote" label) to the tab title when the terminal is connected to a remote workspace. This reuses the same pattern as the dashboard remote badge.

## 4. Implementation

### 4.1 Backend: Annotate remote pty-output events

**File**: `src-tauri/src/remote.rs`

In the event forwarding task within `RemoteConnectionManager::add()`, inject `connection_id` into `pty-output` event payloads before emitting to the Tauri event bus.

### 4.2 Frontend: Remote PTY service functions

**File**: `src/ui/src/services/tauri.ts`

Add four new functions that route PTY commands to a remote server via `sendRemoteCommand`:

- `spawnRemotePty(connectionId, workspaceId, cwd, rows, cols)` → calls `spawn_pty`
- `writeRemotePty(connectionId, ptyId, data)` → calls `write_pty`
- `resizeRemotePty(connectionId, ptyId, rows, cols)` → calls `resize_pty`
- `closeRemotePty(connectionId, ptyId)` → calls `close_pty`

### 4.3 Frontend: TerminalPanel remote routing

**File**: `src/ui/src/components/terminal/TerminalPanel.tsx`

1. Read `workspace.remote_connection_id` from the store
2. Extend `TermInstance` with `connectionId: string | null`
3. On spawn: route to `spawnRemotePty` or `spawnPty` based on `remote_connection_id`
4. On `pty-output` listener: match events by both `pty_id` and `connection_id` (local events have no `connection_id` field)
5. On write/resize/close: check `instance.connectionId` to choose local or remote function
6. On cleanup: call correct close function based on `connectionId`

### 4.4 Frontend: WorkspaceActions

**File**: `src/ui/src/components/chat/WorkspaceActions.tsx`

Remove the guard that disables "Open in Terminal" for remote workspaces (if one exists), or ensure the action works for remote workspaces by opening the terminal panel as normal.

### 4.5 Frontend: Remote tab indicator

**File**: `src/ui/src/components/terminal/TerminalPanel.tsx`

When rendering tab titles, check if the workspace is remote and prepend a globe icon or "(remote)" suffix to distinguish from local terminals.

## 5. Files Modified

| File | Change |
|------|--------|
| `src-tauri/src/remote.rs` | Inject `connection_id` into `pty-output` event payloads |
| `src/ui/src/services/tauri.ts` | Add `spawnRemotePty`, `writeRemotePty`, `resizeRemotePty`, `closeRemotePty` |
| `src/ui/src/components/terminal/TerminalPanel.tsx` | Remote routing in spawn/write/resize/close, event disambiguation, tab label |
| `src/ui/src/components/chat/WorkspaceActions.tsx` | Enable "Open in Terminal" for remote workspaces |

## 6. Testing

### Manual verification

- Open a terminal on a local workspace — behavior unchanged
- Connect to a remote server, open a remote workspace
- Open terminal on remote workspace — PTY spawns on server, output streams to local xterm.js
- Type commands in remote terminal — input reaches server PTY
- Resize terminal panel — remote PTY receives resize
- Close remote terminal tab — server PTY is cleaned up
- Open multiple terminals (mix of local and remote) — output routes to correct instances
- Disconnect from remote server — remote terminal tabs show disconnected state or close gracefully
- Tab label shows remote indicator for remote terminals

### Edge cases

- Rapid typing in remote terminal (latency tolerance)
- Large output bursts (e.g., `cat` a large file) — verify no data loss
- Remote server goes down while terminal is open — verify graceful degradation
- Multiple remote connections with terminals open simultaneously
- PTY ID collision between local and remote (same numeric ID) — verify disambiguation works

## 7. Future Considerations

- **Terminal session persistence**: Save/restore terminal scrollback across reconnections
- **Per-connection PTY limits**: Server-side enforcement of max PTYs per client
- **Latency indicator**: Show round-trip time in terminal tab for remote connections
- **Connection-scoped cleanup**: Server already cleans up PTYs when WebSocket closes; verify this works correctly
