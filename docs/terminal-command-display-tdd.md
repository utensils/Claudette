# Technical Design: Terminal Command Display in Sidebar

**Status**: Draft
**Date**: 2026-04-10
**Issue**: [#121](https://github.com/utensils/Claudette/issues/121)

## 1. Overview

Show the currently running terminal command for each workspace in the sidebar, allowing users to see at a glance which workspaces have active development servers or persistent processes running.

### User Stories

- As a developer, I want to see which workspaces have running processes (like `npm run dev` or `rails server`) so I can quickly identify active environments without switching between workspaces
- As a developer, I want to see the command name in the sidebar so I know what's running without opening the terminal panel
- As a developer, I want the indicator to update when I start/stop processes so the information stays current

## 2. Current Architecture

### Terminal Flow

```
User opens terminal tab
  → TerminalPanel calls spawnPty(worktreePath) → Tauri command
  → Rust spawns PTY via portable_pty, starts background reader thread
  → User types command → term.onData() → writePty(ptyId, bytes) → Rust writes to PTY
```

### Key Components

| Component | File | Current State |
|-----------|------|---------------|
| PTY handle | `src-tauri/src/state.rs` | Tracks writer, master, child process |
| Terminal tabs | `src/model/terminal_tab.rs` | Stores id, workspace_id, title, is_script_output |
| Sidebar display | `src/ui/src/components/sidebar/Sidebar.tsx` | Shows workspace name, branch, status dot |
| Store | `src/ui/src/stores/useAppStore.ts` | Manages terminal tabs per workspace |

### Gap Analysis

1. **No command tracking**: PTY only tracks the shell process, not what command is running inside it
2. **No UI display**: Sidebar doesn't have a slot for showing terminal command information
3. **No state synchronization**: No mechanism to update workspace state when a command starts/ends

## 3. Design

### 3.1 Approach: Input Tracking

Track the last command line submitted to each PTY by monitoring input sent to `write_pty`:

**Why input tracking?**
- ✅ Shell-agnostic (works with bash, zsh, fish)
- ✅ No process introspection needed (avoids platform-specific code)
- ✅ Lightweight (no polling, no external tools)
- ✅ Captures user intent (what they typed)
- ❌ Doesn't detect when process exits (limitation accepted)
- ❌ False positives for `cd`, `ls` (mitigated by UI design)

**Alternatives considered:**
1. **Process introspection** (`ps`, `/proc`) - fragile, platform-specific, requires polling
2. **Shell output parsing** - unreliable (PS1 variations, ncurses apps)
3. **Shell integration** - requires user shell config changes

### 3.2 Command Extraction Logic

When `write_pty` receives data, treat it as raw terminal input bytes from `term.onData()`, not plain text. The input buffer must apply minimal line-editing rules before command extraction:

**Input Processing:**

1. **Printable characters** - Append to `input_buffer`
2. **Backspace/delete** (`\x08` or `\x7f`) - Remove previous character from buffer if present
3. **ANSI escape sequences** - Ignore CSI sequences (arrow keys `\x1b[A`, `\x1b[B`, etc.) and other escape codes
4. **Other control bytes** - Ignore unless explicitly handled below
5. **Newline submission** (`\r`, `\n`, or `\r\n`):
   - Normalize `\r\n` to single submission (don't double-trigger)
   - Trim whitespace from buffer
   - Ignore if empty, starts with `#`, or matches builtin list
   - Otherwise, store full trimmed command as `last_command`
   - Emit `pty-command-detected` event
   - Clear `input_buffer`

**On Ctrl+C detected** (`\x03` byte):
1. Clear the `last_command` for this PTY
2. Clear the `input_buffer` for this PTY
3. Emit `pty-command-stopped` event with `{ pty_id, command: null }`

**On PTY close** (in `close_pty` command):
1. Emit `pty-command-stopped` event with `{ pty_id, command: null }`
2. This ensures sidebar clears when terminal is closed (not a limitation)

**Builtin ignore list** (canonical): `cd`, `ls`, `pwd`, `echo`, `export`, `alias`, `history`, `clear`, `exit`, `source`, `.`, `eval`, `set`, `unset`

**Examples**:
- Input: `npm run dev\n` → Stores `"npm run dev"`, emits event
- Input: `npm rn\x08\x08un dev\r\n` → Backspace processing → Stores `"npm run dev"`
- Input: `\x1b[A\r` → Ignores arrow-up escape sequence, no command stored
- Input: `cd src\n` → Ignored (builtin)
- Input: `\x03` (Ctrl+C) → Clears command and buffer, emits stopped event

### 3.3 Data Model Changes

#### Backend: PTY Handle Enhancement

**File**: `src-tauri/src/state.rs`

```rust
pub struct PtyHandle {
    pub writer: Mutex<Box<dyn std::io::Write + Send>>,
    pub master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    pub child: Mutex<Box<dyn portable_pty::Child + Send>>,
    /// Buffer for accumulating input until newline
    pub input_buffer: Mutex<Vec<u8>>,
    /// The last command submitted (for display purposes)
    pub last_command: Mutex<Option<String>>,
}
```

#### Backend: New Tauri Command

**Note**: A `get_pty_info` command is not needed in this design since state is populated reactively via events. If persistence is added later (§7.4), this command could be used to hydrate state on app startup.

#### Frontend: Workspace Display State

**File**: `src/ui/src/stores/useAppStore.ts`

```typescript
interface AppStore {
  // ... existing fields ...

  /// Map of workspace_id → last active terminal command
  workspaceTerminalCommands: Record<string, string | null>;

  /// Update the terminal command for a workspace
  setWorkspaceTerminalCommand: (wsId: string, command: string | null) => void;
}
```

### 3.4 Implementation Flow

```
1. User types "npm run dev" + Enter in terminal
   ↓
2. TerminalPanel.onData() → writePty(ptyId, bytes)
   ↓
3. write_pty detects \n in bytes
   ↓
4. Extracts command from input_buffer
   ↓
5. Stores in last_command (if not a builtin)
   ↓
6. Emits Tauri event: "pty-command-detected" { pty_id, command }
   ↓
7. Frontend listener receives event
   ↓
8. Looks up workspace_id for this pty_id (via terminalTabs)
   ↓
9. Calls setWorkspaceTerminalCommand(wsId, command)
   ↓
10. Sidebar reactively updates to show command
```

### 3.5 UI Design

#### Sidebar Workspace Item

**Current layout:**
```
[●] workspace-name
    claudette/workspace-name
```

**New layout with command:**
```
[●] workspace-name
    claudette/workspace-name
    ▸ npm run dev
```

**Visual treatment:**
- Font: monospace, 11px, muted color (`--text-tertiary`)
- Icon: ▸ (triangular play symbol) to indicate active process
- Placement: Below branch name, same indentation level
- Max width: Truncate long commands with ellipsis (e.g., `npm run dev --port 3000...`)
- Only show if command exists

**CSS** (`Sidebar.module.css`):
```css
.terminalCommand {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminalCommandIcon {
  margin-right: 4px;
  opacity: 0.7;
}
```

### 3.6 Event Handling

**New Tauri events**:

1. **`pty-command-detected`**: Emitted when a command is executed
   ```typescript
   {
     pty_id: number;
     command: string;
   }
   ```

2. **`pty-command-stopped`**: Emitted when Ctrl+C is pressed
   ```typescript
   {
     pty_id: number;
     command: null;
   }
   ```

**Frontend listener** (in `App.tsx` - must be top-level to avoid missing events):

**IMPORTANT**: The listener must be placed in `App.tsx` or another component that is always mounted. If placed in `TerminalPanel.tsx`, it will unmount when the user switches to the chat or diff panel, causing events to be silently dropped and the sidebar to show stale data.

```typescript
useEffect(() => {
  const handleTerminalCommandEvent = (event: {
    payload: { pty_id: number; command: string | null }
  }) => {
    const { pty_id, command } = event.payload;

    // Find which workspace owns this PTY
    const workspaces = useAppStore.getState().workspaces;
    const terminalTabs = useAppStore.getState().terminalTabs;

    for (const ws of workspaces) {
      const tabs = terminalTabs[ws.id] || [];
      const tab = tabs.find(t => t.pty_id === pty_id);
      if (tab) {
        useAppStore.getState().setWorkspaceTerminalCommand(ws.id, command);
        break;
      }
    }
  };

  const unlistenDetected = listen<{ pty_id: number; command: string | null }>(
    "pty-command-detected",
    handleTerminalCommandEvent
  );

  const unlistenStopped = listen<{ pty_id: number; command: string | null }>(
    "pty-command-stopped",
    handleTerminalCommandEvent
  );

  return () => {
    unlistenDetected.then(fn => fn());
    unlistenStopped.then(fn => fn());
  };
}, []);
```

### 3.7 PTY ID Storage on Terminal Tabs

**Problem**: Frontend needs to map `pty_id` back to `workspace_id` when receiving events.

**Solution**: Store `pty_id` in the frontend `TerminalTab` type.

**File**: `src/ui/src/types/terminal.ts`

```typescript
export interface TerminalTab {
  id: number;
  workspace_id: string;
  title: string;
  is_script_output: boolean;
  sort_order: number;
  created_at: string;
  pty_id?: number; // NEW: Added when PTY is spawned
}
```

**Update flow**: When `spawnPty()` succeeds, update the terminal tab with the PTY ID. This requires adding a new store action to patch a tab in-place:

```typescript
// In useAppStore.ts
updateTerminalTabPtyId: (wsId: string, tabId: number, ptyId: number) => {
  set((s) => ({
    terminalTabs: {
      ...s.terminalTabs,
      [wsId]: (s.terminalTabs[wsId] || []).map(t =>
        t.id === tabId ? { ...t, pty_id: ptyId } : t
      ),
    },
  }));
}

// In TerminalPanel.tsx
const ptyId = await spawnPty(worktreePath);
updateTerminalTabPtyId(workspaceId, tabId, ptyId);
```

## 4. Files Modified

| File | Change |
|------|--------|
| `src-tauri/src/state.rs` | Add `input_buffer`, `last_command` to `PtyHandle` |
| `src-tauri/src/commands/pty.rs` | Command extraction logic with backspace/escape handling; emit events in `write_pty` and `close_pty` |
| `src/ui/src/types/terminal.ts` | Add `pty_id?: number` to `TerminalTab` |
| `src/ui/src/stores/useAppStore.ts` | Add `workspaceTerminalCommands`, `setWorkspaceTerminalCommand` |
| `src/ui/src/components/terminal/TerminalPanel.tsx` | Store `pty_id` on tab after spawn |
| `src/ui/src/App.tsx` | Add event listeners for `pty-command-detected` and `pty-command-stopped` (must be top-level) |
| `src/ui/src/components/sidebar/Sidebar.tsx` | Display terminal command below branch name |
| `src/ui/src/components/sidebar/Sidebar.module.css` | Add styles for `.terminalCommand` |

## 5. Edge Cases & Limitations

### 5.1 Known Limitations

1. **Natural process exit not detected**: Command stays visible if process exits naturally (not via Ctrl+C or terminal close)
   - **Example**: `node script.js` that finishes → command remains visible
   - **Mitigation**: Ctrl+C and terminal close both clear the command (covers most cases)
   - **Future**: Could monitor child process exit via `child.try_wait()`

2. **Multiple terminals**: Only shows one command per workspace (the most recent)
   - **Mitigation**: Users typically run one main process per workspace
   - **Future**: Could show count (e.g., "2 processes")

3. **Builtins shown briefly**: User might see `cd src` flash before being ignored
   - **Mitigation**: Update is fast, minimal UX impact

4. **Multiline commands**: Only last line is captured
   - **Mitigation**: Most commands are single-line; multiline is edge case

### 5.2 Builtin Command Handling

**Canonical builtin ignore list** (referenced in §3.2):
- `cd`, `ls`, `pwd`, `echo`, `export`, `alias`, `history`, `clear`, `exit`, `source`, `.`, `eval`, `set`, `unset`

Rationale: These are navigation/environment commands, not persistent processes. The sidebar should only show long-running commands that users need to monitor.

### 5.3 Command Truncation

- Enforce 40-character cap in application logic before rendering
- Truncate with ellipsis when command exceeds 40 characters: `npm run dev --port 3000 --ho...`
- CSS `text-overflow: ellipsis` provides additional responsive truncation based on available width
- Full command available on hover (via `title` attribute)

## 6. Testing

### 6.1 Unit Tests

**`src-tauri/src/pty.rs`**:
- `test_extract_command_from_buffer`: Valid command → extracted correctly
- `test_ignore_builtin_commands`: `cd`, `ls` → ignored
- `test_preserve_full_command`: `rails server -p 3000` → full command stored
- `test_empty_input`: `\n` alone → ignored
- `test_multiline_handling`: Multiple commands → last one wins
- `test_ctrl_c_clears_command`: `\x03` → clears last_command, emits stopped event

### 6.2 Integration Tests

1. **Command capture**:
   - Type `npm run dev\n` → Event emitted with `command: "npm run dev"`
   - Verify sidebar shows `▸ npm run dev`

2. **Builtin filtering**:
   - Type `cd src\n` → No event emitted
   - Sidebar unchanged

3. **Multiple terminals**:
   - Workspace with 2 terminals
   - First runs `npm run dev`, second runs `rails server`
   - Sidebar shows most recent command

4. **Workspace switching**:
   - Switch between workspaces → Each shows its own command

### 6.3 Manual Verification

- [ ] Start dev server (`npm run dev`) → Command appears in sidebar
- [ ] Press Ctrl+C → Command disappears from sidebar
- [ ] Restart server → Command reappears
- [ ] Navigate with `cd` → Sidebar unchanged
- [ ] Edit command with backspace/arrows → Final command is clean (no escape sequences)
- [ ] Long command → Truncated at 40 characters with ellipsis
- [ ] Hover truncated command → Full command in tooltip
- [ ] Run short script that finishes → Command persists (known limitation - natural exit not detected)
- [ ] Close terminal → Command clears (emits `pty-command-stopped`)
- [ ] Switch to chat panel while command running → Event still received, sidebar updates
- [ ] Archive workspace → Command cleared
- [ ] Remote workspace → Works identically (if remote PTY tracking added)

## 7. Future Enhancements

### 7.1 Process Exit Detection

Add a background thread to poll `child.try_wait()` and emit `pty-process-exited` events. Clear command when process exits.

### 7.2 Multiple Process Display

Show count: `▸ 2 processes` or list multiple commands (collapsible).

### 7.3 Process Management Actions

Right-click command in sidebar → "Stop process" → Sends Ctrl+C to PTY.

### 7.4 Persistence Across Restarts

Store last command in database (`terminal_tabs` table) so it survives app restarts.

## 8. Example Scenarios

### Scenario 1: Frontend Developer

```
Workspaces:
  ✓ ssk-web
    claudette/fix-auth-bug
    ▸ npm run dev

  ✓ ssk-api
    claudette/add-endpoint
    ▸ rails server -p 3001

  ○ claudette
    claudette/feature-xyz
    (no terminal command)
```

**UX**: User can immediately see which workspaces have servers running without switching tabs.

### Scenario 2: Background Jobs

```
Workspaces:
  ✓ data-pipeline
    claudette/optimize-etl
    ▸ python process_queue.py
```

**UX**: User knows the background job is running while working in a different workspace.

### Scenario 3: Docker Compose

```
Workspaces:
  ✓ microservices
    claudette/fix-auth
    ▸ docker compose up
```

**UX**: Clear indication that Docker services are running.

## 9. Rollout Plan

1. **Phase 1**: Backend command tracking + event emission
   - Implement `PtyHandle` changes
   - Add `write_pty` logic
   - Add tests

2. **Phase 2**: Frontend state management
   - Add store fields
   - Wire up event listeners
   - Update `TerminalTab` type

3. **Phase 3**: UI integration
   - Update sidebar component
   - Add CSS styling
   - Test across themes

4. **Phase 4**: Polish
   - Add tooltip for full command
   - Refine builtin ignore list
   - Performance testing

## 10. Success Metrics

- Users can identify active dev servers without switching workspaces
- Command updates appear within 100ms of user pressing Enter
- No performance degradation with 10+ workspaces
- Builtin commands are reliably filtered out
