#!/bin/bash
# Tests for the hooks in this folder. Pipes realistic hook payloads through each script and checks
# its output and exit code.
#
#   bash .claude/hooks/hooks.test.sh
#
# Run it from anywhere in the repo after changing a hook or its wiring in .claude/settings.json.
# Needs bash, git and jq (jq only here, to check that every answer is valid JSON). Real repo paths are
# used where a hook only reads them; anything a case writes goes in a temporary folder whose name
# contains a space, removed when the script ends. Prints one line per case and exits 1 if any fails.

HOOKS=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HOOKS/../.." && pwd -P)
base=${TMPDIR:-/tmp}
TMP=$(mktemp -d "${base%/}/hooks test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
passed=0
failed=0

ok() { passed=$((passed + 1)); echo "ok    $1"; }
bad() { failed=$((failed + 1)); echo "FAIL  $1: $2"; }

# run <hook> <json>: sets OUT and CODE
run() {
    OUT=$(printf '%s' "$2" | bash "$HOOKS/$1" 2>&1)
    CODE=$?
}

edit_payload() { # <absolute path> [session]
    printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"a","new_string":"b"}}' "${2:-s1}" "$1"
}

# expect_silent <name> <hook> <json>
expect_silent() {
    run "$2" "$3"
    if [ "$CODE" -ne 0 ]; then bad "$1" "exit $CODE"; elif [ -n "$OUT" ]; then bad "$1" "expected no output, got: $OUT"; else ok "$1"; fi
}

# expect_ask <name> <json> <substring the reason must contain>
expect_ask() {
    run generated.guard.sh "$2"
    if [ "$CODE" -ne 0 ]; then bad "$1" "exit $CODE"; return; fi
    if ! jq -e '.hookSpecificOutput.permissionDecision == "ask"' >/dev/null 2>&1 <<<"$OUT"; then bad "$1" "not an ask: $OUT"; return; fi
    if [[ $OUT != *"$3"* ]]; then bad "$1" "reason lacks '$3': $OUT"; return; fi
    ok "$1"
}

# expect_note <name> <hook> <json> <substring the note must contain>
expect_note() {
    run "$2" "$3"
    if [ "$CODE" -ne 0 ]; then bad "$1" "exit $CODE"; return; fi
    if ! jq -e '.hookSpecificOutput.additionalContext | type == "string"' >/dev/null 2>&1 <<<"$OUT"; then bad "$1" "no additionalContext: $OUT"; return; fi
    if [[ $OUT != *"$4"* ]]; then bad "$1" "note lacks '$4': $OUT"; return; fi
    ok "$1"
}

echo "generated.guard.sh"
g() { edit_payload "$ROOT/$1"; }
expect_ask 'generated router' "$(g apps/api/src/routes/activity.router.ts)" 'apps/api/data/contracts/'
expect_ask 'generated zod types' "$(g apps/api/src/modules/activity/types/activity.types.ts)" 'activity.types.ck'
expect_ask 'generated mcp tool' "$(g apps/api/src/mcp/activity.mcp.ts)" 'pnpm build:contracts'
expect_ask 'mcp tool index' "$(g apps/api/src/mcp/mcp.tools.ts)" 'pnpm build:contracts'
expect_ask 'permissions output' "$(g apps/api/src/modules/permissions/generated/index.ts)" 'pnpm build:permissions'
expect_ask 'kysely types' "$(g apps/api/src/modules/data/db.ts)" 'pnpm build:data'
expect_ask 'TS SDK client' "$(g packages/sdk/src/activity/activity.client.ts)" '@deadair/sdk build'
expect_ask 'Kotlin SDK' "$(g packages/sdk-kotlin/src/commonMain/kotlin/com/maroonedsoftware/deadair/sdk/clients/ActivityClient.kt)" '.ck contracts'
expect_ask 'C# SDK' "$(g packages/sdk-csharp/Clients/ArtClient.cs)" '.ck contracts'
expect_ask 'C# SDK root' "$(g packages/sdk-csharp/DeadairSdk.cs)" '.ck contracts'
expect_ask 'Swift SDK' "$(g packages/sdk-swift/Sources/DeadairSdk/Clients/ArtClient.swift)" '.ck contracts'
expect_ask 'site API reference' "$(g apps/site/docs/api-reference/activity/x.md)" 'docs plugin'
expect_ask 'site openapi' "$(g apps/site/static/openapi.yaml)" 'docs plugin'
expect_ask 'web route tree' "$(g apps/web/src/routeTree.gen.ts)" 'TanStack Router'
expect_ask 'a dist file' "$(g packages/plugin-sdk/dist/index.js)" 'build'
expect_ask 'a new generated file' "$(g apps/api/src/modules/permissions/generated/brand.new.ts)" 'pnpm build:permissions'
expect_silent 'hand-written router' generated.guard.sh "$(g apps/api/src/routes/assetlinks.router.ts)"
expect_silent 'hand-written oauth router' generated.guard.sh "$(g apps/api/src/routes/oauth.protocol.router.ts)"
expect_silent 'hand-written types file' generated.guard.sh "$(g apps/api/src/modules/plugins/types/plugin.record.ts)"
expect_silent 'hand-written mcp tool' generated.guard.sh "$(g apps/api/src/mcp/call.api.tool.ts)"
expect_silent 'routes.setup.ts' generated.guard.sh "$(g apps/api/src/routes/routes.setup.ts)"
expect_ask 'SDK barrel' "$(g packages/sdk/src/index.ts)" '@deadair/sdk build'
expect_ask 'SDK runtime options' "$(g packages/sdk/src/sdk-options.ts)" '@deadair/sdk build'
expect_silent 'Swift Package.swift' generated.guard.sh "$(g packages/sdk-swift/Package.swift)"
expect_silent 'C# project file' generated.guard.sh "$(g packages/sdk-csharp/DeadairSdk.csproj)"
expect_silent 'API reference index' generated.guard.sh "$(g apps/site/docs/api-reference/index.md)"
expect_silent 'a .ck source' generated.guard.sh "$(g apps/api/data/contracts/activity/activity.ck)"
expect_silent 'an ordinary service' generated.guard.sh "$(g apps/api/src/modules/director/director.service.ts)"
expect_silent 'node_modules dist' generated.guard.sh "$(g node_modules/foo/dist/index.js)"
expect_silent 'no file_path' generated.guard.sh '{"tool_name":"Edit","tool_input":{}}'
expect_silent 'empty input' generated.guard.sh ''
mkdir -p "$TMP/elsewhere/routes"
expect_silent 'outside a checkout' generated.guard.sh "$(edit_payload "$TMP/elsewhere/routes/activity.router.ts")"
run generated.guard.sh "$(g apps/api/src/routes/activity.router.ts)"
if jq -e . >/dev/null 2>&1 <<<"$OUT"; then ok 'answer is valid JSON'; else bad 'answer is valid JSON' "$OUT"; fi

if [ -f "$HOOKS/codegen.reminder.sh" ]; then
    echo "codegen.reminder.sh"
    post() { # <relative path> [session] [tool]
        printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"%s","tool_input":{"file_path":"%s"},"tool_response":{"type":"update"}}' "${2:-s1}" "${3:-Edit}" "$ROOT/$1"
    }
    export TMPDIR="$TMP/"
    expect_note '.ck edit' codegen.reminder.sh "$(post apps/api/data/contracts/activity/activity.ck c1)" 'pnpm build:contracts'
    expect_note '.ck edit again is short' codegen.reminder.sh "$(post apps/api/data/contracts/activity/activity.ck c1)" 'Reminder'
    expect_note '.ck edit names the native apps' codegen.reminder.sh "$(post apps/api/data/contracts/art/art.ck c1)" 'apps/desktop'
    expect_note '.perm edit' codegen.reminder.sh "$(post apps/api/data/permissions/station.perm c2)" 'pnpm build:permissions'
    expect_note 'migration edit' codegen.reminder.sh "$(post apps/api/data/migrations/20990101000000_x.sql c3)" 'pnpm build:data'
    expect_note 'migration names the enum trap' codegen.reminder.sh "$(post apps/api/data/migrations/20990101000001_y.sql c3b)" 'Generated<>'
    expect_note 'new web route' codegen.reminder.sh "$(printf '{"session_id":"c4","tool_name":"Write","tool_input":{"file_path":"%s"},"tool_response":{"type":"create"}}' "$ROOT/apps/web/src/routes/zzz.tsx")" 'routeTree.gen.ts'
    expect_silent 'existing web route edit' codegen.reminder.sh "$(post apps/web/src/routes/index.tsx c4)"
    expect_note 'liquidsoap edit' codegen.reminder.sh "$(post stream/radio.liq c5)" 'liquidsoap'
    expect_silent 'ordinary file' codegen.reminder.sh "$(post apps/api/src/modules/director/director.service.ts c6)"
    expect_silent 'empty input (reminder)' codegen.reminder.sh ''
fi

if [ -f "$HOOKS/ratchet.guard.sh" ]; then
    echo "ratchet.guard.sh"
    gfile="$ROOT/apps/api/tests/architecture/settings.reads.test.ts"
    ratchet() { # <old> <new> [file]
        jq -nc --arg f "${3:-$gfile}" --arg o "$1" --arg n "$2" '{tool_name:"Edit",tool_input:{file_path:$f,old_string:$o,new_string:$n}}'
    }
    expect_ratchet_ask() {
        run ratchet.guard.sh "$2"
        if [ "$CODE" -ne 0 ]; then bad "$1" "exit $CODE"; return; fi
        if ! jq -e '.hookSpecificOutput.permissionDecision == "ask"' >/dev/null 2>&1 <<<"$OUT"; then bad "$1" "not an ask: $OUT"; return; fi
        ok "$1"
    }
    expect_ratchet_ask 'adds to a KNOWN_ list' "$(ratchet "const KNOWN_RAW_FLAG_READS = new Set<string>([
]);" "const KNOWN_RAW_FLAG_READS = new Set<string>([
    'apps/api/src/x.ts',
]);")"
    expect_ratchet_ask 'adds an EXEMPT entry' "$(ratchet "const EXEMPT_FILES = [" "const EXEMPT_FILES = [
    'a.ts', // why")"
    expect_ratchet_ask 'skips a guard' "$(ratchet "it('reads every flag" "it.skip('reads every flag")"
    expect_ratchet_ask 'skips anywhere' "$(ratchet "describe('x'" "describe.skip('x'" "$ROOT/apps/api/tests/modules/director/director.service.test.ts")"
    expect_ratchet_ask 'changes a guard regex' "$(ratchet "const RAW = /config\\.get\\(/;" "const RAW = /nothing/;")"
    expect_ratchet_ask 'writes a whole guard file' "$(jq -nc --arg f "$gfile" '{tool_name:"Write",tool_input:{file_path:$f,content:"x"}}')"
    expect_silent 'shrinks a KNOWN_ list' ratchet.guard.sh "$(ratchet "const KNOWN_X = new Set([
    'a.ts',
    'b.ts',
]);" "const KNOWN_X = new Set([
    'a.ts',
]);")"
    expect_silent 'removes an exemption' ratchet.guard.sh "$(ratchet "const EXEMPT_X = ['a', 'b'];" "const EXEMPT_X = ['a'];")"
    expect_silent 'edits only a comment' ratchet.guard.sh "$(ratchet "// old words" "// new words")"
    expect_silent 'ordinary test edit' ratchet.guard.sh "$(ratchet "expect(a).toBe(1);" "expect(a).toBe(2);" "$ROOT/apps/api/tests/modules/director/director.service.test.ts")"
    real="$ROOT/apps/api/tests/architecture/settings.reads.test.ts"
    cites="$ROOT/apps/api/tests/architecture/docs.citations.test.ts"
    expect_ratchet_ask 'real file: grows the ratchet' "$(ratchet "new Set<string>(['apps/api/src/server/setup.server.ts: PORT'])" "new Set<string>(['apps/api/src/server/setup.server.ts: PORT', 'apps/api/src/x.ts: y'])" "$real")"
    expect_ratchet_ask 'real file: adds a Map exemption' "$(ratchet "const EXEMPT_CITATIONS = new Map<string, string>([" "const EXEMPT_CITATIONS = new Map<string, string>([
    ['CLAUDE.md -> nowhere.md', 'because']," "$cites")"
    expect_ratchet_ask 'real file: narrows the receiver' "$(ratchet "const RECEIVER = /(config|boot|store|settings)\$/i;" "const RECEIVER = /(config)\$/i;" "$real")"
    expect_silent 'real file: shrinks the ratchet' ratchet.guard.sh "$(ratchet "new Set<string>(['apps/api/src/server/setup.server.ts: PORT'])" "new Set<string>([])" "$real")"
    expect_silent 'real file: rewords a comment' ratchet.guard.sh "$(ratchet "// No setting is read as a boolean" "// No setting is ever read as a boolean" "$real")"
    expect_silent 'real file: removes an exemption' ratchet.guard.sh "$(ratchet "    ['CLAUDE.md -> docs/todo/', 'history: where the Ideas discussions lived until 2026-09-11'],
" "" "$cites")"
    expect_silent 'a new guard file' ratchet.guard.sh "$(jq -nc --arg f "$ROOT/apps/api/tests/architecture/brand.new.test.ts" '{tool_name:"Write",tool_input:{file_path:$f,content:"const KNOWN_X = [\"a\"];"}}')"
    expect_silent 'source file edit' ratchet.guard.sh "$(ratchet "a" "b" "$ROOT/apps/api/src/modules/director/director.service.ts")"
fi

echo "settings.json wiring"
S="$ROOT/.claude/settings.json"
for h in generated.guard.sh codegen.reminder.sh ratchet.guard.sh; do
    [ -f "$HOOKS/$h" ] || continue
    if jq -e --arg h "$h" '[.hooks[][] | .hooks[] | .command | select(contains($h))] | length == 1' "$S" >/dev/null; then ok "$h is wired once"; else bad "$h is wired once" "check .hooks in settings.json"; fi
done

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
