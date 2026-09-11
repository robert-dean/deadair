#!/usr/bin/env bash
# First publish and trusted-publisher setup for the packages deadair puts on npm.
#
# npm's OIDC trusted publishing, which the `npm` job in .github/workflows/release.yml is meant to use,
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
#   - npm >= 11.5.1 (`npm trust` arrived there) and Node >= 22.14
#   - the `deadair` organisation on npmjs.com, which is what owns the @deadair scope, and
#     `npm login` as a member of it who may publish
#   - 2FA on that npm account: `npm trust` asks for a one-time password

set -euo pipefail

# The owner/repo and the workflow file npm will accept an OIDC publish from. The job inside it is
# `npm`, and npm does not need its name.
REPO="robert-dean/deadair"
WORKFLOW_FILE="release.yml"

# What goes on npm. The `npm` job in release.yml publishes the plugin SDK and nothing else, so this
# names it rather than globbing `packages/`: everything else there is private today, but a package
# made public without a publish step in CI would be trusted here and then never published again.
# Keep this list and that job in step.
PACKAGES=(packages/plugin-sdk)

cd "$(git rev-parse --show-toplevel)"

# --- fail fast ---------------------------------------------------------------------------------------

npm whoami > /dev/null 2>&1 || {
    echo "Not logged in to npm. Run: npm login"
    exit 1
}

required="11.5.1"
current="$(npm -v)"
if [ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -1)" != "$required" ]; then
    echo "npm ${current} is too old: 'npm trust' needs ${required} or later."
    echo "Upgrade with: npm install -g npm@latest"
    exit 1
fi

# The throwaway worktree a first publish builds in, removed however the script ends.
source_tree=""
cleanup() {
    if [ -n "$source_tree" ]; then
        git worktree remove --force "$source_tree" > /dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

# --- per package -------------------------------------------------------------------------------------

for dir in "${PACKAGES[@]}"; do
    name="$(node -p "require('./${dir}/package.json').name")"

    # 1. The first version, if npm has none.
    #
    # Built from a release tag rather than from this working tree, so the first version on npm is the
    # source that release shipped. The SDK is in the station's fixed version group, so its version IS
    # the station's and the tag is `v<version>`. The version is read from main's manifest, which
    # carries the last release's number between releases, so it names the newest tag.
    if npm view "$name" version > /dev/null 2>&1; then
        echo "exists:   ${name}"
    else
        version="$(node -p "require('./${dir}/package.json').version")"
        tag="v${version}"
        git fetch --quiet origin "refs/tags/${tag}:refs/tags/${tag}" 2> /dev/null || true
        if ! git rev-parse -q --verify "${tag}^{commit}" > /dev/null; then
            echo "${name} ${version} is not on npm, and there is no ${tag} tag to publish it from."
            echo "The first version has to be one the station released."
            exit 1
        fi

        source_tree="$(mktemp -d)/deadair-${tag}"
        git worktree add --quiet --detach "$source_tree" "$tag"
        tagged="$(node -p "require('${source_tree}/${dir}/package.json').version")"
        if [ "$tagged" != "$version" ]; then
            echo "${tag} has ${name} at ${tagged}, not ${version}. Is the SDK still in the fixed version group?"
            exit 1
        fi

        echo "building: ${name} ${version} from ${tag}"
        (
            cd "$source_tree"
            pnpm install --frozen-lockfile --filter "${name}..."
            pnpm --filter "$name" build
        )

        # pnpm rather than npm, because pnpm is what rewrites any `workspace:` range in the manifest
        # and it is what release.yml publishes with. `--no-git-checks` because a detached tag checkout
        # is exactly what pnpm's branch check refuses, and the tag is the stronger guarantee.
        echo "publish:  ${name} ${version} (first publish)"
        (cd "${source_tree}/${dir}" && pnpm publish --access public --no-git-checks)

        cleanup
        source_tree=""
    fi

    # 2. The trusted publisher. Left alone when it already points at this repository and workflow,
    #    otherwise the stale config is revoked and a correct one created.
    raw="$(npm trust list "$name" --json 2> /dev/null || true)"
    state="$(REPO="$REPO" WF="$WORKFLOW_FILE" RAW="$raw" node -e '
        const raw = process.env.RAW || "";
        let data;
        try { data = JSON.parse(raw); } catch { console.log("NONE"); process.exit(0); }
        const configs = Array.isArray(data)
            ? data
            : data.trustedPublishers || data.publishers || data.configs || data.results || (data.id ? [data] : []);
        if (!configs || configs.length === 0) { console.log("NONE"); process.exit(0); }
        const matches = c => JSON.stringify(c).includes(process.env.REPO) && JSON.stringify(c).includes(process.env.WF);
        if (configs.some(matches)) { console.log("OK"); process.exit(0); }
        let id;
        const findId = o => {
            if (!o || typeof o !== "object" || id) return;
            for (const k of Object.keys(o)) {
                if (k === "id" && (typeof o[k] === "string" || typeof o[k] === "number")) { id = String(o[k]); return; }
                findId(o[k]);
            }
        };
        configs.forEach(findId);
        console.log("MISMATCH:" + (id || ""));
    ')"

    case "$state" in
        OK)
            echo "trusted:  ${name} (already ${REPO} / ${WORKFLOW_FILE})"
            ;;
        MISMATCH:*)
            stale_id="${state#MISMATCH:}"
            echo "fixing:   ${name} (stale config, replacing with ${REPO} / ${WORKFLOW_FILE})"
            if [ -n "$stale_id" ]; then
                npm trust revoke "$name" --id="$stale_id" || echo "  WARN: revoke failed for ${name} (id ${stale_id})" >&2
            else
                echo "  WARN: could not read the existing trust id for ${name}; creating the new one anyway" >&2
            fi
            npm trust github "$name" --repository "$REPO" --file "$WORKFLOW_FILE" --allow-publish --yes ||
                echo "  WARN: trust config failed for ${name} (one-time password needed?)" >&2
            ;;
        *)
            echo "trusting: ${name} (${REPO} / ${WORKFLOW_FILE})"
            npm trust github "$name" --repository "$REPO" --file "$WORKFLOW_FILE" --allow-publish --yes ||
                echo "  WARN: trust config failed for ${name} (already set? one-time password needed?)" >&2
            ;;
    esac
done

echo "Done."
