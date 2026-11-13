#!/bin/bash
# PreToolUse hook on Edit|Write|MultiEdit (wired in .claude/settings.json).
# Asks before an edit that loosens a guard, so a failing guard is fixed in the code and not silenced:
# one that skips or focuses a test anywhere, grows a KNOWN_/BASELINE_ ratchet or an EXEMPT_/NOT_/NO_
# list in apps/api/tests/architecture/, or changes how a guard finds what it checks. The rules are in
# ratchet.guard.mjs beside this. Advisory: it never blocks on its own, and it always exits 0.
#
# This wrapper starts no program unless the path is under a tests/ folder, then hands the payload to
# node. Hooks run with Claude Code's environment, which can lack node when it comes from fnm or nvm
# set up in a shell profile, so it looks in the usual places before giving up with a note.
#
# What it cannot see: a write through Bash, and a guard that lives outside tests/architecture.
#
# Tests: bash .claude/hooks/hooks.test.sh

IFS= read -r -d '' input
re='"file_path"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*[/\\]tests[/\\]'
[[ $input =~ $re ]] || exit 0

node=$(command -v node)
if [ -z "$node" ]; then
    for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.local/share/fnm/aliases/default/bin/node "$HOME"/.volta/bin/node; do
        [ -x "$n" ] && node=$n && break
    done
fi
if [ -z "$node" ]; then
    echo '{"systemMessage":"ratchet.guard: node not found, so edits that loosen a guard test are not checked."}'
    exit 0
fi
printf '%s' "$input" | "$node" "$(dirname "$0")/ratchet.guard.mjs"
exit 0
