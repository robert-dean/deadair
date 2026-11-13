#!/bin/bash
# PreToolUse hook on Edit|Write (wired in .claude/settings.json).
# Asks before Claude edits a generated file, and names the source to edit and the command that
# regenerates it. Advisory: it never blocks on its own, and it always exits 0.
#
# Input: the PreToolUse JSON on stdin; it reads tool_input.file_path, which Claude Code always sends
# as an absolute path. Output: nothing for an ordinary file; for a generated one, a single JSON object
# whose permissionDecisionReason is shown to the person in the prompt and whose additionalContext is
# shown to Claude.
#
# The table below is the root CLAUDE.md's "Generated output" rule as paths. Every class was checked
# against the tree on 2026-11-13; a router or a zod types file counts as generated only when a .ck
# file of the same base name exists, because assetlinks.router.ts, oauth.protocol.router.ts and
# plugins/types/plugin.record.ts are hand-written.
#
# What it cannot see:
#   * a write made through Bash (sed -i, a heredoc, a generator run by hand). The `generated` job in
#     .github/workflows/build.yml is the check that runs for every author;
#   * apps/api/.kysely-codegenrc.json, whose overrides block sync.enum.overrides.ts rewrites while
#     the rest of it is hand-written.
#
# Headless runs: "ask" needs a person to answer. In a claude -p or Agent SDK run with nobody to
# answer and no canUseTool callback, every ask is a refusal and Claude reads the reason in the tool
# result. The permissions.ask rules in .claude/settings.json behave the same way.
#
# Tests: bash .claude/hooks/hooks.test.sh

# Tighten here: set DECISION=deny to refuse the edit instead of asking. Nothing else changes.
DECISION=ask

# Read stdin with a builtin, so nothing runs for the common case.
IFS= read -r -d '' input

# Pull file_path out with a bash pattern. Safe because JSON escapes every quote inside a string, so
# a bare "file_path" key can only be the key itself.
re_path='"file_path"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)"'
[[ $input =~ $re_path ]] || exit 0
file=${BASH_REMATCH[1]}
file=${file//\\\\//}

# Leave at once unless the path could be generated: a loose superset of the table below.
re_maybe='(/routes/[^/]+\.router\.ts|/types/[^/]+\.ts|/src/mcp/|/permissions/generated/|/modules/data/db\.ts|/packages/sdk(-kotlin|-csharp|-swift)?/|/api-reference/|/static/openapi\.yaml|routeTree\.gen\.ts|/dist/)'
[[ $file =~ $re_maybe ]] || exit 0

# The path relative to the checkout that holds it. A worktree resolves to itself, so a session in
# the main checkout editing a worktree is judged against the worktree.
dir=$(dirname "$file")
while [ ! -d "$dir" ] && [ "$dir" != / ] && [ "$dir" != . ]; do dir=$(dirname "$dir"); done
pdir=$(cd "$dir" 2>/dev/null && pwd -P)
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
pfile="$pdir${file#"$dir"}"
if [ -n "$pdir" ] && [ -n "$root" ] && [[ $pfile == "$root"/* ]]; then
    rel=${pfile#"$root"/}
else
    root=''
    rel=$file
fi
p="/$rel"

json_escape() {
    local s=$1
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    printf '%s' "$s"
}
decide() {
    local r
    r=$(json_escape "$1")
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s","additionalContext":"%s"}}\n' "$DECISION" "$r" "$r"
    exit 0
}
generated() { decide "$rel is generated from $1. Edit the source, then run $2. Approve only to fix the generator's output deliberately, and say why."; }

CONTRACTS='pnpm build:contracts from the repo root (if it reports nothing written after a revert, rm -rf apps/api/.contractkit/cache first)'

case "$p" in
    */apps/api/src/modules/permissions/generated/*)
        generated "the .perm files in apps/api/data/permissions/" "pnpm build:permissions" ;;
    */apps/api/src/modules/data/db.ts)
        generated "the SQL migrations in apps/api/data/migrations/" "pnpm build:data (migrate:up, then build:datatypes) against a database migrated from this branch" ;;
    */apps/api/src/mcp/*.mcp.ts | */apps/api/src/mcp/mcp.tools.ts)
        generated "the .ck contracts in apps/api/data/contracts/" "$CONTRACTS" ;;
    */packages/sdk/src/*)
        generated "the .ck contracts in apps/api/data/contracts/" "$CONTRACTS, then pnpm --filter @deadair/sdk build" ;;
    */packages/sdk-kotlin/src/* | */packages/sdk-csharp/Clients/* | */packages/sdk-csharp/Models/* | */packages/sdk-csharp/Runtime/* | */packages/sdk-csharp/DeadairSdk.cs | */packages/sdk-swift/Sources/*)
        generated "the .ck contracts in apps/api/data/contracts/" "$CONTRACTS" ;;
    */apps/site/docs/api-reference/index.md) ;;
    */apps/site/docs/api-reference/* | */apps/site/static/openapi.yaml)
        generated "the .ck contracts in apps/api/data/contracts/ (the docs plugin in apps/api/contractkit.config.json)" "$CONTRACTS" ;;
    */apps/web/src/routeTree.gen.ts)
        generated "the route files in apps/web/src/routes/" "the web dev server or pnpm --filter @deadair/web build, whose TanStack Router plugin rewrites it" ;;
    */node_modules/*) ;;
    */dist/*)
        generated "the package's source files" "that package's build" ;;
esac

# Routers and zod types: generated only when a .ck file of the same base name exists.
re_router='^/apps/api/src/routes/([^/]+)\.router\.ts$'
re_types='^/apps/api/src/modules/[^/]+/types/([^/]+)\.ts$'
base=''
if [[ $p =~ $re_router ]] || [[ $p =~ $re_types ]]; then base=${BASH_REMATCH[1]}; fi
if [ -n "$base" ] && [ -n "$root" ]; then
    ck=$(find "$root/apps/api/data/contracts" -type f -name "$base.ck" -print -quit 2>/dev/null)
    [ -n "$ck" ] && generated "${ck#"$root"/}" "$CONTRACTS"
fi
exit 0
