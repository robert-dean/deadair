#!/usr/bin/env bash
# Move the published tags of some image variants onto this commit, after its tests have passed.
#
#     IMAGE=deadair/deadair promote.sh latest slim full
#
# Each argument is a variant's MUTABLE tag. Its commit tag is that name and a dash in front of the
# sha, except `latest`, whose commit tag is the bare sha (see the variant table in images.yml). For
# each one this moves the mutable tag, then publishes the exact version and moves the release line
# when VERSION and LINE say this run is a release. Every move is a registry-side retag
# (`imagetools create`), so nothing is pulled, rebuilt or pushed.
#
# A script rather than steps in release.yml because two jobs run it: `promote` for the three tags the
# station follows and `promote-apple` for their Apple Music twins, which are kept off the station's
# path on purpose. One copy of the never-backwards rule below is the point.
#
# Reads IMAGE, GITHUB_REF, GITHUB_SHA, GITHUB_REPOSITORY and RUNNER_TEMP from the runner, GH_TOKEN for
# the compare API, and VERSION and LINE, either of which may be empty.

set -euo pipefail

: "${IMAGE:?IMAGE is the repository to retag in}"
VERSION="${VERSION:-}"
LINE="${LINE:-}"

prefix() {
    if [ "$1" = latest ]; then echo ''; else echo "$1-"; fi
}

# Never BACKWARDS. A run can get here for a commit older than the one the tags already name, when its
# push arrived late and a newer commit's run promoted first (see `head` in release.yml). Moving the
# tags then rewinds every station that follows them, which is what 758b932a's run did to 0.27.2 on
# 2026-09-23. So each tag moves only if this commit is not behind the one the tag names. That commit
# is read from the image's own revision label, and the API compares the two.
#
# "Not behind" rather than "is main's head", deliberately. A head that changed nothing in the image
# builds and promotes nothing, so the head rule would leave this commit's image unpromoted behind a
# README typo merged after it, whether the typo landed while this ran or ahead of a late push. Ahead of
# the tag, this is the newest image there is, and a newer one queued behind it moves the tags on again
# when its run comes. Identical moves: a manual run rebuilding the same commit for a base image's fix
# is exactly the run meant to move them, and the price is that a duplicate run redeploys the same
# code. A tag naming a commit this one has not got in its history (diverged, or unknown to GitHub)
# means main was rewritten, and main wins. A tag with no label, or none at all, has nothing to protect.
move() {
    local tag="$1" source="$2" config named status=""
    # `.Image` is one config for a single-platform image and a map of them by platform otherwise. All
    # the platforms carry the same revision.
    if config="$(docker buildx imagetools inspect "${IMAGE}:${tag}" --format '{{json .Image}}')"; then
        named="$(printf '%s' "$config" | jq -r 'if has("config") then . else first(.[]) end | .config.Labels["org.opencontainers.image.revision"] // ""')"
    else
        echo "::warning::Could not read ${IMAGE}:${tag}, so there is nothing to compare against and it moves."
        named=""
    fi

    if [ -n "$named" ]; then
        if ! status="$(gh api "repos/${GITHUB_REPOSITORY}/compare/${named}...${GITHUB_SHA}" --jq .status 2> "${RUNNER_TEMP}/compare.err")"; then
            if ! grep -q 'HTTP 404' "${RUNNER_TEMP}/compare.err"; then
                cat "${RUNNER_TEMP}/compare.err" >&2
                return 1
            fi
            status=unknown
        fi
    fi

    if [ "$status" = behind ]; then
        echo "::notice::${IMAGE}:${tag} names ${named}, which is newer than ${GITHUB_SHA}, so it stays. This run is late, and a newer run owns the tag."
        return 0
    fi
    echo "Moving ${IMAGE}:${tag} from ${named:-nothing} (${status:-no revision}) onto ${source}."
    docker buildx imagetools create --tag "${IMAGE}:${tag}" "${IMAGE}:${source}"
}

# From main only. A manual run pointed at a branch is usually AHEAD of what the tags name, and would
# move `latest` onto a commit main never had. Its sha tags are published anyway.
#
# None of this touches a release run's own work. The version tags and the release line below run as
# before: this skips a tag, it never fails the job for being late.
if [ "${GITHUB_REF}" = refs/heads/main ]; then
    for tag in "$@"; do
        move "$tag" "$(prefix "$tag")${GITHUB_SHA}"
    done
else
    echo "::notice::Not main, so $* stay where they are."
fi

# The exact version (`0.1.0`, `slim-0.1.0`, `full-0.1.0`) on a release run. Here rather than in the
# images job because a release whose tests fail is retried at the same version by the next push, so a
# version tag published before the tests could name an image that never passed them.
if [ -n "$VERSION" ]; then
    for tag in "$@"; do
        docker buildx imagetools create --tag "${IMAGE}:$(prefix "$tag")${VERSION}" "${IMAGE}:$(prefix "$tag")${GITHUB_SHA}"
    done
fi

# The release LINE (`0.1`, `slim-0.1`, `full-0.1`), which is the tag to pin to follow releases without
# pinning one. It moves, so it waits for the tests too.
if [ -n "$LINE" ]; then
    for tag in "$@"; do
        docker buildx imagetools create --tag "${IMAGE}:$(prefix "$tag")${LINE}" "${IMAGE}:$(prefix "$tag")${GITHUB_SHA}"
    done
fi
