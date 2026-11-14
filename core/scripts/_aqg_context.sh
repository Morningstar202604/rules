#!/bin/sh
# Shared AQG context helper, sourced by the aqg-* SKILL.md snippets:
#
#   source "${AQG_ROOT:?set AQG_ROOT to the AQG installation root}/scripts/_aqg_context.sh"
#
# Resolves the installation root from THIS FILE's own location (the root is
# the directory that contains both skills/ and scripts/), then exports the
# shared context env vars:
#
#   AQG_ROOT / aqg_root            installation root (absolute, normalized here)
#   AQG_SKILL_DIR / aqg_skill_dir  <root>/skills/<name> when a skill name is
#                                  passed as $1 (or inherited via the
#                                  AQG_SKILL_NAME env), else <root>/skills
#   AQG_SKILL_NAME                 explicit skill name when known
#   AQG_PHASE / aqg_phase          workflow phase; keeps an inherited
#                                  AQG_PHASE, defaults to "default"
#
# Sourcing stays SILENT on success (snippet output is user-facing) and
# returns non-zero on failure so the SKILL.md `|| { ... }` guards fire.
# Safe under `set -u`; POSIX-style sh (BASH_SOURCE falls back to $0).

_aqg_context() {
    local _aqg_self _aqg_scripts_dir _aqg_root _aqg_arg
    _aqg_self="${BASH_SOURCE:-$0}"
    _aqg_scripts_dir=$(dirname "$_aqg_self") || return 1
    _aqg_root=$(cd "$_aqg_scripts_dir/.." 2>/dev/null && pwd) || return 1
    [ -d "${_aqg_root}/skills" ] || return 1

    AQG_ROOT="${_aqg_root}"
    export AQG_ROOT
    aqg_root="${_aqg_root}"

    _aqg_arg="${1:-}"
    AQG_SKILL_NAME="${AQG_SKILL_NAME:-${_aqg_arg}}"
    if [ -n "${_aqg_arg}" ] && [ -d "${_aqg_root}/skills/${_aqg_arg}" ]; then
        AQG_SKILL_DIR="${_aqg_root}/skills/${_aqg_arg}"
        AQG_SKILL_NAME="${_aqg_arg}"
    elif [ -n "${AQG_SKILL_NAME}" ] && [ -d "${_aqg_root}/skills/${AQG_SKILL_NAME}" ]; then
        AQG_SKILL_DIR="${_aqg_root}/skills/${AQG_SKILL_NAME}"
    else
        AQG_SKILL_DIR="${_aqg_root}/skills"
    fi
    export AQG_SKILL_NAME AQG_SKILL_DIR
    aqg_skill_dir="${AQG_SKILL_DIR}"

    AQG_PHASE="${AQG_PHASE:-default}"
    export AQG_PHASE
    aqg_phase="${AQG_PHASE}"
    return 0
}

_aqg_context "${1:-}"
_aqg_status=$?
unset -f _aqg_context 2>/dev/null
if [ "${_aqg_status}" -eq 0 ]; then
    unset _aqg_status
    return 0 2>/dev/null || exit 0
fi
unset _aqg_status
return 1 2>/dev/null || exit 1
