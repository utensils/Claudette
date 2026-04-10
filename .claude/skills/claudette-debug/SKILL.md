---
name: claudette-debug
description: Debug the running Claudette Tauri app by executing JavaScript in the webview and reading results back. Inspect Zustand store state, trace state changes, and diagnose UI bugs in real-time. Only works in dev builds (cargo tauri dev).
argument-hint: "[action] [target-or-js...]"
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Grep, Glob
---

# Claudette Debug

Execute JavaScript inside the running Claudette Tauri webview and get results back via a TCP debug server on `127.0.0.1:19432`. Dev-build only (`#[cfg(debug_assertions)]`).

## Architecture

```
Terminal ──TCP:19432──> debug server ──eval()──> webview JS context
                                                      |
Terminal <──TCP────── debug server <──invoke── webview (result callback)
```

- **TCP server**: `src-tauri/src/commands/debug.rs` — `start_debug_server()` spawns a tokio TCP listener in the Tauri `setup()` hook. Accepts JS, wraps it to capture the return value, evals in the webview, waits for the result callback, returns it over TCP.
- **Round-trip**: The wrapped JS calls `window.__CLAUDETTE_INVOKE__('debug_eval_result', { requestId, data })` to send results back. The Rust side receives this via a oneshot channel + Tauri event listener.
- **Helper script**: `scripts/debug-eval.sh` handles the TCP socket lifecycle.

## How to Execute JS

Use `scripts/debug-eval.sh` via the Bash tool. The JS must use `return` to send a value back:

```bash
./scripts/debug-eval.sh 'return 1 + 1'
# => 2

./scripts/debug-eval.sh 'return document.title'
# => Claudette

./scripts/debug-eval.sh 'return window.__CLAUDETTE_STORE__.getState().workspaces.map(w => w.name)'
# => ["zealous-myrtle", "sulky-holly", ...]
```

For multiline JS, use heredoc:
```bash
./scripts/debug-eval.sh <<'JS'
const s = window.__CLAUDETTE_STORE__.getState();
return Object.keys(s.completedTurns);
JS
```

## Available Globals (dev mode only)

| Global | Type | Description |
|--------|------|-------------|
| `window.__CLAUDETTE_STORE__` | Zustand `useAppStore` | `.getState()` to read, `.setState()` to write |
| `window.__CLAUDETTE_INVOKE__` | Tauri `invoke` function | Call any Tauri command from eval'd JS |
| `window.__CLAUDETTE_CHAT_DEBUG__` | `boolean` | Toggle `[chat-debug]` console logging |

## Argument Parsing

`/claudette-debug [action] [args...]`

| Action | Description |
|--------|-------------|
| `state` | Summary of all store slices (keys + sizes) |
| `state <slice>` | Dump a specific slice: `completedTurns`, `chatMessages`, `toolActivities`, `workspaces`, `checkpoints`, etc. |
| `eval <js>` | Execute arbitrary JS and return the result |
| `watch <slice>` | Subscribe to slice changes (logs to webview console, returns confirmation) |
| `unwatch` | Remove all watch subscriptions |
| `trace <action>` | Monkey-patch a store action to log calls to webview console |
| `untrace` | Remove all traces |
| `snapshot` | Dump full store state (non-function values) as JSON |

## Action Implementation

### `state` (no args) — store overview

```bash
./scripts/debug-eval.sh <<'JS'
const s = window.__CLAUDETTE_STORE__.getState();
return Object.entries(s)
  .filter(([, v]) => typeof v !== 'function')
  .map(([k, v]) => {
    const size = Array.isArray(v) ? v.length
      : v && typeof v === 'object' ? Object.keys(v).length
      : String(v).length;
    return k + ': ' + (Array.isArray(v) ? '[' + size + ']' : typeof v === 'object' && v ? '{' + Object.keys(v).length + ' keys}' : JSON.stringify(v));
  }).join('\n');
JS
```

### `state <slice>` — dump specific slice

```bash
./scripts/debug-eval.sh 'return window.__CLAUDETTE_STORE__.getState().SLICE_NAME'
```

Replace `SLICE_NAME` with the actual slice name (e.g., `completedTurns`, `chatMessages`, `workspaces`).

### `eval <js>` — arbitrary JS

```bash
./scripts/debug-eval.sh 'USER_JS_HERE'
```

Pass the user's JS directly. Wrap in `return` if they want a value back.

### `watch <slice>` — subscribe to changes

```bash
./scripts/debug-eval.sh <<'JS'
window.__CLAUDETTE_DEBUG_UNSUB__?.();
window.__CLAUDETTE_DEBUG_UNSUB__ = window.__CLAUDETTE_STORE__.subscribe(
  (state, prev) => {
    if (state.SLICE_NAME !== prev.SLICE_NAME) {
      console.log('[debug] SLICE_NAME changed:', {
        prev: prev.SLICE_NAME,
        next: state.SLICE_NAME,
      });
      console.trace('[debug] change origin');
    }
  }
);
return 'Watching SLICE_NAME — check webview console for changes';
JS
```

### `unwatch`

```bash
./scripts/debug-eval.sh <<'JS'
window.__CLAUDETTE_DEBUG_UNSUB__?.();
delete window.__CLAUDETTE_DEBUG_UNSUB__;
return 'All watchers removed';
JS
```

### `trace <action>` — monkey-patch store action

```bash
./scripts/debug-eval.sh <<'JS'
const store = window.__CLAUDETTE_STORE__;
const orig = store.getState().ACTION_NAME;
if (typeof orig !== 'function') return 'ERROR: ACTION_NAME is not a function';
store.setState({
  ACTION_NAME: (...args) => {
    console.log('[debug] ACTION_NAME called:', args);
    console.trace('[debug] call origin');
    return orig(...args);
  }
});
window.__CLAUDETTE_DEBUG_TRACED__ = window.__CLAUDETTE_DEBUG_TRACED__ || [];
window.__CLAUDETTE_DEBUG_TRACED__.push({ name: 'ACTION_NAME', orig });
return 'Tracing ACTION_NAME — check webview console';
JS
```

### `untrace`

```bash
./scripts/debug-eval.sh <<'JS'
(window.__CLAUDETTE_DEBUG_TRACED__ || []).forEach(({ name, orig }) => {
  window.__CLAUDETTE_STORE__.setState({ [name]: orig });
});
window.__CLAUDETTE_DEBUG_TRACED__ = [];
return 'All traces removed';
JS
```

### `snapshot` — full store state dump

```bash
./scripts/debug-eval.sh <<'JS'
const state = window.__CLAUDETTE_STORE__.getState();
return Object.fromEntries(
  Object.entries(state).filter(([, v]) => typeof v !== 'function')
);
JS
```

## Common Debugging Recipes

### Why are tool call sections vanishing?
```
/claudette-debug trace setCompletedTurns
/claudette-debug trace finalizeTurn
/claudette-debug watch completedTurns
```
Then trigger a turn — the webview console shows every call with stack traces.

### Inspect current workspace state
```
/claudette-debug state workspaces
/claudette-debug state completedTurns
/claudette-debug state chatMessages
```

### Check checkpoint save race condition
```
/claudette-debug trace setChatMessages
/claudette-debug trace setCompletedTurns
/claudette-debug watch chatMessages
```

## Prerequisites

- App running via `cargo tauri dev` (the debug TCP server starts automatically)
- Port 19432 must be available on localhost
- `scripts/debug-eval.sh` requires `python3` in PATH
