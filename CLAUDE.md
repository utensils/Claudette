# Claudette

Cross-platform desktop orchestrator for parallel Claude Code agents, built with Rust and Iced.

## Build & test commands

```bash
cargo run                    # Build and run (debug)
cargo build --release        # Optimized release binary
cargo test --all-features    # Run all tests
cargo clippy --all-targets --all-features  # Lint (must pass with zero warnings)
cargo fmt --all --check      # Check formatting
```

IMPORTANT: CI sets `RUSTFLAGS="-Dwarnings"` — all compiler warnings are errors. Fix warnings before committing.

## Code style

- Rust edition 2024 — use modern idioms (`let chains`, `gen blocks` if stabilized, etc.)
- Default `rustfmt` and `clippy` rules — no custom overrides
- Prefer `cargo fmt` before committing; CI enforces it

## Commit conventions

- **Conventional commits required** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`, etc.
- Header max 100 characters
- PR titles must also follow conventional commit format (validated by CI)
- Release management is automated via release-please

## Architecture

- **GUI**: Iced 0.14 (Elm architecture — `Message` enum, `update()`, `view()`)
- **Async runtime**: Iced's built-in executor (backed by futures); Tokio planned for process management
- **Data persistence**: SQLite via rusqlite (planned)
- **Git operations**: git2 + shelling to `git` for worktree ops (planned)
- **Terminal emulation**: libghostty integration planned (blocked on library stabilization; requires Zig toolchain)

When adding new features, follow the Iced/Elm pattern: define messages in the `Message` enum, handle them in `update()`, render in `view()`.

## Project context

- See GitHub Issue #5 for the full MVP PRD
- P0 features: workspace management, agent chat, diff viewer, integrated terminal, checkpoints, git/GitHub integration, scripts, repo settings
- Target platforms: macOS (Apple Silicon + Intel) and Linux (x86_64, Wayland + X11)

## Dependencies

- Add dependencies conservatively — binary size target is < 30 MB
- Cold start target is < 2 seconds to interactive UI
- When choosing crates, prefer well-maintained options with minimal transitive dependencies
