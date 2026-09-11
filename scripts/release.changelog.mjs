// The pure half of `release.version.mjs`: what goes into a changelog entry, where it goes, and the
// two build files each listener app's version is mirrored into. Nothing here touches the disk, so
// all of it is tested by `tests/release.changelog.test.ts`.

export const REPO = 'https://github.com/robert-dean/deadair';

/**
 * The three things this tree releases. The station is every versioned package that ships in the
 * image, sharing one number through the `fixed` group in `.changeset/config.json`, so its version is
 * read off `apps/api` as a representative. The two listener apps have a manifest each for no reason
 * but this one.
 *
 * `tag` is the git tag a version is released under, which the changelog's compare links name. The
 * station's is cut by `release.yml`; the apps' are pushed by hand (Android) or cut by their release
 * workflow (desktop), in namespaces of their own because the bare `v*` belongs to the station.
 */
export const UNITS = [
    { id: 'station', label: 'Station', manifest: 'apps/api/package.json', changelog: 'CHANGELOG.md', tag: version => `v${version}` },
    {
        id: 'android',
        label: 'Android',
        manifest: 'apps/android/package.json',
        changelog: 'apps/android/CHANGELOG.md',
        tag: version => `android-v${version}`,
    },
    {
        id: 'desktop',
        label: 'Desktop',
        manifest: 'apps/desktop/package.json',
        changelog: 'apps/desktop/CHANGELOG.md',
        tag: version => `desktop-v${version}`,
    },
];

/**
 * Where each listener app's version is written a second time, for the build tool that stamps the
 * artifact. Gradle and MSBuild cannot read a package.json, so the number is copied into these and
 * `--check` fails CI when a hand edit moves one copy without the other.
 *
 * Each pattern must match exactly once. `Directory.Build.props` holds the app's `<Version>`; the
 * desktop plugin SDK's own `<Version>` is the plugin ABI, lives in a different file, and is never
 * opened here.
 */
export const MIRRORS = [
    { unit: 'android', file: 'apps/android/app/build.gradle.kts', pattern: /^(\s*versionName = ")([^"]*)(")$/gm },
    { unit: 'desktop', file: 'apps/desktop/Directory.Build.props', pattern: /(<Version>)([^<]*)(<\/Version>)/g },
];

const BUMP_ORDER = { major: 0, minor: 1, patch: 2 };

/**
 * Which release unit a package belongs to, or `undefined` for a package that is not versioned at
 * all (the site and the shared configs, named in the config's `ignore`).
 */
export function unitOf(name, ignored) {
    if (ignored.includes(name)) {
        return undefined;
    }
    if (name === '@deadair/android') {
        return 'android';
    }
    if (name === '@deadair/desktop') {
        return 'desktop';
    }
    return 'station';
}

/**
 * The changesets that belong in one unit's entry, most significant first. A changeset naming
 * packages in two units appears in both, ranked by the bump it asks of this one.
 *
 * `changesets` is `{ id, summary, releases: [{ name, type }] }[]`, in the order they should appear
 * when their bumps are equal.
 */
export function changesetsFor(unit, changesets, ignored) {
    const picked = [];
    for (const changeset of changesets) {
        const types = changeset.releases
            .filter(release => release.type !== 'none' && unitOf(release.name, ignored) === unit)
            .map(release => release.type);
        if (types.length > 0) {
            picked.push({ changeset, rank: Math.min(...types.map(type => BUMP_ORDER[type])) });
        }
    }
    return picked.sort((a, b) => a.rank - b.rank).map(entry => entry.changeset);
}

/** One bullet per summary, continuation lines indented under it so a paragraph stays one item. */
export function renderBullets(summaries) {
    return summaries
        .map(summary =>
            summary
                .trim()
                .split('\n')
                .map((line, index) => (index === 0 ? `- ${line}` : line.trim() === '' ? '' : `  ${line}`))
                .join('\n'),
        )
        .join('\n');
}

/**
 * The changelog with a new version's entry added directly under `## [Unreleased]`.
 *
 * The heading keeps the file's existing shape, em dash included: `release.yml` cuts a release's
 * notes out of the file by matching `## [<version>]` at the start of a line and reading to the next
 * `## [` or the first link reference, so this shape is a contract rather than a style. Anything
 * already written under `[Unreleased]` by hand ends up under the new heading, after the bullets,
 * which is where it belongs: it is released with this version.
 *
 * When the unit has tags and the file has an `[Unreleased]:` link, that link is moved on and one is
 * added for the new version, comparing it with the previous one.
 */
export function insertEntry(text, { version, previous, date, body, tag }) {
    const marker = /^## \[Unreleased\][^\n]*\n/m;
    const match = marker.exec(text);
    if (!match) {
        throw new Error('it has no "## [Unreleased]" heading to put the new entry under');
    }
    const cut = match.index + match[0].length;
    let out = `${text.slice(0, cut)}\n## [${version}] — ${date}\n\n${body}\n${text.slice(cut)}`;

    const link = /^\[Unreleased\]: .*$/m;
    if (tag && link.test(out)) {
        out = out.replace(
            link,
            `[Unreleased]: ${REPO}/compare/${tag(version)}...HEAD\n[${version}]: ${REPO}/compare/${tag(previous)}...${tag(version)}`,
        );
    }
    return out;
}

function onlyMatch(text, mirror) {
    const matches = [...text.matchAll(mirror.pattern)];
    if (matches.length !== 1) {
        throw new Error(`${mirror.file} should say its version exactly once and says it ${matches.length} times`);
    }
    return matches[0];
}

/** The version a mirror file currently states. */
export function readMirror(text, mirror) {
    return onlyMatch(text, mirror)[2];
}

/** The mirror file with its version replaced. */
export function writeMirror(text, mirror, version) {
    const match = onlyMatch(text, mirror);
    const start = match.index + match[1].length;
    return text.slice(0, start) + version + text.slice(start + match[2].length);
}

/**
 * The body of the version pull request: each unit that moved, what it moved between, and the
 * entry that will be written for it.
 */
export function pullRequestBody(released) {
    const sections = released.map(({ label, previous, version, body }) => `### ${label} ${previous} to ${version}\n\n${body}`);
    return [
        ...sections,
        'Merging this releases the station: `release.yml` sees a version with no tag, tags it once the tests pass, and publishes the GitHub release from `CHANGELOG.md`. The listener apps are numbered here and published by their own workflows.',
        'This pull request was opened with the workflow token, so no checks run on it. The merge runs every one of them before anything is tagged. To change what an entry says, edit the changeset on `main`; this branch is rebuilt from `main` on every push.',
    ].join('\n\n');
}
