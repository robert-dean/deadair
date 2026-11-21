#!/usr/bin/env bash
# First publish and trusted-publisher setup for the packages deadair puts on npm.
#
# npm's OIDC trusted publishing, which the `npm` job in .github/workflows/release.yml publishes with,
# can only publish a package that already exists AND already names a trusted publisher. A brand-new
# package has neither, so the first version and the trust config are made once, here, with your own
# npm login. After that every release publishes from CI with no token at all.
#
# Idempotent: a package already on npm is not published again, and a trust config that already
# points at this repository and workflow is left alone, so it is safe to re-run.
#
# Run it from anywhere in the repository. The first version is built from the release tag it belongs
# to, in a throwaway worktree, so the working tree you run it from does not matter.
#
# Requirements:
#   - npm >= 11.15.0, the first that has `npm trust` (`npm help trust` says so), and Node >= 22.14.
#     That is not release.yml's 11.5.1, which is the first npm that PUBLISHES with OIDC
#   - the `deadair` organisation on npmjs.com, which is what owns the @deadair scope, and
#     `npm login` as a member of it who may publish
#   - 2FA on that npm account: `npm trust` asks for a one-time password
#
# It exits nonzero if any package could not be published or trusted, and names it.

set -euo pipefail

# The owner/repo and the workflow file npm will accept an OIDC publish from. The job inside it is
# `npm`, and npm does not need its name. It runs in no GitHub environment, so a config that names
# one is refused there, and this treats it as stale.
REPO="robert-dean/deadair"
WORKFLOW_FILE="release.yml"
REQUIRED_NPM="11.15.0"

# What goes on npm. The `npm` job in release.yml publishes the two SDKs and nothing else, so this
# names them rather than globbing `packages/`: everything else there is private today, but a package
# made public without a publish step in CI would be trusted here and then never published again.
# Keep this list and PACKAGES in that job in step.
PACKAGES=(packages/plugin-sdk packages/sdk)

# Whether npm version $2 is at least $1.
version_at_least() {
    [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]
}

# Reads what `npm trust list <name> --json` printed, in $1, and answers one line:
#   NONE            no config
#   OK              exactly this repository's release.yml, allowed to publish, in no environment
#   MISMATCH:<id>   some other config, which has to be revoked by that id first
#   UNREADABLE      output that is not one config, which this will not guess about
# npm prints a config as one flat object, {id, type, file, repository, environment, permissions},
# and the registry holds at most one per package. More than one would print as several objects
# back to back, which is not JSON, hence UNREADABLE rather than a guess.
trust_state() {
    REPO="$REPO" WF="$WORKFLOW_FILE" RAW="$1" node -e '
        const raw = (process.env.RAW || "").trim();
        if (raw === "") { console.log("NONE"); process.exit(0); }
        let config;
        try { config = JSON.parse(raw); } catch { console.log("UNREADABLE"); process.exit(0); }
        if (Array.isArray(config)) {
            if (config.length === 0) { console.log("NONE"); process.exit(0); }
            if (config.length > 1) { console.log("UNREADABLE"); process.exit(0); }
            config = config[0];
        }
        if (!config || typeof config !== "object" || Object.keys(config).length === 0) { console.log("NONE"); process.exit(0); }
        const ok =
            config.type === "github" &&
            config.repository === process.env.REPO &&
            config.file === process.env.WF &&
            !config.environment &&
            Array.isArray(config.permissions) &&
            config.permissions.includes("createPackage");
        if (ok) { console.log("OK"); process.exit(0); }
        const id = typeof config.id === "string" || typeof config.id === "number" ? String(config.id) : "";
        console.log(id ? "MISMATCH:" + id : "UNREADABLE");
    '
}

# The throwaway worktree a first publish builds in, and the temporary folder holding it, removed
# however the script ends.
source_parent=""
source_tree=""
cleanup() {
    if [ -n "$source_tree" ]; then
        git worktree remove --force "$source_tree" > /dev/null 2>&1 || true
    fi
    if [ -n "$source_parent" ]; then
        rm -rf "$source_parent"
    fi
    source_tree=""
    source_parent=""
}

main() {
    cd "$(git rev-parse --show-toplevel)"

    # --- fail fast -----------------------------------------------------------------------------------

    npm whoami > /dev/null 2>&1 || {
        echo "Not logged in to npm. Run: npm login"
        exit 1
    }

    local current
    current="$(npm -v)"
    if ! version_at_least "$REQUIRED_NPM" "$current"; then
        echo "npm ${current} is too old: 'npm trust' needs ${REQUIRED_NPM} or later."
        echo "Upgrade with: npm install -g npm@latest"
        exit 1
    fi

    trap cleanup EXIT

    local failed=()
    local dir name seen version tag tagged raw state stale_id

    # --- per package ---------------------------------------------------------------------------------

    for dir in "${PACKAGES[@]}"; do
        name="$(node -p "require('./${dir}/package.json').name")"

        # 1. The first version, if npm has none.
        #
        # Built from a release tag rather than from this working tree, so the first version on npm is
        # the source that release shipped. Both SDKs are in the station's fixed version group, so a
        # package's version IS the station's and the tag is `v<version>`. The version is read from the
        # manifest in the checkout this runs from, which on main carries the last release's number
        # between releases, so there it names the newest tag.
        #
        # Only E404 means "not on npm". Anything else (no network, a refused login, a cache npm cannot
        # write) stops here, because guessing "absent" would try to publish over a package that exists.
        if seen="$(npm view "$name" version 2>&1)"; then
            echo "exists:   ${name}"
        elif printf '%s' "$seen" | grep -q E404; then
            version="$(node -p "require('./${dir}/package.json').version")"
            tag="v${version}"
            git fetch --quiet origin "refs/tags/${tag}:refs/tags/${tag}" 2> /dev/null || true
            if ! git rev-parse -q --verify "${tag}^{commit}" > /dev/null; then
                echo "${name} ${version} is not on npm, and there is no ${tag} tag to publish it from."
                echo "The first version has to be one the station released."
                exit 1
            fi

            source_parent="$(mktemp -d)"
            source_tree="${source_parent}/deadair-${tag}"
            git worktree add --quiet --detach "$source_tree" "$tag"
            tagged="$(node -p "require('${source_tree}/${dir}/package.json').version")"
            if [ "$tagged" != "$version" ]; then
                echo "${tag} has ${name} at ${tagged}, not ${version}. Is it still in the fixed version group?"
                exit 1
            fi

            # A package made public after the newest release is still private at its tag, and pnpm
            # refuses to publish it. That is not an error: the release that first ships it public is
            # the one to publish from, and until then CI warns about it and publishes nothing.
            if [ "$(node -p "require('${source_tree}/${dir}/package.json').private === true")" = true ]; then
                echo "skipped:  ${name} is private at ${tag}. Run this again once a release has shipped it public."
                cleanup
                continue
            fi

            echo "building: ${name} ${version} from ${tag}"
            (
                cd "$source_tree"
                pnpm install --frozen-lockfile --filter "${name}..."
                pnpm --filter "$name" build
            )

            # pnpm rather than npm, because pnpm is what rewrites any `workspace:` range in the
            # manifest and it is what release.yml publishes with. `--no-git-checks` because a detached
            # tag checkout is exactly what pnpm's branch check refuses, and the tag is the stronger
            # guarantee.
            echo "publish:  ${name} ${version} (first publish)"
            (cd "${source_tree}/${dir}" && pnpm publish --access public --no-git-checks)

            cleanup
        else
            printf '%s\n' "$seen" >&2
            echo "Could not ask npm whether ${name} exists (above). Stopping rather than guessing." >&2
            exit 1
        fi

        # 2. The trusted publisher. Left alone when it already is this repository's release.yml,
        #    allowed to publish; otherwise the stale config is revoked and a correct one created.
        if ! raw="$(npm trust list "$name" --json 2> /dev/null)"; then
            # Not fatal by itself: creating is what follows, and that fails loudly if this was more
            # than a package with nothing configured yet.
            raw=""
        fi
        state="$(trust_state "$raw")"

        case "$state" in
            OK)
                echo "trusted:  ${name} (already ${REPO} / ${WORKFLOW_FILE})"
                continue
                ;;
            UNREADABLE)
                printf '%s\n' "$raw" >&2
                echo "FAILED:   ${name}: 'npm trust list' printed something that is not one trust config (above)." >&2
                failed+=("$name")
                continue
                ;;
            MISMATCH:*)
                stale_id="${state#MISMATCH:}"
                echo "fixing:   ${name} (stale config ${stale_id}, replacing with ${REPO} / ${WORKFLOW_FILE})"
                if ! npm trust revoke "$name" --id="$stale_id"; then
                    echo "FAILED:   ${name}: could not revoke trust config ${stale_id}." >&2
                    failed+=("$name")
                    continue
                fi
                ;;
            *)
                echo "trusting: ${name} (${REPO} / ${WORKFLOW_FILE})"
                ;;
        esac

        if ! npm trust github "$name" --repository "$REPO" --file "$WORKFLOW_FILE" --allow-publish --yes; then
            echo "FAILED:   ${name}: could not create the trust config (one-time password needed?)." >&2
            failed+=("$name")
        fi
    done

    if [ "${#failed[@]}" -gt 0 ]; then
        echo "Not done: ${failed[*]} could not be trusted. CI cannot publish them until this succeeds." >&2
        exit 1
    fi
    echo "Done."
}

# Sourced (by scripts/tests), it only defines the functions above.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
