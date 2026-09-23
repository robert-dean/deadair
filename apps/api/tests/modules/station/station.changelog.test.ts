// The changelog reader. The real file is read as well as the fixtures, because the shape worth pinning
// is the one `scripts/release.version.mjs` actually writes: a parser that passes on a tidy fixture and
// reads the link definitions at the bottom of the real file as 0.1.0's notes is the failure to catch.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { BundledChangelog, parseChangelog } from '../../../src/modules/station/station.changelog.js';

const SAMPLE = `# Changelog

Notable changes to deadair, newest first.

## [Unreleased]

## [0.26.2] — 2026-09-23

- An API key is no longer lost. (#242)

## [0.26.1] — 2026-09-22

- The conspiracy host has been rewritten.
- A persona can now be keen on trivia.

  Set it on the persona's page.

## [0.1.0] — 2026-09-09

### The station

The first release.

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.26.2...HEAD
[0.26.2]: https://github.com/robert-dean/deadair/compare/v0.26.1...v0.26.2
`;

describe('parseChangelog', () => {
    it('reads every release, newest first, with its date and its notes', () => {
        const entries = parseChangelog(SAMPLE);

        expect(entries.map(entry => entry.version)).toEqual(['0.26.2', '0.26.1', '0.1.0']);
        expect(entries[0]).toEqual({ version: '0.26.2', date: '2026-09-23', notes: '- An API key is no longer lost. (#242)' });
        expect(entries[1]!.notes).toBe(
            "- The conspiracy host has been rewritten.\n- A persona can now be keen on trivia.\n\n  Set it on the persona's page.",
        );
    });

    it('leaves out Unreleased, which is not a release', () => {
        expect(parseChangelog(SAMPLE).some(entry => entry.version === 'Unreleased')).toBe(false);
    });

    it('keeps a third-level heading inside an entry and drops the link definitions after the last one', () => {
        expect(parseChangelog(SAMPLE)[2]!.notes).toBe('### The station\n\nThe first release.');
    });

    it('takes a retyped heading with a hyphen or no date', () => {
        const entries = parseChangelog('## [1.2.3] - 2026-01-02\n\nOne.\n\n## [1.2.2]\n\nTwo.\n');

        expect(entries).toEqual([
            { version: '1.2.3', date: '2026-01-02', notes: 'One.' },
            { version: '1.2.2', notes: 'Two.' },
        ]);
    });

    it('answers nothing for a file with no releases in it', () => {
        expect(parseChangelog('')).toEqual([]);
        expect(parseChangelog('# Changelog\n\n## [Unreleased]\n')).toEqual([]);
    });

    it('reads the repository changelog as releases with nothing left over', async () => {
        const text = await readFile(new URL('../../../../../CHANGELOG.md', import.meta.url), 'utf8');
        const entries = parseChangelog(text);

        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(entry.notes).not.toMatch(/^\[[^\]]+\]: https?:/m);
            expect(entry.notes.length).toBeLessThanOrEqual(40000);
        }
    });
});

describe('BundledChangelog', () => {
    it('names the newest release as the one this build contains', () => {
        expect(new BundledChangelog(parseChangelog(SAMPLE)).current).toBe('0.26.2');
    });

    it('names nothing when there was no changelog to read', () => {
        expect(new BundledChangelog().current).toBeUndefined();
    });
});
