-- env-direnv plugin for Claudette.
--
-- Activates direnv-managed environment for workspace subprocesses.
-- Detects when a `.envrc` file exists in the worktree root. On export,
-- runs `direnv export json` (which returns `{VAR: "value" | null}`) and
-- forwards that straight to the dispatcher.
--
-- Known limitation: we watch `.envrc` for mtime changes but NOT the
-- files direnv itself watches via `DIRENV_WATCHES`. If your `.envrc`
-- sources another file that changes, edit `.envrc` (or run
-- `direnv reload` then re-evaluate via the UI) to force a refresh.

local M = {}

local function join(dir, name)
    return dir .. "/" .. name
end

function M.detect(args)
    return host.file_exists(join(args.worktree, ".envrc"))
end

function M.export(args)
    local result = host.exec("direnv", { "export", "json" })
    if result.code ~= 0 then
        -- Non-zero exit from `direnv export json` usually means the
        -- `.envrc` hasn't been allowed yet. Propagate the stderr so the
        -- UI can surface a "run direnv allow" hint.
        error("direnv export failed: " .. (result.stderr or result.stdout or "unknown error"))
    end

    -- Empty stdout = no vars to export (e.g. `.envrc` exists but is
    -- empty, or direnv is silently allowing without any exports).
    local env_map = {}
    if result.stdout and #result.stdout > 0 then
        env_map = host.json_decode(result.stdout)
    end

    return {
        env = env_map,
        watched = { join(args.worktree, ".envrc") },
    }
end

return M
