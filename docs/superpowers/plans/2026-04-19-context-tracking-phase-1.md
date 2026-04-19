# Context Window Tracking — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse token usage from Claude CLI stream events, persist per-message counts in SQLite, and surface a compact per-turn `Nk in · N out` readout alongside the existing elapsed-time segment in `TurnFooter`.

**Architecture:**
- Rust backend (`src/agent.rs`, `src/model/chat_message.rs`, `src/db.rs`) parses `usage` on `message_delta` and `result` stream events, adds four nullable token columns to `chat_messages` (migration v20), and persists per-message usage on the existing INSERT path.
- Bridge task (`src-tauri/src/commands/chat.rs`) tracks the latest `MessageDelta.usage` during streaming and populates the inserted `ChatMessage` with it. `Result.usage` rides the existing `AgentEvent` Tauri emission to the frontend — no DB write from `Result`.
- Frontend (`src/ui/...`) extends `CompletedTurn` and `finalizeTurn` with optional turn-total token counts drawn from `Result.usage`; `TurnFooter` renders a `formatTokens()`-formatted segment when present.

**Tech Stack:** Rust 2024 (serde, rusqlite, tokio), Tauri 2, React 19 + TypeScript (strict), Zustand, vitest.

---

## Spec Reference

Design doc: `docs/superpowers/specs/2026-04-19-context-tracking-phase-1-design.md`.

Relevant GitHub issue: [#300](https://github.com/utensils/claudette/issues/300).

## File Structure

**Rust — create:**
- (none)

**Rust — modify:**
- `src/agent.rs` — add `TokenUsage`, extend `StreamEvent::Result` and `InnerStreamEvent::MessageDelta` with `usage: Option<TokenUsage>`. New unit tests for deserialization.
- `src/model/chat_message.rs` — add four `Option<i64>` fields to `ChatMessage`.
- `src/db.rs` — migration v20 (four `ALTER TABLE chat_messages ADD COLUMN`), update `insert_chat_message` / `list_chat_messages` / `last_message_per_workspace` SQL, update `make_chat_msg` test helper. New tests for round-trip + migration.
- `src-tauri/src/commands/chat.rs` — track `latest_usage` from `MessageDelta` in the bridge task; populate the new `ChatMessage` fields on assistant-message insertion.

**Frontend — create:**
- `src/ui/src/components/chat/formatTokens.ts` — pure function, formats token counts as `1.2k` / `999`.
- `src/ui/src/components/chat/formatTokens.test.ts` — unit tests.

**Frontend — modify:**
- `src/ui/src/types/chat.ts` — extend `ChatMessage` interface with four nullable fields.
- `src/ui/src/stores/useAppStore.ts` — add `inputTokens?`/`outputTokens?` to `CompletedTurn`; extend `finalizeTurn` signature and reducer.
- `src/ui/src/stores/useAppStore.test.ts` — add `finalizeTurn` tokens test.
- `src/ui/src/hooks/useAgentStream.ts` — pass `streamEvent.usage?.input_tokens` / `.output_tokens` into `finalizeTurn` in the `result` case.
- `src/ui/src/components/chat/ChatPanel.tsx` — extend `TurnFooter` with optional token props; pass them through from the caller; render a token segment before the elapsed segment.
- `src/ui/src/components/chat/ChatPanel.module.css` — add `.turnFooterTokens` class styled consistently with `.turnFooterElapsed`.
- `src/ui/src/components/chat/ChatPanel.tsx`, `src/ui/src/components/command-palette/CommandPalette.tsx`, `src/ui/src/components/sidebar/Sidebar.tsx`, `src/ui/src/components/modals/ConfirmSetupScriptModal.tsx`, `src/ui/src/components/chat/planFilePath.test.ts`, `src/ui/src/hooks/useAgentStream.ts` — add four `null` fields to every inline `ChatMessage` literal so strict-TS stays green.

---

## Task 1: Rust — `TokenUsage` struct and event parsing

**Files:**
- Modify: `src/agent.rs` (add struct; extend `StreamEvent::Result`, `InnerStreamEvent::MessageDelta`; add tests)

- [ ] **Step 1.1: Write failing tests**

Append to the existing `#[cfg(test)] mod tests` in `src/agent.rs` (if one exists — otherwise add a new block at the bottom of the file):

```rust
#[cfg(test)]
mod token_usage_tests {
    use super::*;

    #[test]
    fn deserializes_result_with_full_usage() {
        let line = r#"{
            "type": "result",
            "subtype": "success",
            "total_cost_usd": 0.12,
            "duration_ms": 4321,
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 340,
                "cache_creation_input_tokens": 500,
                "cache_read_input_tokens": 10000
            }
        }"#;
        let ev: StreamEvent = serde_json::from_str(line).unwrap();
        match ev {
            StreamEvent::Result { usage: Some(u), .. } => {
                assert_eq!(u.input_tokens, 1200);
                assert_eq!(u.output_tokens, 340);
                assert_eq!(u.cache_creation_input_tokens, Some(500));
                assert_eq!(u.cache_read_input_tokens, Some(10000));
            }
            other => panic!("expected Result with usage, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_result_without_usage_or_cache() {
        let line = r#"{
            "type": "result",
            "subtype": "success",
            "total_cost_usd": 0.01,
            "duration_ms": 100
        }"#;
        let ev: StreamEvent = serde_json::from_str(line).unwrap();
        match ev {
            StreamEvent::Result { usage, .. } => assert!(usage.is_none()),
            other => panic!("expected Result, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_result_with_minimal_usage() {
        let line = r#"{
            "type": "result",
            "subtype": "success",
            "usage": { "input_tokens": 10, "output_tokens": 20 }
        }"#;
        let ev: StreamEvent = serde_json::from_str(line).unwrap();
        match ev {
            StreamEvent::Result { usage: Some(u), .. } => {
                assert_eq!(u.input_tokens, 10);
                assert_eq!(u.output_tokens, 20);
                assert_eq!(u.cache_creation_input_tokens, None);
                assert_eq!(u.cache_read_input_tokens, None);
            }
            other => panic!("expected Result with usage, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_message_delta_with_usage() {
        let line = r#"{
            "type": "stream_event",
            "event": {
                "type": "message_delta",
                "usage": { "input_tokens": 5, "output_tokens": 7 }
            }
        }"#;
        let ev: StreamEvent = serde_json::from_str(line).unwrap();
        match ev {
            StreamEvent::Stream {
                event: InnerStreamEvent::MessageDelta { usage: Some(u) },
            } => {
                assert_eq!(u.input_tokens, 5);
                assert_eq!(u.output_tokens, 7);
            }
            other => panic!("expected Stream(MessageDelta) with usage, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_message_delta_without_usage() {
        let line = r#"{"type":"stream_event","event":{"type":"message_delta"}}"#;
        let ev: StreamEvent = serde_json::from_str(line).unwrap();
        match ev {
            StreamEvent::Stream {
                event: InnerStreamEvent::MessageDelta { usage: None },
            } => {}
            other => panic!("expected Stream(MessageDelta) no usage, got {other:?}"),
        }
    }
}
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cargo test -p claudette token_usage_tests`
Expected: compilation errors — `TokenUsage` undefined, `MessageDelta` has no fields, `Result` has no `usage` field.

- [ ] **Step 1.3: Add the `TokenUsage` struct**

In `src/agent.rs`, insert **above** the `/// Top-level JSON line from Claude CLI stdout.` comment (around line 17):

```rust
/// Token accounting reported by the CLI on `message_delta` (per-message
/// cumulative) and `result` (turn total) events. Matches the shape of
/// Anthropic's `usage` block; cache fields are independently optional.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}
```

- [ ] **Step 1.4: Extend `StreamEvent::Result` with `usage`**

In `src/agent.rs`, update the `Result` variant (currently ending at line 44):

```rust
#[serde(rename = "result")]
Result {
    subtype: String,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    total_cost_usd: Option<f64>,
    #[serde(default)]
    duration_ms: Option<i64>,
    #[serde(default)]
    usage: Option<TokenUsage>,
},
```

- [ ] **Step 1.5: Extend `InnerStreamEvent::MessageDelta` with `usage`**

In `src/agent.rs`, replace the empty `MessageDelta {}` variant (line 100-101):

```rust
#[serde(rename = "message_delta")]
MessageDelta {
    #[serde(default)]
    usage: Option<TokenUsage>,
},
```

- [ ] **Step 1.6: Run tests to verify they pass**

Run: `cargo test -p claudette token_usage_tests`
Expected: 5 passed.

- [ ] **Step 1.7: Check that existing matches on `MessageDelta {}` still compile**

Run: `cargo build -p claudette`
Expected: clean build. If a match arm like `InnerStreamEvent::MessageDelta {}` breaks, update it to `InnerStreamEvent::MessageDelta { .. }`.

- [ ] **Step 1.8: Commit**

```bash
git add src/agent.rs
git commit -m "feat(agent): parse token usage from message_delta and result events

Add TokenUsage struct and extend StreamEvent::Result + InnerStreamEvent::MessageDelta
with an optional usage field. message_delta now carries per-message cumulative
counts; result carries the turn total. Cache fields are independently optional to
tolerate CLI responses that omit them.

Refs #300."
```

---

## Task 2: Rust — `ChatMessage` token fields, DB migration v20, round-trip tests

**Files:**
- Modify: `src/model/chat_message.rs`
- Modify: `src/db.rs` (migration, INSERT, SELECTs, test helper, new tests)

- [ ] **Step 2.1: Extend `ChatMessage` struct**

Replace the struct at `src/model/chat_message.rs:33-44` with:

```rust
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct ChatMessage {
    pub id: String,
    pub workspace_id: String,
    pub role: ChatRole,
    pub content: String,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub thinking: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
}
```

- [ ] **Step 2.2: Add migration v20**

In `src/db.rs`, immediately after the existing `if version < 19 { ... }` block (ending at line 349), add:

```rust
if version < 20 {
    self.conn.execute_batch(
        "ALTER TABLE chat_messages ADD COLUMN input_tokens INTEGER;
         ALTER TABLE chat_messages ADD COLUMN output_tokens INTEGER;
         ALTER TABLE chat_messages ADD COLUMN cache_read_tokens INTEGER;
         ALTER TABLE chat_messages ADD COLUMN cache_creation_tokens INTEGER;

         PRAGMA user_version = 20;",
    )?;
}
```

- [ ] **Step 2.3: Update `insert_chat_message` SQL**

Replace the body of `insert_chat_message` at `src/db.rs:701-716`:

```rust
pub fn insert_chat_message(&self, msg: &ChatMessage) -> Result<(), rusqlite::Error> {
    self.conn.execute(
        "INSERT INTO chat_messages (
            id, workspace_id, role, content, cost_usd, duration_ms, thinking,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            msg.id,
            msg.workspace_id,
            msg.role.as_str(),
            msg.content,
            msg.cost_usd,
            msg.duration_ms,
            msg.thinking,
            msg.input_tokens,
            msg.output_tokens,
            msg.cache_read_tokens,
            msg.cache_creation_tokens,
        ],
    )?;
    Ok(())
}
```

- [ ] **Step 2.4: Update `list_chat_messages` SELECT + row mapping**

Replace the body of `list_chat_messages` at `src/db.rs:719-741`:

```rust
pub fn list_chat_messages(
    &self,
    workspace_id: &str,
) -> Result<Vec<ChatMessage>, rusqlite::Error> {
    let mut stmt = self.conn.prepare(
        "SELECT id, workspace_id, role, content, cost_usd, duration_ms, created_at, thinking,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
         FROM chat_messages WHERE workspace_id = ?1 ORDER BY created_at, rowid",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        let role_str: String = row.get(2)?;
        Ok(ChatMessage {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            role: role_str.parse().unwrap(),
            content: row.get(3)?,
            cost_usd: row.get(4)?,
            duration_ms: row.get(5)?,
            created_at: row.get(6)?,
            thinking: row.get(7)?,
            input_tokens: row.get(8)?,
            output_tokens: row.get(9)?,
            cache_read_tokens: row.get(10)?,
            cache_creation_tokens: row.get(11)?,
        })
    })?;
    rows.collect()
}
```

- [ ] **Step 2.5: Update `last_message_per_workspace` SELECT + row mapping**

Replace the body of `last_message_per_workspace` at `src/db.rs:773-798`:

```rust
pub fn last_message_per_workspace(&self) -> Result<Vec<ChatMessage>, rusqlite::Error> {
    let mut stmt = self.conn.prepare(
        "SELECT m.id, m.workspace_id, m.role, m.content, m.cost_usd, m.duration_ms, m.created_at, m.thinking,
                m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_creation_tokens
         FROM chat_messages m
         WHERE m.rowid = (
             SELECT rowid FROM chat_messages c2
             WHERE c2.workspace_id = m.workspace_id
             ORDER BY c2.created_at DESC, c2.rowid DESC
             LIMIT 1
         )",
    )?;
    let rows = stmt.query_map([], |row| {
        let role_str: String = row.get(2)?;
        Ok(ChatMessage {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            role: role_str.parse().unwrap(),
            content: row.get(3)?,
            cost_usd: row.get(4)?,
            duration_ms: row.get(5)?,
            created_at: row.get(6)?,
            thinking: row.get(7)?,
            input_tokens: row.get(8)?,
            output_tokens: row.get(9)?,
            cache_read_tokens: row.get(10)?,
            cache_creation_tokens: row.get(11)?,
        })
    })?;
    rows.collect()
}
```

- [ ] **Step 2.6: Update `make_chat_msg` test helper**

In `src/db.rs` at line 1763, add the four new fields (all `None`) to the helper:

```rust
fn make_chat_msg(id: &str, ws_id: &str, role: ChatRole, content: &str) -> ChatMessage {
    ChatMessage {
        id: id.into(),
        workspace_id: ws_id.into(),
        role,
        content: content.into(),
        cost_usd: None,
        duration_ms: None,
        created_at: String::new(),
        thinking: None,
        input_tokens: None,
        output_tokens: None,
        cache_read_tokens: None,
        cache_creation_tokens: None,
    }
}
```

- [ ] **Step 2.7: Add round-trip test for token fields**

In `src/db.rs` at the bottom of the `#[cfg(test)] mod tests` block (near the other chat-message tests around line 1858), add:

```rust
#[test]
fn test_chat_message_tokens_round_trip() {
    let db = setup_db_with_workspace();
    let mut msg = make_chat_msg("mt1", "w1", ChatRole::Assistant, "hello");
    msg.input_tokens = Some(1234);
    msg.output_tokens = Some(56);
    msg.cache_read_tokens = Some(100_000);
    msg.cache_creation_tokens = Some(7_000);
    db.insert_chat_message(&msg).unwrap();

    let msgs = db.list_chat_messages("w1").unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].input_tokens, Some(1234));
    assert_eq!(msgs[0].output_tokens, Some(56));
    assert_eq!(msgs[0].cache_read_tokens, Some(100_000));
    assert_eq!(msgs[0].cache_creation_tokens, Some(7_000));
}

#[test]
fn test_chat_message_tokens_null_round_trip() {
    let db = setup_db_with_workspace();
    db.insert_chat_message(&make_chat_msg("mt2", "w1", ChatRole::Assistant, "hi"))
        .unwrap();

    let msgs = db.list_chat_messages("w1").unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].input_tokens, None);
    assert_eq!(msgs[0].output_tokens, None);
    assert_eq!(msgs[0].cache_read_tokens, None);
    assert_eq!(msgs[0].cache_creation_tokens, None);
}
```

- [ ] **Step 2.8: Run the full `claudette` test suite**

Run: `cargo test -p claudette`
Expected: all tests pass, including the two new round-trip tests. If any existing test breaks because `ChatMessage` construction needs new fields, add the four `None` fields to that literal.

- [ ] **Step 2.9: Run clippy**

Run: `cargo clippy -p claudette --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 2.10: Commit**

```bash
git add src/model/chat_message.rs src/db.rs
git commit -m "feat(db): add per-message token columns (migration v20)

Extend ChatMessage with input_tokens / output_tokens / cache_read_tokens /
cache_creation_tokens (all Option<i64>). SQLite migration v20 adds four
nullable INTEGER columns to chat_messages; insert/list/last-message queries
carry them through. Historical rows remain NULL.

Refs #300."
```

---

## Task 3: Rust — bridge task persists per-message usage from `MessageDelta`

**Files:**
- Modify: `src-tauri/src/commands/chat.rs` (bridge task inside the `tokio::spawn` at line 620)

- [ ] **Step 3.1: Add `latest_usage` state to the bridge task**

In `src-tauri/src/commands/chat.rs`, locate the `tokio::spawn(async move { ... })` bridge at line 620. Immediately after the existing `let mut pending_thinking: Option<String> = None;` (line 663), add:

```rust
// Tracks the most recent per-message usage observed on a MessageDelta
// event. Written into the next persisted assistant ChatMessage and reset
// to None after each persistence so per-message counts stay distinct
// across multi-message turns.
let mut latest_usage: Option<claudette::agent::TokenUsage> = None;
```

- [ ] **Step 3.2: Capture usage from `MessageDelta` events**

In the same bridge loop, add a new branch that updates `latest_usage` whenever a `MessageDelta` carries usage. Place it near the other `StreamEvent` handling branches. Insert this **after** the `AgentEvent::Stream(StreamEvent::Result { .. })` branch (around line 835) and **before** the `AgentEvent::ProcessExited(...)` branch:

```rust
// Track per-assistant-message cumulative usage as the CLI streams it.
// The final MessageDelta before message_stop carries the authoritative
// per-message total; we overwrite on every delta and consume it when the
// assistant message is persisted below.
if let AgentEvent::Stream(StreamEvent::Stream {
    event: claudette::agent::InnerStreamEvent::MessageDelta { usage: Some(u) },
}) = &event
{
    latest_usage = Some(u.clone());
}
```

Ensure the imports at the top of `src-tauri/src/commands/chat.rs` include `StreamEvent` and `InnerStreamEvent` already — if `StreamEvent` is imported via `claudette::agent::StreamEvent` and `InnerStreamEvent` is not, reference it fully-qualified as shown.

- [ ] **Step 3.3: Populate tokens on the persisted `ChatMessage`**

In the assistant-persist block at `src-tauri/src/commands/chat.rs:970-988`, replace the `ChatMessage { ... }` literal. After this change, `latest_usage` is consumed (set to `None`) so the next assistant message in the same turn starts fresh:

```rust
// Only save when we have text content — attach accumulated thinking.
if !full_text.trim().is_empty()
    && let Ok(db) = Database::open(&db_path)
{
    let msg_id = uuid::Uuid::new_v4().to_string();
    let taken_usage = latest_usage.take();
    let msg = ChatMessage {
        id: msg_id.clone(),
        workspace_id: ws_id.clone(),
        role: ChatRole::Assistant,
        content: full_text,
        cost_usd: None,
        duration_ms: None,
        created_at: now_iso(),
        thinking: pending_thinking.take(),
        input_tokens: taken_usage.as_ref().map(|u| u.input_tokens as i64),
        output_tokens: taken_usage.as_ref().map(|u| u.output_tokens as i64),
        cache_read_tokens: taken_usage
            .as_ref()
            .and_then(|u| u.cache_read_input_tokens.map(|n| n as i64)),
        cache_creation_tokens: taken_usage
            .as_ref()
            .and_then(|u| u.cache_creation_input_tokens.map(|n| n as i64)),
    };
    if db.insert_chat_message(&msg).is_ok() {
        last_assistant_msg_id = Some(msg_id);
    }
}
```

- [ ] **Step 3.4: Verify builds and no warnings**

Run: `cargo build -p claudette-tauri`
Expected: clean build.

Run: `cargo clippy -p claudette-tauri --all-targets -- -D warnings`
Expected: clean (note: CI does not lint claudette-tauri by default, but we lint locally to catch obvious issues).

If `cargo clippy -p claudette-tauri` fails locally due to missing system libs, skip it and rely on `cargo build -p claudette-tauri`.

- [ ] **Step 3.5: Commit**

```bash
git add src-tauri/src/commands/chat.rs
git commit -m "feat(chat): persist per-message token counts from stream deltas

Track the most recent MessageDelta usage in the bridge task and stamp it
onto the ChatMessage at insert time. latest_usage is consumed per message,
so multi-message turns (tool-use chains) get distinct per-message counts.
Result.usage is not persisted — it forwards live via the existing
AgentEvent Tauri emission for the frontend to consume.

Refs #300."
```

---

## Task 4: Frontend — extend `ChatMessage` TS type + fix all inline literals

**Files:**
- Modify: `src/ui/src/types/chat.ts`
- Modify: `src/ui/src/components/chat/ChatPanel.tsx`
- Modify: `src/ui/src/components/command-palette/CommandPalette.tsx`
- Modify: `src/ui/src/components/sidebar/Sidebar.tsx`
- Modify: `src/ui/src/components/modals/ConfirmSetupScriptModal.tsx`
- Modify: `src/ui/src/components/chat/planFilePath.test.ts`
- Modify: `src/ui/src/hooks/useAgentStream.ts`

- [ ] **Step 4.1: Extend the `ChatMessage` interface**

Replace the interface at `src/ui/src/types/chat.ts:3-12`:

```typescript
export interface ChatMessage {
  id: string;
  workspace_id: string;
  role: ChatRole;
  content: string;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  thinking: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
}
```

- [ ] **Step 4.2: Run typecheck to find every broken literal**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: errors at each `ChatMessage` literal that hasn't been extended (roughly: `ChatPanel.tsx:~560` and `~728`; `useAgentStream.ts:~256`; `CommandPalette.tsx:~119` and `~143` and `~154`; `Sidebar.tsx:~108` and `~132` and `~143`; `ConfirmSetupScriptModal.tsx:~39` and `~52`; `planFilePath.test.ts:~18`).

- [ ] **Step 4.3: Add four `null` fields to every inline literal**

For each location reported by tsc, add after the `thinking: null,` (or adjacent to it):

```typescript
input_tokens: null,
output_tokens: null,
cache_read_tokens: null,
cache_creation_tokens: null,
```

Apply the same change to every file listed in Step 4.2. If a literal uses compact single-line form (e.g. `cost_usd: null, duration_ms: null,`), match that style:

```typescript
cost_usd: null, duration_ms: null,
input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
```

- [ ] **Step 4.4: Rerun typecheck to verify green**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4.5: Run existing frontend tests**

Run: `cd src/ui && bun run test`
Expected: all pass.

- [ ] **Step 4.6: Commit**

```bash
git add src/ui/src/types/chat.ts src/ui/src/components src/ui/src/hooks
git commit -m "feat(ui): add per-message token fields to ChatMessage type

Extend the frontend ChatMessage interface with input_tokens / output_tokens /
cache_read_tokens / cache_creation_tokens (all nullable), mirroring the
Rust struct. Every inline ChatMessage literal now initializes the new
fields to null.

Refs #300."
```

---

## Task 5: Frontend — `formatTokens` utility + tests

**Files:**
- Create: `src/ui/src/components/chat/formatTokens.ts`
- Create: `src/ui/src/components/chat/formatTokens.test.ts`

- [ ] **Step 5.1: Write failing tests**

Create `src/ui/src/components/chat/formatTokens.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatTokens } from "./formatTokens";

describe("formatTokens", () => {
  it("renders values under 1000 as raw integers", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders 1000+ as a k-compact value with one decimal", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(9876)).toBe("9.9k");
    expect(formatTokens(10_000)).toBe("10.0k");
    expect(formatTokens(199_000)).toBe("199.0k");
  });

  it("floors truncation rather than rounding up", () => {
    // 1299 → 1.299k → "1.2k" (we want to avoid over-reporting)
    expect(formatTokens(1299)).toBe("1.2k");
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `cd src/ui && bun run test -- formatTokens`
Expected: FAIL — `formatTokens` not found.

- [ ] **Step 5.3: Implement `formatTokens`**

Create `src/ui/src/components/chat/formatTokens.ts`:

```typescript
/** Format a token count for compact display in chat metadata.
 *  Values under 1000 render as raw integers ("999"); values 1000+ render
 *  as a k-compact value with one decimal ("1.2k", "10.0k"). Truncation
 *  is always toward zero so we never over-report usage. */
export function formatTokens(n: number): string {
  if (n < 1000) {
    return `${n}`;
  }
  const tenths = Math.floor(n / 100) / 10;
  return `${tenths.toFixed(1)}k`;
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `cd src/ui && bun run test -- formatTokens`
Expected: 3 passed.

- [ ] **Step 5.5: Commit**

```bash
git add src/ui/src/components/chat/formatTokens.ts src/ui/src/components/chat/formatTokens.test.ts
git commit -m "feat(ui): add formatTokens utility with k-compact formatting

Pure helper that renders token counts as '999' (sub-1k) or '1.2k'
(1k+, one decimal, always truncates toward zero so we never over-report).
Will be used by the TurnFooter token readout and eventually the Phase 2
context meter.

Refs #300."
```

---

## Task 6: Frontend — extend `CompletedTurn` + `finalizeTurn` with token counts

**Files:**
- Modify: `src/ui/src/stores/useAppStore.ts`
- Modify: `src/ui/src/stores/useAppStore.test.ts`

- [ ] **Step 6.1: Write failing store test**

Append this test to `src/ui/src/stores/useAppStore.test.ts` (near other `finalizeTurn` tests if present; otherwise at the bottom of the file):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./useAppStore";

describe("finalizeTurn token counts", () => {
  beforeEach(() => {
    useAppStore.setState({
      completedTurns: {},
      toolActivities: {
        // finalizeTurn early-returns if toolActivities is empty, so seed one.
        ws1: [
          {
            toolUseId: "t1",
            toolName: "Bash",
            inputJson: "{}",
            resultText: "",
            collapsed: true,
            summary: "",
          },
        ],
      },
    });
  });

  it("records input/output tokens on the completed turn", () => {
    useAppStore.getState().finalizeTurn("ws1", 1, "turn-1", 1234, 1500, 240);
    const turns = useAppStore.getState().completedTurns.ws1 || [];
    expect(turns).toHaveLength(1);
    expect(turns[0].durationMs).toBe(1234);
    expect(turns[0].inputTokens).toBe(1500);
    expect(turns[0].outputTokens).toBe(240);
  });

  it("leaves token counts undefined when omitted", () => {
    useAppStore.getState().finalizeTurn("ws1", 1, "turn-2", 500);
    const turns = useAppStore.getState().completedTurns.ws1 || [];
    expect(turns).toHaveLength(1);
    expect(turns[0].inputTokens).toBeUndefined();
    expect(turns[0].outputTokens).toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `cd src/ui && bun run test -- useAppStore`
Expected: FAIL — type mismatch on `finalizeTurn` arity, or missing properties on `CompletedTurn`.

- [ ] **Step 6.3: Extend `CompletedTurn` interface**

In `src/ui/src/stores/useAppStore.ts`, replace the interface at lines 40-54 with:

```typescript
export interface CompletedTurn {
  id: string;
  activities: ToolActivity[];
  messageCount: number;
  collapsed: boolean;
  /** Index into chatMessages at the time of finalization — used to render
   *  the turn summary at the correct chronological position. */
  afterMessageIndex: number;
  /** Commit hash from the corresponding conversation checkpoint, if any.
   *  Used to gate the "fork workspace at this turn" action. */
  commitHash?: string | null;
  /** Total time this turn took, in milliseconds. Summed from the
   *  duration_ms of assistant messages produced during the turn. */
  durationMs?: number;
  /** Turn-total input tokens reported by the CLI on the `result` event.
   *  Undefined for legacy turns replayed from DB without token metadata. */
  inputTokens?: number;
  /** Turn-total output tokens reported by the CLI on the `result` event. */
  outputTokens?: number;
}
```

- [ ] **Step 6.4: Extend `finalizeTurn` signature**

In `src/ui/src/stores/useAppStore.ts`, update the interface signature at lines 121-126:

```typescript
finalizeTurn: (
  wsId: string,
  messageCount: number,
  turnId?: string,
  durationMs?: number,
  inputTokens?: number,
  outputTokens?: number,
) => void;
```

- [ ] **Step 6.5: Update the reducer**

In `src/ui/src/stores/useAppStore.ts`, update the reducer at line 570. Replace the whole function with:

```typescript
finalizeTurn: (wsId, messageCount, turnId, durationMs, inputTokens, outputTokens) =>
  set((s) => {
    const activities = s.toolActivities[wsId] || [];
    if (activities.length === 0) {
      debugChat("store", "finalizeTurn skipped", {
        wsId,
        messageCount,
        turnId: turnId ?? null,
        existingCompletedTurnIds: (s.completedTurns[wsId] || []).map(
          (turn) => turn.id,
        ),
      });
      return {};
    }
    const turn: CompletedTurn = {
      id: turnId ?? crypto.randomUUID(),
      activities: activities.map((a) => ({
        toolUseId: a.toolUseId,
        toolName: a.toolName,
        inputJson: a.inputJson,
        resultText: a.resultText,
        collapsed: true,
        summary: a.summary,
      })),
      messageCount,
      collapsed: true,
      afterMessageIndex: (s.chatMessages[wsId] || []).length,
      durationMs,
      inputTokens,
      outputTokens,
    };
    // … rest of the function body unchanged …
```

Leave the debugChat log and the returned state object as-is — only the signature, the parameter destructure, and the `turn` literal get extended.

- [ ] **Step 6.6: Run tests**

Run: `cd src/ui && bun run test -- useAppStore`
Expected: previous finalizeTurn tests still pass; the two new ones pass.

- [ ] **Step 6.7: Run typecheck**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6.8: Commit**

```bash
git add src/ui/src/stores/useAppStore.ts src/ui/src/stores/useAppStore.test.ts
git commit -m "feat(store): carry turn-total token counts on CompletedTurn

Extend CompletedTurn with optional inputTokens / outputTokens, extend
finalizeTurn's signature to accept them, and write them onto the turn
record. Missing values leave the fields undefined, so legacy turns
(replayed from DB without token metadata) render unchanged.

Refs #300."
```

---

## Task 7: Frontend — type the `usage` field and wire it into `finalizeTurn`

**Files:**
- Modify: `src/ui/src/types/agent-events.ts`
- Modify: `src/ui/src/hooks/useAgentStream.ts`

- [ ] **Step 7.1: Add `usage` to the Result TS variant**

In `src/ui/src/types/agent-events.ts`, replace the `result` variant (lines 15-21) with:

```typescript
  | {
      type: "result";
      subtype: string;
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
```

Leave the `message_delta` inner variant as-is for now — Phase 1's frontend doesn't read per-message-delta usage, only `Result.usage`. (Phase 2 will extend `message_delta` if it needs streaming context updates.)

- [ ] **Step 7.2: Update the `result` case handler**

In `src/ui/src/hooks/useAgentStream.ts` around line 272-288, replace the `finalizeTurn(...)` call with the extended 6-argument form:

```typescript
case "result": {
  debugChat("stream", "result", {
    wsId,
    checkpointId: turnCheckpointIdRef.current[wsId] ?? null,
    pendingMessageCount: turnMessageCountRef.current[wsId] || 0,
    pendingToolCount: (useAppStore.getState().toolActivities[wsId] || []).length,
  });
  finalizeTurn(
    wsId,
    turnMessageCountRef.current[wsId] || 0,
    turnCheckpointIdRef.current[wsId],
    streamEvent.duration_ms,
    streamEvent.usage?.input_tokens,
    streamEvent.usage?.output_tokens,
  );
  turnMessageCountRef.current[wsId] = 0;
  turnFinalizedRef.current[wsId] = true;
  updateWorkspace(wsId, { agent_status: "Idle" });
  break;
}
```

- [ ] **Step 7.3: Run typecheck**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7.4: Run tests**

Run: `cd src/ui && bun run test`
Expected: all pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/ui/src/types/agent-events.ts src/ui/src/hooks/useAgentStream.ts
git commit -m "feat(chat): pass Result.usage into finalizeTurn

When the result event fires, forward the CLI's turn-total input_tokens
and output_tokens from usage into finalizeTurn, so the CompletedTurn
records the counts alongside durationMs.

Refs #300."
```

---

## Task 8: Frontend — render tokens in `TurnFooter`

**Files:**
- Modify: `src/ui/src/components/chat/ChatPanel.tsx` (TurnFooter props + render; caller at ~line 1148)
- Modify: `src/ui/src/components/chat/ChatPanel.module.css` (new `.turnFooterTokens` class)

- [ ] **Step 8.1: Add a style for the token segment**

In `src/ui/src/components/chat/ChatPanel.module.css`, find the existing `.turnFooterElapsed` rule (search for that exact class name). Immediately after it, add:

```css
.turnFooterTokens {
  composes: turnFooterElapsed;
  /* Tokens are a sibling of elapsed time; reuse the same muted treatment. */
}
```

If CSS Modules `composes:` is not used elsewhere in this file, instead duplicate whatever properties `.turnFooterElapsed` has into `.turnFooterTokens` to match the visual treatment. Verify by inspecting the class after this step.

- [ ] **Step 8.2: Extend `TurnFooter` props and render**

In `src/ui/src/components/chat/ChatPanel.tsx`:

First, add the import for `formatTokens` near the existing imports at the top of the file (e.g. alongside the `SPINNER_FRAMES` import):

```typescript
import { formatTokens } from "./formatTokens";
```

Next, extend the `TurnFooter` function signature (line 1161-1171) to accept token props:

```typescript
function TurnFooter({
  durationMs,
  inputTokens,
  outputTokens,
  assistantText,
  onFork,
  onRollback,
}: {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  assistantText?: string;
  onFork?: () => void;
  onRollback?: () => void;
}) {
```

Then, extend the `elapsedNode` block (line 1209-1214) to emit a tokens node as well. Replace those lines with:

```typescript
const tokensNode =
  typeof inputTokens === "number" && typeof outputTokens === "number" ? (
    <span key="tokens" className={styles.turnFooterTokens}>
      {formatTokens(inputTokens)} in · {formatTokens(outputTokens)} out
    </span>
  ) : null;

const elapsedNode =
  typeof durationMs === "number" && durationMs > 0 ? (
    <span key="elapsed" className={styles.turnFooterElapsed}>
      {formatDurationMs(durationMs)}
    </span>
  ) : null;
```

Finally, find the JSX that renders `elapsedNode` inside `TurnFooter`'s return (search forward from line 1214 for `elapsedNode`). Render `tokensNode` immediately **before** `elapsedNode` in the same container.

- [ ] **Step 8.3: Extend `showFooter` gate and pass tokens from the caller**

In the turn-summary wrapper around line 1091-1095:

```typescript
const hasElapsed = typeof turn.durationMs === "number" && turn.durationMs > 0;
const hasTokens =
  typeof turn.inputTokens === "number" && typeof turn.outputTokens === "number";
const hasCopy = assistantText.length > 0;
const hasFork = !!onFork;
const hasRollback = !!onRollback;
const showFooter = hasElapsed || hasTokens || hasCopy || hasFork || hasRollback;
```

Then at line 1148, pass `inputTokens` / `outputTokens` to `TurnFooter`:

```typescript
{showFooter && (
  <TurnFooter
    durationMs={turn.durationMs}
    inputTokens={turn.inputTokens}
    outputTokens={turn.outputTokens}
    assistantText={hasCopy ? assistantText : undefined}
    onFork={onFork}
    onRollback={onRollback}
  />
)}
```

- [ ] **Step 8.4: Run typecheck and tests**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: exit 0, no output.

Run: `cd src/ui && bun run test`
Expected: all pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/ui/src/components/chat/ChatPanel.tsx src/ui/src/components/chat/ChatPanel.module.css
git commit -m "feat(chat): show token counts in TurnFooter

Render '1.2k in · 240 out' before the elapsed-time segment in TurnFooter
when the completed turn has token counts. Legacy turns with no counts
render exactly as before. Gating on both inputTokens and outputTokens
means a turn shows the full pair or nothing.

Refs #300."
```

---

## Task 9: Final verification

**Files:** (none modified; verification pass)

- [ ] **Step 9.1: Rust tests + lint + fmt**

Run: `cargo test --all-features`
Expected: all pass (including the five new `token_usage_tests` and the two new chat-message round-trip tests).

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean (CI only lints `claudette` and `claudette-server`, but fix anything clippy flags in `claudette-tauri` locally if possible).

Run: `cargo fmt --all --check`
Expected: clean; if it complains, run `cargo fmt --all` and amend.

- [ ] **Step 9.2: Frontend typecheck, tests, build**

Run: `cd src/ui && bunx tsc --noEmit`
Expected: exit 0.

Run: `cd src/ui && bun run test`
Expected: all pass (including the new `formatTokens` suite and the extended `useAppStore` `finalizeTurn` tokens tests).

Run: `cd src/ui && bun run build`
Expected: completes without errors.

- [ ] **Step 9.3: Manual UAT via `cargo tauri dev` (dev build)**

Start: `cargo tauri dev` (backgrounded)

In the running app:
1. Open an existing workspace — confirm historical turns still render and show duration without tokens.
2. Send a new prompt that produces a short reply. When the turn completes, confirm the `TurnFooter` shows `Nk in · N out · Xs` (or `N in · N out · Xs` for sub-1k values).
3. Open SQLite DB (whatever default location `Database::open` uses — check `~/.config/claudette/` or platform equivalent) and `SELECT id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM chat_messages ORDER BY created_at DESC LIMIT 5;` — verify recent assistant messages carry non-NULL values.
4. Exit and restart the app — confirm the DB schema stays at v20 (`PRAGMA user_version;`) and no re-migration runs.

If the `/claudette-debug` skill is available, use it for steps 1-3 instead of manual SQL — inspect the store's `completedTurns` slice and confirm `inputTokens`/`outputTokens` are populated on the latest turn.

- [ ] **Step 9.4: Confirm branch is ready for PR**

Run: `git log --oneline main..HEAD`
Expected: spec commit + 8 task commits (Tasks 1-8), matching the conventional commit style of the surrounding repo.

---

## Out of scope (reminder)

Phase 2 (context meter) and Phase 3 (compaction) are separate PRs and are explicitly not addressed by this plan. The persisted per-message cache_read_tokens and cache_creation_tokens fields land in Phase 1 but are not visually surfaced until Phase 2.

## Success criteria recap

1. After merge, a new assistant turn renders `1.2k in · 240 out · 45s` in its `TurnFooter`.
2. Historical turns (pre-migration) render exactly as they did before — no regression.
3. `chat_messages` rows for new messages carry non-NULL `input_tokens` / `output_tokens`.
4. `PRAGMA user_version` is 20 after migration on any existing database.
5. All tests pass: `cargo test --all-features`, `cd src/ui && bun run test`.
6. Type check clean: `cd src/ui && bunx tsc --noEmit`.
7. Clippy clean: `cargo clippy --workspace --all-targets -- -D warnings`.
