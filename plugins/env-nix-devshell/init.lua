-- env-nix-devshell plugin for Claudette.
--
-- Activates a Nix devshell for users who keep their toolchain in a
-- `flake.nix` (or legacy `shell.nix`) *without* the direnv wrapper.
--
-- Detection policy: only activate when NO `.envrc` is present. If
-- direnv is in play, it already wraps the flake (via `use flake` in
-- `.envrc`), and the `env-direnv` plugin wins on precedence. We stay
-- out of its way to avoid evaluating the flake twice.
--
-- Export: runs `nix print-dev-env --json` which emits
-- `{ variables: { NAME: { type, value } } }`. We keep only
-- `exported`/`var`-typed string values — array and associative types
-- (Bash-specific) don't round-trip cleanly to a child process env.

local M = {}

local function join(dir, name)
    return dir .. "/" .. name
end

function M.detect(args)
    -- direnv wraps the flake — let env-direnv handle it.
    if host.file_exists(join(args.worktree, ".envrc")) then
        return false
    end
    return host.file_exists(join(args.worktree, "flake.nix"))
        or host.file_exists(join(args.worktree, "shell.nix"))
end

function M.export(args)
    local result = host.exec("nix", { "print-dev-env", "--json" })
    if result.code ~= 0 then
        error("nix print-dev-env failed: " .. (result.stderr or result.stdout or "unknown error"))
    end

    local parsed = host.json_decode(result.stdout)

    local env_map = {}
    if parsed.variables then
        for name, info in pairs(parsed.variables) do
            -- Only scalar strings — skip Bash arrays and associatives,
            -- which can't be represented as plain env vars anyway.
            if type(info) == "table"
                and type(info.value) == "string"
                and (info.type == "exported" or info.type == "var")
            then
                env_map[name] = info.value
            end
        end
    end

    local watched = {}
    for _, name in ipairs({ "flake.nix", "flake.lock", "shell.nix" }) do
        local path = join(args.worktree, name)
        if host.file_exists(path) then
            table.insert(watched, path)
        end
    end

    return {
        env = env_map,
        watched = watched,
    }
end

return M
