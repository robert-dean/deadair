#!/usr/bin/env bash
# Which parts of the tree a push or a pull request changed, as one true/false flag per part.
#
# Every job that is not worth running for every commit reads one of these: the tests, the sidecar,
# the two listener apps, the codegen check and the images. The rules live here rather than in the
# workflows so that there is one list, and so that it can be run by hand against real history:
#
#     BASE=<commit> HEAD_REF=<commit> .github/scripts/changes.sh
#
# It FAILS OPEN. No usable base commit (a manual run, a new branch, a force push, a shallow fetch)
# turns every flag on, because guessing wrong the other way is a broken build merged behind a green
# check, or a release that quietly published nothing. A release turns every flag on as well, but in
# `release.yml` rather than here, because only that workflow knows a push is one: the one build
# nobody checked should not be the one that gets a version number.
#
# A flag is also turned on by a change to the workflow that runs its jobs, since a change to how a
# thing is built is a change to that thing. A change to this script or to `changes.yml` turns on
# everything.

set -euo pipefail

FLAGS="tree node generated sidecar android desktop image"
HEAD_REF="${HEAD_REF:-HEAD}"

emit() {
    echo "$1=$2"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "$1=$2" >> "$GITHUB_OUTPUT"
    fi
}

everything() {
    echo "$1"
    for flag in $FLAGS; do
        emit "$flag" true
    done
    exit 0
}

zero="0000000000000000000000000000000000000000"
if [ -z "${BASE:-}" ] || [ "$BASE" = "$zero" ] || ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
    everything "No usable base commit, so running everything."
fi

if ! changed="$(git diff --name-only "$BASE" "$HEAD_REF")"; then
    everything "Could not diff ${BASE} against ${HEAD_REF}, so running everything."
fi

echo "$(printf '%s\n' "$changed" | grep -c . || true) files changed since ${BASE}."

# The first changed file matching INCLUDE and not matching EXCLUDE, or nothing. Both are extended
# regular expressions over repository paths, and EXCLUDE may be empty.
first() {
    local include="$1" exclude="${2:-}"
    local matches
    matches="$(printf '%s\n' "$changed" | grep -E "$include" || true)"
    if [ -n "$exclude" ]; then
        matches="$(printf '%s\n' "$matches" | grep -Ev "$exclude" || true)"
    fi
    printf '%s\n' "$matches" | grep -m1 . || true
}

flag() {
    local name="$1" hit
    hit="$(first "$2" "${3:-}")"
    if [ -n "$hit" ]; then
        echo "  $name: yes, for $hit"
        emit "$name" true
    else
        echo "  $name: no"
        emit "$name" false
    fi
}

if [ -n "$(first '^\.github/(scripts/changes\.sh|workflows/(changes|pr|release)\.yml)$')" ]; then
    everything "The change detection or a workflow that calls it changed, so running everything."
fi

# The listener apps' generated SDKs live under `packages/` beside the station's own packages, but
# nothing the station builds, tests or ships reads them.
listener_sdks='^packages/(sdk-kotlin|sdk-csharp)/'
build_yml='^\.github/workflows/build\.yml$'

# Anything but prose. Markdown feeding the website is not prose here: the site's own pages, and the
# two operator docs it copies in, are checked by building it.
site_inputs='^(apps/site/|deploy/README\.md$|docs/licensing\.md$)'
if [ -n "$(first "$site_inputs")" ]; then
    flag tree "$site_inputs"
else
    flag tree '.' '^(docs/|\.claude/|LICENSE$)|\.md$'
fi

# The TypeScript workspace the test suite covers, the root config that shapes it, and the release
# scripts, whose tests the root config also runs.
flag node "^(apps/api/|apps/web/|plugins/|packages/|scripts/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|turbo\.json$|vitest\.config\.ts$)|${build_yml}" "${listener_sdks}|\.md$"

# Everything `pnpm codegen` reads or writes: the contracts, permissions and migrations under
# `apps/api`, the three SDKs, the website's API reference and spec, and the tool versions.
flag generated "^(apps/api/|packages/(sdk|sdk-kotlin|sdk-csharp)/|apps/site/docs/api-reference/|apps/site/static/|package\.json$|pnpm-lock\.yaml$)|${build_yml}"

flag sidecar "^analysis/|${build_yml}" '\.md$'
flag android "^(apps/android/|packages/sdk-kotlin/)|${build_yml}"
flag desktop "^(apps/desktop/|packages/sdk-csharp/)|${build_yml}"

# What the Dockerfile copies in, less what `.dockerignore` keeps out: the station's workspace, the
# audio chain, the sidecar, the pads and the image's own config. Tests and prose change nothing in it.
flag image "^(Dockerfile$|\.dockerignore$|docker/|stream/|nginx/snippets/|analysis/|assets/|apps/api/|apps/web/|plugins/|packages/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|turbo\.json$|\.github/workflows/images\.yml$)" "${listener_sdks}|/tests/|\.md$"
