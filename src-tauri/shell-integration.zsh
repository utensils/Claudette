# Claudette shell integration for zsh
# This script enables command tracking and exit code reporting.

_claudette_precmd() {
    local exit_code=$?
    printf '\033]133;D;%s\007' "$exit_code"
    printf '\033]133;A\007'  # Prompt starts
    return $exit_code
}

_claudette_preexec() {
    # Emit B marker (command input starts)
    printf '\033]133;B\007'
    # Emit explicit command text (zsh provides the command in $1)
    # URL-encode to handle special characters
    local cmd_encoded=$(printf '%s' "$1" | jq -sRr @uri 2>/dev/null || printf '%s' "$1" | od -An -tx1 | tr ' ' '%' | tr -d '\n')
    if [[ -n "$cmd_encoded" ]]; then
        printf '\033]133;E;%s\007' "$cmd_encoded"
    fi
    # Emit C marker (command output starts)
    printf '\033]133;C\007'
}

# Add hooks
autoload -Uz add-zsh-hook
add-zsh-hook precmd _claudette_precmd
add-zsh-hook preexec _claudette_preexec
