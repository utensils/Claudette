# TDD: Native slash commands `/init`, `/help`, `/compact`, `/context`, `/files`, `/cost`

**Scope:** Implementation plan for GitHub issues [#245](https://github.com/utensils/claudette/issues/245) and [#246](https://github.com/utensils/claudette/issues/246) on top of the native slash command framework that landed in PR #248 (issue #241).

**Status:** partially implemented — #245 (`/help`, `/init`) shipped in this branch; #246 (`/compact`, `/context`, `/files`, `/cost`) remains planned.

**Related:** #247 (tracker). #241-#244 merged. This doc finishes the slash command parity cluster.

---

## 1. Context

PR #248 introduced a UI-side registry (`NATIVE_HANDLERS`) and Rust-side registry (`native_command_registry`) with three command kinds:

| Kind | Behavior | Example |
|---|---|---|
| `LocalAction` | UI-only state mutation, renders a local message via `ctx.addLocalMessage(...)` | `/status`, `/clear`, `/version` |
| `SettingsRoute` | Calls `ctx.openSettings(section)` to open the existing settings surface | `/config`, `/usage` |
| `PromptExpansion` | Rewrites the chat input into a seeded prompt, then flows through `sendChatMessage` | `/review`, `/security-review`, `/pr-comments` |

Each handler returns `NativeCommandResult` (`{ kind: "handled" | "expand" | "skipped", ... }`). `ChatPanel.handleSend` intercepts slash input at `src/ui/src/components/chat/ChatPanel.tsx:437-657`, resolves via `resolveNativeHandler`, and dispatches. Usage is recorded under the canonical name via `recordSlashCommandUsage` (`ChatPanel.tsx:646-649`).

### What's currently registered

`/plugin`, `/marketplace`, `/review`, `/security-review`, `/pr-comments`, `/config`, `/usage`, `/extra-usage`, `/release-notes`, `/version`, `/clear`, `/plan`, `/model`, `/permissions`, `/status`, `/help`, `/init` — all from `nativeSlashCommands.ts` `NATIVE_HANDLERS` array and `slash_commands.rs` `native_command_registry`. The last two (`/help`, `/init`) ship in this branch.

### Frontend dependencies that need **no new infrastructure**

- Per-message `cost_usd` and `duration_ms` already exist in `chat_messages` (`src/db.rs:106-120`), populated from the CLI `result` event's `total_cost_usd` (`src/agent.rs:35-44`, capture at `src-tauri/src/commands/chat.rs:779-791`).
- `list_workspace_files` already enumerates worktree files via `git ls-files --cached --others --exclude-standard` (`src-tauri/src/commands/files.rs:32-93`, capped at 10,000).
- `load_attachments_for_workspace` enumerates stored image/PDF attachments (`src-tauri/src/commands/chat.rs:1198`).
- `load_chat_history` returns full message history (`src-tauri/src/commands/chat.rs:52-59`, ordered by `created_at, rowid`).
- Checkpoints + file snapshots already support rollback (`src/db.rs:214-226`, `src-tauri/src/commands/chat.rs:956-985`).
- `get_claude_code_usage` returns **org-level** 5-hour / 7-day rolling windows from claude.ai (`src-tauri/src/usage.rs:77-83`).

### Gaps that need new code

- No session-level cost aggregation (must sum per-message `cost_usd`).
- No existing compaction/summarization logic anywhere (`grep`: zero hits for "compact", "summariz*").
- No `AsyncBackendAction` kind in the framework yet (needed for `/compact`).
- No CLAUDE.md handling (Claudette today reads custom instructions only from `.claudette.json`, `src/config.rs:28-41`).

---

## 2. Issue #245 — `/init` and `/help`

### 2.1 `/help`

**Kind:** `LocalAction` (pure UI, reads the registry, renders a multi-line message).

**Rationale:** The slash picker at `SlashCommandPicker.tsx:11-40` already surfaces `name`, `description`, `argument_hint`, and `aliases` from the same `SlashCommand[]` list. `/help` must consume the same list so the two surfaces cannot drift — which is exactly the acceptance criterion in the issue.

**Data source:** `listSlashCommands()` from `services/tauri.ts` (already called elsewhere), or the in-memory list that the picker is currently bound to. Do NOT enumerate `NATIVE_HANDLERS` directly — that would miss file-based commands (project, user, plugin) and defeat the point.

**Output format (chat-rendered as markdown via `ctx.addLocalMessage`):**

```
**Native slash commands**

/clear — Clear the current workspace conversation
/model [id] — Show or change the workspace model
/permissions [mode]  (alias: /allowed-tools) — Show or change permission mode
/status — Show a summary of the current workspace
... (grouped by kind in this order: LocalAction, SettingsRoute, PromptExpansion)

**File-based commands**

/<name> — <description>  (project)
/<name> — <description>  (user)
/<name> — <description>  (plugin: <plugin-name>)
```

**Grouping:** Use `SlashCommand.kind` for native; `SlashCommand.source` for file-based (`project`, `user`, `plugin`). Skip `builtin` in the second section since those are already in the first.

**Aliases:** render inline as `(alias: /x, /y)` when `aliases.length > 0`.

**Argument hint:** append `[hint]` after the command name when present (matches picker formatting).

**Arguments:** none. Optional future: `/help <name>` to deep-dive a single command. Out of scope for first pass.

**No new backend handlers/Tauri commands** — behavior is UI-driven, but a registry entry is still added in `slash_commands.rs` so `list_slash_commands` and the picker include it alongside the UI-side handler in `nativeSlashCommands.ts`.

### 2.2 `/init`

**Kind:** `PromptExpansion`.

**Rationale:** The issue explicitly says prefer "a prompt-driven implementation through the normal agent pipeline rather than a bespoke Tauri wizard." Expansion kind seeds a prompt, then `handleSend` replaces `trimmed` with the expanded text and falls through to `sendChatMessage` — same path `/review` already uses (`ChatPanel.tsx:651-656`).

**Context available to the handler:** `NativeCommandContext` already exposes `repository: { name, path }`, `workspace: { branch, worktreePath }`, `repoDefaultBranch`. No new plumbing needed (`nativeSlashCommands.ts:24-67`).

**Seeded prompt template (single-line in code, shown formatted here):**

> Bootstrap project guidance for this repository. Inspect the codebase layout, primary languages and frameworks, build/test commands, and key architectural patterns. Then produce or update a repo-level `CLAUDE.md` at the repo root with: project summary, build and test commands (as copy-paste shell snippets), code style / linting / formatting conventions the repo uses, commit conventions, architecture overview (crates/modules and what they do), project structure tree, guidelines for new code, and a "debugging" section if the repo has non-trivial debug tooling. If a `CLAUDE.md` already exists, merge new findings rather than overwriting — preserve existing guidance. If the repo uses `.claudette.json` for instructions, cross-reference the two and keep them consistent. Make the file useful for a future agent who has never seen this codebase. Do not commit or push — only write the file.
>
> Current repo: `{repository.name}` at `{repository.path}`
> Current branch: `{workspace.branch}` (default: `{repoDefaultBranch}`)

**Arguments:** `/init` accepts optional free-form args that get appended to the seeded prompt as `Additional guidance: {args}`. Lets the user request emphasis (e.g. `/init focus on the Tauri command surface`) without re-typing the whole prompt.

**`CLAUDE.md` vs `.claudette.json`:** Claudette currently reads custom instructions from `.claudette.json` (`src/config.rs:28-41`, `src-tauri/src/commands/chat.rs:204-213`). `CLAUDE.md` is the Claude Code convention. The seeded prompt targets `CLAUDE.md` (matches CLI parity + existing repo pattern — the Claudette repo itself has one), and notes `.claudette.json` as the place the app actually reads at runtime.

**No new backend handlers/Tauri commands** — the prompt flows through the existing `sendChatMessage` pipeline. A registry entry is still added in `slash_commands.rs` so the picker lists `/init`.

### 2.3 Registry entries (`src/slash_commands.rs:57-186`)

```rust
SlashCommand {
    name: "help",
    description: "List available slash commands",
    source: "builtin",
    aliases: vec![],
    argument_hint: None,
    kind: Some(NativeKind::LocalAction),
},
SlashCommand {
    name: "init",
    description: "Bootstrap repo guidance (CLAUDE.md) via the agent",
    source: "builtin",
    aliases: vec![],
    argument_hint: Some("[extra guidance]".into()),
    kind: Some(NativeKind::PromptExpansion),
},
```

### 2.4 Test coverage for #245

In `nativeSlashCommands.test.ts`:

- `/help` renders all registered native commands grouped by kind, in the stated order.
- `/help` includes aliases formatted as `(alias: /x)` when present.
- `/help` includes argument hints when present.
- `/help` includes file-based commands grouped by source (project/user/plugin) with the plugin name.
- `/help` excludes `builtin` from the file-based section.
- `/help` surface uses the SAME data source as the picker (mock `listSlashCommands`, assert it's called — no duplicated registry list).
- `/help` resolves by canonical name only (no aliases defined).
- `/init` with no args produces a prompt containing repo name, path, branch, and the CLAUDE.md-producing directive.
- `/init` with args appends them under "Additional guidance: ...".
- `/init` returns `{ kind: "expand" }` so `handleSend` rewrites trimmed and falls through to `sendChatMessage`.
- `/init` does NOT add a local message (it's expansion, not local).

In `SlashCommandPicker.test.ts`:

- `/help` and `/init` appear in the picker when typing `/` with matching prefix.

Rust side (`src/slash_commands.rs` test module):

- `native_command_registry` includes `help` with `kind = LocalAction`.
- `native_command_registry` includes `init` with `kind = PromptExpansion` and `argument_hint = Some(...)`.

---

## 3. Issue #246 — `/compact`, `/context`, `/files`, `/cost`

This is the "product work, not just wiring" group. Each command below first **defines Claudette-specific semantics** (the issue's explicit acceptance criterion), then describes the implementation.

### 3.1 `/compact` — conversation summarization

#### Product definition

> Compaction replaces the current workspace's message history with an agent-authored summary that preserves enough continuity for the session to keep working productively, while reducing future turn input size. Before the mutation, Claudette creates a reversible checkpoint so the user can undo via the existing rollback path.

Explicit non-behaviors:

- **Not `/clear`.** `/clear` deletes; `/compact` preserves a summary.
- **Not silent.** Compaction emits a visible system message in chat with the summary and a "view full history" affordance (existing rollback flow).
- **Always rollbackable.** Rollback uses the existing checkpoint mechanism (`src-tauri/src/commands/chat.rs:956-985`), which already supports file + message state restore.

#### Semantics (first-pass)

1. **User types** `/compact` (optional free-form arg: custom summarization instructions).
2. **Handler calls new Tauri command** `compact_conversation(workspace_id, extra_instructions)`.
3. **Rust side:**
   - Load full history (`db.list_chat_messages(workspace_id)`).
   - Create a checkpoint anchored to the LAST existing message, with `has_file_state: false` (compaction is message-only; file state not relevant). This is the undo point.
   - Run a one-shot agent turn with a summarization prompt + full history as the user turn. Capture the summary text.
   - Transactionally: delete all existing messages, insert a single system message with the summary + `cost_usd` from the summarization turn + a marker (e.g. `content` prefixed with `"[compact summary]\n"` or new `role` variant — see open question).
   - Return `{ summary_message_id, checkpoint_id, messages_replaced: N }`.
4. **Frontend**:
   - Reloads chat history (already happens via event).
   - Renders the system message as normal (the marker lets the UI optionally style it differently — **out of scope for first pass**, plain system message is fine).
   - Shows a local confirmation: `"Compacted N messages into a summary. Use the checkpoint menu to restore."`

#### Open question — how to run the summarization turn

Two options:

- **(A)** Kick off a full `send_chat_message`-style turn with a `compact` flag, but suppress normal user-message insertion. Pros: reuses agent plumbing. Cons: invasive to `send_chat_message`.
- **(B)** New standalone path `run_oneshot_prompt(workspace_id, prompt)` that spawns the agent, collects streamed output, returns result. Pros: clean separation. Cons: parallel code.

**Recommendation:** (B) — keeping compaction out of `send_chat_message` avoids regressions in the normal path, and a oneshot helper is likely useful for other future commands (`/security-review` background runs, etc.).

#### Test coverage

- Compacting with history > 1 creates a checkpoint and replaces messages with a single summary message.
- Compaction failure (agent error) leaves history untouched — no partial state.
- Compacting an empty conversation returns a no-op result (`messages_replaced: 0`).
- Rollback of the post-compact checkpoint restores the pre-compact message count.
- `/compact extra text` passes `extra text` to the summarization prompt as additional instructions.
- Summary message's `cost_usd` is populated from the oneshot turn.

### 3.2 `/context` — current context report

#### Product definition

> `/context` reports what Claudette considers the active workspace's current conversational context: a scoped set of state Claudette can report authoritatively from its own DB and filesystem, without pretending to mirror the underlying agent's token window.

Scope (explicitly NOT the agent's view):

| Field | Source | Notes |
|---|---|---|
| Workspace name | `ws.display_name` | From `workspaces` table |
| Branch | `ws.branch_name` | |
| Worktree path | `ws.worktree_path` | |
| Repository | `repo.name`, `repo.path` | |
| Messages in history | `COUNT(*) FROM chat_messages WHERE workspace_id = ?` | New query; alternatively client-side count from `load_chat_history()` |
| Attachments | `load_attachments_for_workspace(workspace_id).len()` | |
| Checkpoints | `COUNT(*) FROM checkpoints WHERE workspace_id = ?` | New query or client-side |
| Active plan file | Check `{worktree_path}/.claude/plans/*.md` exists | Filesystem check; plan state is file-based (`src-tauri/src/commands/plan.rs`) |
| Session cost (sum) | `SUM(cost_usd) FROM chat_messages WHERE workspace_id = ?` | See `/cost` |
| Plan mode | `ctx.planMode` | UI state |
| Permission mode | `ctx.permissionLevel` | UI state |
| Model | `ctx.selectedModel` | UI state |

Explicitly NOT included in first pass: per-message token counts, agent-side context window utilization, "files the agent has read this session" — Claudette can't observe those reliably.

#### Kind

`LocalAction`. Handler calls a new Tauri command `get_session_context(workspace_id)` that returns the DB/FS-derived fields, combines with UI state from `ctx`, and renders via `addLocalMessage`.

#### Output (multi-line, markdown-rendered)

```
**Workspace context**

Repo:        claudette (/Users/.../Claudette)
Branch:      main (default: main)
Worktree:    /Users/.../Claudette
Messages:    47
Attachments: 3
Checkpoints: 12
Plan file:   .claude/plans/refactor.md
Session cost: $0.84

Model:       claude-opus-4-7
Permissions: default
Plan mode:   off
```

Field omitted if unavailable (e.g. no plan file → skip that line).

#### Test coverage

- `get_session_context` returns correct counts against a seeded in-memory DB.
- Absent plan file → field omitted in render.
- Zero messages → "Messages: 0", no cost line (or "Session cost: $0.00").
- Renders via `addLocalMessage` not `sendChatMessage`.

### 3.3 `/files` — files in context

#### Product definition

> `/files` reports two categories of files Claudette can enumerate authoritatively: **attachments** stored in the DB, and **@-mentions** extracted from the persisted message history by regex. This is explicitly narrower than "everything the agent has read" — Claudette doesn't track agent-side file reads.

The issue explicitly allows this scope: "A reasonable first pass may be limited to the files Claudette already tracks directly, such as mentioned files and attachments, rather than claiming to expose the full underlying agent context."

#### Data sources

- **Attachments:** `load_attachments_for_workspace(workspace_id)` returns `Vec<Attachment>` with `filename`, `media_type`, `size_bytes`, `created_at` (`src/model/attachment.rs`).
- **@-mentions:** extract from `chat_messages.content` via regex. `send_chat_message` expands mentions inline into content (`src-tauri/src/commands/chat.rs:292-297`), so post-expansion the `@path` text remains in the stored content. Regex `@([\w.\-/]+)` over user-role messages; dedupe preserving first-occurrence order.

#### Kind

`LocalAction`. Handler calls new Tauri command `get_session_files(workspace_id)` that returns `{ attachments: Vec<AttachmentSummary>, mentioned: Vec<String> }`.

#### Output

```
**Files in this conversation**

Attachments (3):
  screenshot.png  (image/png, 124 KB)
  debug.log       (text/plain, 8 KB)
  design.pdf      (application/pdf, 2.1 MB)

Mentioned (5):
  src/ui/src/components/chat/ChatPanel.tsx
  src/slash_commands.rs
  docs/mcp-detection-tdd.md
  CLAUDE.md
  .claudette.json
```

Empty categories omitted.

#### Arguments (future, out of first-pass scope)

- `/files workspace` — list worktree files from `list_workspace_files()`. Out of scope for first pass because the acceptance criterion explicitly warns against claiming agent-context coverage.

#### Test coverage

- `get_session_files` returns attachment summaries with media type and byte size.
- `get_session_files` extracts unique `@paths` from user-role messages in order.
- Non-user messages (assistant, system) are not scanned for mentions.
- Regex correctly extracts nested paths (`@src/ui/x.tsx`), stops at whitespace/punctuation.
- Empty workspace → `/files` renders `"No attachments or mentioned files in this conversation."`.

### 3.4 `/cost` — session cost

#### Product definition

> `/cost` reports two independent facts Claudette can answer reliably: **session cost** (sum of `cost_usd` across stored assistant messages in the active workspace) and **org-level rolling usage** (from the existing `get_claude_code_usage` claude.ai API, not per-session).

Explicit honesty: these are different scopes. Session cost comes from CLI `total_cost_usd` attached per turn. Org usage is a separate rolling window shared across all Claude Code sessions and subscriptions.

#### Kind

`LocalAction`. Handler calls new Tauri command `get_session_cost(workspace_id)` returning `{ total_usd, turn_count, messages_with_cost }`. Separately calls existing `get_claude_code_usage()` for org numbers.

#### Output

```
**This workspace**

Session cost:  $0.84
Turns:         12
Messages with cost: 12 of 24

**Org usage (claude.ai)**

5-hour window:  42% utilized (resets in 2h 14m)
7-day window:   18% utilized (resets in 4d 8h)
  Sonnet:       14%
  Opus:         21%
```

If `get_claude_code_usage` fails (unauthenticated, offline, etc.), the org section becomes `"Org usage unavailable: <reason>"`. The session section always works (it's a local SQL query).

#### Test coverage

- `get_session_cost` sums `cost_usd` across assistant messages, ignores nulls.
- `get_session_cost` reports `messages_with_cost` as the count of non-null `cost_usd` rows.
- Empty workspace → `total_usd: 0`, `turn_count: 0`.
- Handler falls back gracefully when `get_claude_code_usage` errors (renders session data, error line for org).
- Handler does not render zero-value org fields when API returns partial data.

### 3.5 Framework changes needed

Add `NativeKind::AsyncBackendAction` variant in `src/slash_commands.rs:7-18` so `/compact`, `/context`, `/files`, `/cost` can be distinguished in the picker from pure UI `LocalAction` commands. Frontend-side `NativeCommandResult` already supports async (`Promise<NativeCommandResult>` return type, `nativeSlashCommands.ts:69-82`), so no TS framework change — only the registry tagging.

Alternative: keep them as `LocalAction` since the UI handler *is* local (it just calls a Tauri command). This is simpler and matches how `/status` works (it's LocalAction but reads UI state that came from the backend). **Recommendation:** stick with `LocalAction`. No framework change needed.

### 3.6 New Tauri commands (signatures)

```rust
// src-tauri/src/commands/chat.rs or new compact.rs
#[tauri::command]
async fn compact_conversation(
    workspace_id: String,
    extra_instructions: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CompactResult, String>;

#[tauri::command]
async fn get_session_context(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<SessionContext, String>;

#[tauri::command]
async fn get_session_files(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<SessionFiles, String>;

#[tauri::command]
async fn get_session_cost(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<SessionCost, String>;
```

Types live in `src/model/session.rs` (new file) — `Serialize`-derived structs with fields from the tables above.

### 3.7 New DB methods

- `Database::count_chat_messages(workspace_id) -> Result<i64>`
- `Database::count_checkpoints(workspace_id) -> Result<i64>`
- `Database::sum_session_cost(workspace_id) -> Result<(f64, i64, i64)>` — returns `(total_usd, turns_with_cost, total_turns)`
- `Database::list_user_message_contents(workspace_id) -> Result<Vec<String>>` — for `/files` @-mention extraction

All use the existing `Database::open(&state.db_path)` pattern per Tauri command.

---

## 4. Sequencing

Recommended order within #246:

1. **Framework: confirm no changes needed** — validate that `LocalAction` is enough for async backend calls by looking at `/status` handler (it already awaits `ctx` state). Expected: confirmed, no framework change.
2. **`/cost`** — smallest; pure read, reuses `get_claude_code_usage`, only new work is `sum_session_cost` DB method.
3. **`/files`** — pure read, attachment listing exists, regex extraction is small.
4. **`/context`** — pure read, aggregates everything from #2-3 plus counts.
5. **`/compact`** — the large one; requires the oneshot-prompt helper plus checkpoint-before-mutation. Should land in its own PR.

#245 (`/help`, `/init`) is independent of #246 and can land in parallel. Do it first if the goal is to maximize visible parity quickly — `/help` is trivial and makes the rest of the command surface discoverable.

---

## 5. Acceptance criteria (summary, checked against issue text)

### #245

- [x] `/init` resolves locally — `PromptExpansion` handler, no raw slash sent to agent.
- [x] `/init` uses current workspace context automatically — `NativeCommandContext` provides repo + branch + worktree.
- [x] `/init` goes through the normal agent pipeline — `expand` result falls through to `sendChatMessage`.
- [x] `/help` generated from the same registry that powers the picker — consumes `listSlashCommands()`, not a hand-maintained list.
- [x] `/help` includes aliases and argument hints — formatted inline per-entry.
- [x] Both discoverable in slash picker — via registry entries in `slash_commands.rs`.

### #246

- [x] Claudette-specific semantics documented for each command — §3.1-3.4.
- [x] Native registry entries — one each in `nativeSlashCommands.ts` and `slash_commands.rs`.
- [x] `/compact` is not a renamed `/clear` — creates checkpoint, produces summary, preserves continuity (§3.1).
- [x] `/context` and `/files` report data Claudette can justify — §3.2 and §3.3 explicitly scope to DB + FS facts.
- [x] `/cost` only reports reliable data — session sum from DB, org from existing API, handles API failure.

---

## 6. Open questions

1. **Compaction summary message role.** Store the summary as `role = 'system'` (existing variant) or introduce a new role/marker? Recommendation: use existing `system` role with a content prefix marker (`[compact summary]`) so the UI can optionally style it without a schema change.
2. **Compaction cost attribution.** The oneshot summarization turn itself costs tokens. Store its `cost_usd` on the summary message so `/cost` and `/context` naturally include it — not separately accounted.
3. **`/help` surface form.** Chat message (local) vs. modal. First pass: chat message, consistent with `/status`. If the list gets unwieldy with many file-based plugin commands, revisit.
4. **`/init` and existing CLAUDE.md.** Seeded prompt should instruct the agent to merge, not overwrite. Left to the agent's judgment; acceptable given the prompt-driven approach.
5. **Attachment size formatting.** `format_size(size_bytes)` helper — pull in existing one if any, otherwise trivial KB/MB formatter.

---

## 7. Not in scope

- Agent-side context window tracking (Claudette can't observe this).
- Multi-workspace cost aggregation (`/cost all` or similar).
- `/compact` with selective message retention (keep last N turns verbatim + summarize rest).
- Full command-detail surface (`/help /compact` deep-dive).
- `/files workspace` expansion to full worktree tree.
- UI for compaction-summary styling distinct from normal system messages.
