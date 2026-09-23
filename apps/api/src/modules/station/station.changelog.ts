/**
 * One release, as the changelog entry for it reads.
 *
 * Plain strings rather than the contract's `DateTime`, because this is read off a file and handed on
 * by the service, which is where the wire shape is made.
 */
export interface ChangelogEntry {
    /** The release without its tag's leading `v`: `0.26.2`. */
    version: string;
    /** The ISO date the heading names, when it names one. */
    date?: string;
    /** The Markdown under the heading, trimmed. Empty for a release that recorded nothing. */
    notes: string;
}

/**
 * A release heading as `scripts/release.version.mjs` writes it: `## [0.26.2] — 2026-09-23`.
 *
 * The dash is matched loosely (an em dash, an en dash or a hyphen) and the date is optional, because
 * the file is hand-editable and a heading somebody retyped should still be a release. `[Unreleased]`
 * does not match, deliberately: it is not a release, and on `main` it is always empty anyway, since
 * what is pending lives in `.changeset/` until the version pull request writes it here.
 */
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

/** Any second-level heading, which is what ends an entry whether it is a release or not. */
const SECTION_HEADING = /^## /;

/**
 * A Markdown link reference definition, `[0.26.2]: https://…`. The file ends with a block of these
 * for the headings above, and without dropping them they would read as the oldest release's notes.
 */
const LINK_DEFINITION = /^\[[^\]]+\]:\s+\S+/;

/**
 * Every release in a changelog, in the order the file lists them, which is newest first.
 *
 * Pure over the text, so it is tested against the real file and against the shapes a hand edit could
 * leave. It never throws: a file with no release headings in it is an empty answer, which is also
 * what a build with no changelog at all gets.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    let current: { version: string; date?: string; lines: string[] } | undefined;

    const close = () => {
        if (current === undefined) return;
        entries.push({
            version: current.version,
            ...(current.date === undefined ? {} : { date: current.date }),
            notes: current.lines.join('\n').trim(),
        });
        current = undefined;
    };

    for (const line of text.split(/\r?\n/)) {
        if (SECTION_HEADING.test(line)) {
            close();
            const match = RELEASE_HEADING.exec(line);
            if (match !== null) {
                current = { version: match[1]!, ...(match[2] === undefined ? {} : { date: match[2] }), lines: [] };
            }
            continue;
        }
        if (current !== undefined && !LINK_DEFINITION.test(line)) {
            current.lines.push(line);
        }
    }
    close();

    return entries;
}

/**
 * The changelog this build was made with, read once at boot.
 *
 * A DI token rather than a behaviour, like `BuildRevision`, and for the same reason: it is a fact about
 * the binary. The file is part of the image (the Dockerfile copies it beside the app) and cannot
 * change while the process runs, so reading it per request would suggest otherwise and would cost a
 * file read of about 90KB on every visit to a page that asks.
 */
export class BundledChangelog {
    constructor(readonly entries: readonly ChangelogEntry[] = []) {}

    /** The newest release this build contains, or nothing when there was no changelog to read. */
    get current(): string | undefined {
        return this.entries[0]?.version;
    }
}

/**
 * Orders two `major.minor.patch` versions: negative when `a` is older, positive when newer.
 *
 * Numeric per part, because as strings `0.10.0` sorts before `0.9.0`. Anything past the three numbers
 * (a prerelease suffix) is ignored, which is safe here because nothing this reads is a prerelease: the
 * changelog heading pattern refuses one and the release check filters them out before comparing.
 */
export function compareVersions(a: string, b: string): number {
    const pa = parts(a);
    const pb = parts(b);
    for (let i = 0; i < 3; i++) {
        const diff = pa[i]! - pb[i]!;
        if (diff !== 0) return diff;
    }
    return 0;
}

function parts(version: string): number[] {
    const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/, 3).map(part => Number.parseInt(part, 10) || 0);
    return [major, minor, patch];
}
