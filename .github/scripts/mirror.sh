#!/usr/bin/env bash
# Copy the Docker Hub images the station is built from to the GHCR mirror, where any has moved.
#
#     MIRROR=ghcr.io/robert-dean/deadair-mirror mirror.sh [extra ...]
#
# What to copy is `base-images.sh`'s list, extras passed through. Each one keeps its Docker Hub path
# under MIRROR, so `docker.io/library/node:26-trixie-slim` becomes `$MIRROR/library/node:26-trixie-slim`,
# which is what lets the Dockerfile swap one for the other with a single argument.
#
# It ASKS before it copies, and asks with a HEAD (`crane digest`), which Docker Hub does not count
# against the pull limit. A base whose digest matches the mirror's is left alone, which on most runs is
# all of them, so a run costs a handful of requests and no pulls. A floating tag (`golang:1-trixie`)
# that upstream moved is copied whole, every platform in its index, so the mirror's digest is the
# source's and the next run's comparison means something.
#
# It never fails the run. A base Docker Hub will not answer for, or one that will not copy, is a
# warning, and the mirror keeps what it had: one release built on last week's `node` is better than
# no release, and `images.yml` falls back to Docker Hub for a base the mirror has never held. The
# warning is the record, so it names the base.
#
# Needs `crane` on the PATH, logged in to both registries through the Docker config (`login-action`
# writes it). Reads MIRROR, and DOCKERFILE as `base-images.sh` does.

set -uo pipefail

: "${MIRROR:?MIRROR is the GHCR path to copy under}"

here="$(dirname "$0")"
refs="$("$here/base-images.sh" "$@")" || exit 1

while read -r src; do
    dst="$MIRROR/${src#docker.io/}"
    if ! want="$(crane digest "$src" 2>&1)"; then
        echo "::warning::Could not read ${src} from Docker Hub, so the mirror keeps what it had: ${want}"
        continue
    fi
    have="$(crane digest "$dst" 2>/dev/null || true)"
    if [ "$have" = "$want" ]; then
        echo "${src} is ${want}, as mirrored."
        continue
    fi
    echo "${src} is ${want}, the mirror ${have:-has none}; copying."
    if ! out="$(crane copy "$src" "$dst" 2>&1)"; then
        echo "::warning::Could not copy ${src} to ${dst}, so the mirror keeps what it had: ${out}"
    fi
done <<< "$refs"
