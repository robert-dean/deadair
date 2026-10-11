#!/usr/bin/env bash
# The Docker Hub images the station's image is built from, one fully qualified reference a line.
#
#     .github/scripts/base-images.sh [extra ...]
#     .github/scripts/base-images.sh --syntax
#
# Read from the Dockerfile rather than listed, so that the mirror cannot drift from what the build
# pulls: every `FROM ${BASE_REGISTRY}/...` line, and the frontend its `# syntax=` line names, which
# BuildKit fetches from Docker Hub before it reads a single stage. Each argument is one more
# reference to list, for what the build pulls that is not in the Dockerfile (the builder image
# `setup-buildx-action` starts). A reference is written the way Docker would read it, so
# `docker/dockerfile:1` comes out as `docker.io/docker/dockerfile:1` and `node:26` as
# `docker.io/library/node:26`.
#
# `--syntax` prints the frontend alone, for `images.yml` to hand BuildKit as `BUILDKIT_SYNTAX`: the
# directive cannot read a build argument, so that is the only way to point it at the mirror.
#
# `release.yml` copies what this lists to GHCR (`mirror.sh`) and `images.yml` builds from that copy
# when it holds every one of them.

set -euo pipefail

DOCKERFILE="${DOCKERFILE:-Dockerfile}"

qualify() {
    local ref="$1" first="${1%%/*}"
    # A first part with a dot or a colon in it, or `localhost`, is a registry; anything else is a
    # path on Docker Hub, and a bare name is under `library/` there.
    if [ "$first" != "$ref" ] && { [[ "$first" == *.* ]] || [[ "$first" == *:* ]] || [ "$first" = localhost ]; }; then
        echo "$ref"
    elif [ "$first" = "$ref" ]; then
        echo "docker.io/library/$ref"
    else
        echo "docker.io/$ref"
    fi
}

# The parser directive counts only at the very top of the file.
syntax="$(sed -n '1s/^# *syntax *= *\([^ ]*\).*$/\1/p' "$DOCKERFILE")"

if [ "${1:-}" = --syntax ]; then
    if [ -n "$syntax" ]; then qualify "$syntax"; fi
    exit 0
fi

{
    if [ -n "$syntax" ]; then qualify "$syntax"; fi
    # shellcheck disable=SC2016 # the dollar is the Dockerfile's, matched literally
    sed -n 's/^FROM[[:space:]]\{1,\}\${BASE_REGISTRY}\/\([^[:space:]]*\).*$/docker.io\/\1/p' "$DOCKERFILE"
    for extra in "$@"; do qualify "$extra"; done
    # Docker Hub's alone: anything already elsewhere is not what the mirror is for.
} | awk '/^docker\.io\//' | sort -u
