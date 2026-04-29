#!/usr/bin/env bash
# Installer for upbeat-internal-skills
# Usage:
#   ./install.sh pm dev wiki redmine    # install named components
#   ./install.sh --list                  # list everything available
#   ./install.sh --uninstall pm redmine  # remove named components

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_DIR="$REPO_ROOT/.claude/commands"
USER_COMMANDS_DIR="$HOME/.claude/commands"

list_skills() {
    [ -d "$COMMANDS_DIR" ] || return 0
    for f in "$COMMANDS_DIR"/*.md; do
        [ -e "$f" ] || continue
        basename "$f" .md
    done
}

list_mcps() {
    for d in "$REPO_ROOT"/*-mcp; do
        [ -d "$d" ] || continue
        n=$(basename "$d")
        echo "${n%-mcp}"
    done
}

show_list() {
    echo
    echo "Available skills (slash commands):"
    list_skills | sed 's|^|  /|'
    echo
    echo "Available MCPs:"
    list_mcps | sed 's|^|  |'
    echo
    echo "Install examples:"
    echo "  ./install.sh pm dev wiki redmine"
    echo "  ./install.sh --uninstall pm"
    echo
}

install_skill() {
    local name="$1"
    local src="$COMMANDS_DIR/$name.md"
    if [ ! -f "$src" ]; then
        echo "  [skip] skill '$name' not found in $COMMANDS_DIR"
        return
    fi
    mkdir -p "$USER_COMMANDS_DIR"
    cp -f "$src" "$USER_COMMANDS_DIR/$name.md"
    echo "  [ok] /$name -> $USER_COMMANDS_DIR/$name.md"
}

uninstall_skill() {
    local name="$1"
    local dst="$USER_COMMANDS_DIR/$name.md"
    if [ -f "$dst" ]; then
        rm -f "$dst"
        echo "  [ok] removed /$name"
    else
        echo "  [skip] /$name was not installed"
    fi
}

prompt_env() {
    local var="$1"
    local hint="$2"
    local current="${!var}"
    if [ -n "$current" ]; then
        echo "$current"
        return
    fi
    read -r -p "$var${hint:+ ($hint)}: " value
    echo "$value"
}

install_mcp() {
    local name="$1"
    local dir="$REPO_ROOT/$name-mcp"
    if [ ! -d "$dir" ]; then
        echo "  [skip] MCP '$name' not found ($dir does not exist)"
        return
    fi

    local entry=()
    if [ -f "$dir/package.json" ]; then
        echo "  [npm] installing dependencies for $name..."
        (cd "$dir" && npm install --silent)
        entry=(node "$dir/server.js")
    elif [ -f "$dir/server.py" ]; then
        entry=(python "$dir/server.py")
    else
        echo "  [skip] no package.json or server.py in $dir"
        return
    fi

    local env_flags=()
    case "$name" in
        redmine)
            local url key
            url=$(prompt_env REDMINE_URL "e.g. http://192.168.1.139:58088")
            key=$(prompt_env REDMINE_API_KEY "")
            env_flags+=(-e "REDMINE_URL=$url" -e "REDMINE_API_KEY=$key")
            ;;
    esac

    echo "  [claude] registering MCP '$name' (user scope)..."
    claude mcp remove "$name" --scope user >/dev/null 2>&1 || true
    if claude mcp add "$name" --scope user "${env_flags[@]}" -- "${entry[@]}"; then
        echo "  [ok] MCP '$name' registered"
    else
        echo "  [fail] claude mcp add failed"
    fi
}

uninstall_mcp() {
    local name="$1"
    if claude mcp remove "$name" --scope user >/dev/null 2>&1; then
        echo "  [ok] removed MCP '$name'"
    else
        echo "  [skip] MCP '$name' was not installed"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    show_list
    exit 0
fi

if [ "$1" = "--list" ]; then
    show_list
    exit 0
fi

uninstall_mode=0
names=()
for a in "$@"; do
    case "$a" in
        --uninstall|-u) uninstall_mode=1 ;;
        *) names+=("$a") ;;
    esac
done

if [ ${#names[@]} -eq 0 ]; then
    echo "No components specified. Use --list to see what's available."
    exit 1
fi

mapfile -t skills < <(list_skills)
mapfile -t mcps < <(list_mcps)

contains() {
    local needle="$1"; shift
    for x in "$@"; do [ "$x" = "$needle" ] && return 0; done
    return 1
}

action="Installing"
[ $uninstall_mode -eq 1 ] && action="Uninstalling"
echo
echo "$action: ${names[*]}"
echo

for name in "${names[@]}"; do
    is_skill=0; is_mcp=0
    contains "$name" "${skills[@]}" && is_skill=1
    contains "$name" "${mcps[@]}" && is_mcp=1
    if [ $is_skill -eq 0 ] && [ $is_mcp -eq 0 ]; then
        echo "[$name] not found as either skill or MCP"
        continue
    fi
    echo "[$name]"
    if [ $uninstall_mode -eq 1 ]; then
        [ $is_skill -eq 1 ] && uninstall_skill "$name"
        [ $is_mcp -eq 1 ] && uninstall_mcp "$name"
    else
        [ $is_skill -eq 1 ] && install_skill "$name"
        [ $is_mcp -eq 1 ] && install_mcp "$name"
    fi
done

echo
if [ $uninstall_mode -eq 0 ]; then
    echo "Done. Restart Claude Code so new commands and MCP servers load."
else
    echo "Done."
fi
