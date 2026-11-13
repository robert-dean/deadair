#!/bin/bash
# PostToolUse hook on Edit|Write (wired in .claude/settings.json).
# After an edit to a generator's source, tells Claude which command regenerates the output, and the
# trap each generator is known to spring. Plain stdout from a PostToolUse hook does not reach Claude,
# so the note goes out as hookSpecificOutput.additionalContext, which Claude reads beside the tool
# result. Advisory: it never blocks, and it always exits 0.
#
# Sources, and what each note says (each checked against the tree on 2026-11-13):
#   apps/api/data/contracts/**/*.ck   pnpm build:contracts; the ContractKit cache that skips reverted
#       output; the TS SDK's dist that apps/web type-checks against; the three native apps that
#       compile their own generated SDK and break on a rename.
#   apps/api/data/permissions/*.perm  pnpm build:permissions.
#   apps/api/data/migrations/*.sql    pnpm build:data against a database migrated from this branch;
#       no apps/api/.env in a worktree; the enum override that must keep its Generated<> wrapper.
#   a NEW file in apps/web/src/routes/  the TanStack Router plugin rewrites routeTree.gen.ts.
#   stream/*.liq                      liquidsoap --check, with or without the dev stack.
#   packages/plugin-sdk/src/**        apps/api and plugins import its dist, so rebuild it.
# Each note is given in full once per file per session; a later edit to the same file gets a
# one-line reminder. State lives in $TMPDIR/deadair.hooks.<session_id>/.
#
# It cannot see a file changed through Bash. The `generated` CI job catches contract, permission
# and migration output that was not regenerated.
#
# Tests: bash .claude/hooks/hooks.test.sh

IFS= read -r -d '' input

field() { # <key>: the raw (still JSON-escaped) string value of the first "<key>" in the input
    local re="\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
    [[ $input =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
}

file=$(field file_path)
[ -n "$file" ] || exit 0
file=${file//\\\\//}

note=''
short=''
case "$file" in
    */apps/api/data/contracts/*.ck)
        short='Reminder: pnpm build:contracts after this .ck edit.'
        note="This .ck file is the source of the routers, zod types, MCP tools, all four SDKs and the site's API reference. Run pnpm build:contracts from the repo root and commit the output with it, or the generated CI job fails. If it reports nothing written after a revert, rm -rf apps/api/.contractkit/cache and run it again. apps/web type-checks against packages/sdk/dist, so pnpm --filter @deadair/sdk build before a web typecheck. A renamed or removed field or enum breaks apps/desktop, apps/android and apps/ios, which compile their own generated SDKs: search them (quote any --include glob in zsh) before pushing. The contractkit skill has the procedure." ;;
    */apps/api/data/permissions/*.perm)
        short='Reminder: pnpm build:permissions after this .perm edit.'
        note='This .perm file generates apps/api/src/modules/permissions/generated/. Run pnpm build:permissions and commit the output with it, or the generated CI job fails.' ;;
    */apps/api/data/migrations/*.sql)
        short='Reminder: pnpm build:data after this migration edit.'
        note="After a migration, run pnpm build:data (migrate:up, then sync:enum-overrides and kysely-codegen) against a database migrated from this branch, and commit apps/api/src/modules/data/db.ts and apps/api/.kysely-codegenrc.json with it. A worktree has no apps/api/.env: migrate a scratch database instead of the dev one, and probe the port first. A new enum column (ALTER TABLE ... ADD COLUMN ... CHECK (x in (...))) must land in .kysely-codegenrc.json with its Generated<> wrapper when it has a default, or every insert has to name it. Never edit a migration that has run on the station: add a new one." ;;
    */apps/web/src/routes/*)
        type=$(field type)
        [ "$type" = create ] || exit 0
        short='Reminder: the route tree regenerates on the next web dev server run or build.'
        note='A new route file: apps/web/src/routeTree.gen.ts is rewritten by the TanStack Router plugin on the next web dev server start or pnpm --filter @deadair/web build. Run one before type-checking, and commit routeTree.gen.ts with the route.' ;;
    */stream/*.liq)
        short='Reminder: liquidsoap --check this file before committing.'
        note="Check a Liquidsoap edit before committing: stream/README.md has the compose harness. Without the dev stack (a worktree), run the pinned image with --entrypoint sh and radio.default.env sourced in the shell: docker run --rm --entrypoint sh -v \"\$PWD/stream:/s:ro\" savonet/liquidsoap:v2.4.5 -c 'set -a; . /s/radio.default.env; set +a; liquidsoap --check /s/radio.liq; echo EXIT: \$?'. EXIT: 0 with no other output is the only pass." ;;
    */packages/plugin-sdk/src/*)
        short='Reminder: rebuild the plugin SDK before type-checking its consumers.'
        note='apps/api and every plugin import @deadair/plugin-sdk from its dist, not its source. Run pnpm --filter @deadair/plugin-sdk build before type-checking them, or they read the old types.' ;;
    *) exit 0 ;;
esac

session=$(field session_id)
session=${session//[^A-Za-z0-9_-]/}
dir="${TMPDIR:-/tmp}"
dir="${dir%/}/deadair.hooks.${session:-nosession}"
key=$(printf '%s' "$file" | cksum | cut -d' ' -f1)
if [ -e "$dir/$key" ]; then
    note=$short
else
    mkdir -p "$dir" 2>/dev/null && : >"$dir/$key"
fi

note=${note//\\/\\\\}
note=${note//\"/\\\"}
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$note"
exit 0
