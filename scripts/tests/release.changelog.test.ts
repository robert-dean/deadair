import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    MIRRORS,
    REPO,
    UNITS,
    changesetsFor,
    insertEntry,
    pullRequestBody,
    readMirror,
    renderBullets,
    unitOf,
    writeMirror,
} from '../release.changelog.mjs';

const root = resolve(import.meta.dirname, '../..');
const ignored = ['@deadair/site', '@repo/config-eslint'];
const station = UNITS.find(unit => unit.id === 'station')!;
const desktop = UNITS.find(unit => unit.id === 'desktop')!;
const android = MIRRORS.find(mirror => mirror.unit === 'android')!;
const props = MIRRORS.find(mirror => mirror.unit === 'desktop')!;

const changelog = `# Changelog

Intro.

## [Unreleased]

## [0.1.0] — 2026-09-09

The first release.

### Known limits

- Some.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

/** Every `awk` program a workflow uses to cut notes out of a changelog, keyed by the file it reads. */
function awkPrograms(workflow: string): Map<string, string> {
    const text = readFileSync(join(root, '.github/workflows', workflow), 'utf8');
    const programs = new Map<string, string>();
    for (const match of text.matchAll(/awk -v v="## \[\$\{VERSION\}\]" '([^']*)' (\S*CHANGELOG\.md)/g)) {
        programs.set(match[2], match[1]);
    }
    return programs;
}

function runAwk(program: string, version: string, text: string): string {
    const file = join(mkdtempSync(join(tmpdir(), 'changelog-')), 'CHANGELOG.md');
    writeFileSync(file, text);
    return execFileSync('awk', ['-v', `v=## [${version}]`, program, file], { encoding: 'utf8' });
}

describe('unitOf', () => {
    it('puts each listener app in its own unit and everything else versioned in the station', () => {
        expect(unitOf('@deadair/android', ignored)).toBe('android');
        expect(unitOf('@deadair/desktop', ignored)).toBe('desktop');
        expect(unitOf('@deadair/plugin-rss', ignored)).toBe('station');
        expect(unitOf('@deadair/api', ignored)).toBe('station');
    });

    it('puts an ignored package in no unit', () => {
        expect(unitOf('@deadair/site', ignored)).toBeUndefined();
    });
});

describe('changesetsFor', () => {
    const changesets = [
        { id: 'a', summary: 'A patch to the console.', releases: [{ name: '@deadair/web', type: 'patch' }] },
        { id: 'b', summary: 'A feature in a plugin.', releases: [{ name: '@deadair/plugin-rss', type: 'minor' }] },
        {
            id: 'c',
            summary: 'Both ends.',
            releases: [
                { name: '@deadair/api', type: 'patch' },
                { name: '@deadair/android', type: 'minor' },
            ],
        },
        { id: 'd', summary: 'Nothing to release.', releases: [{ name: '@deadair/api', type: 'none' }] },
        { id: 'e', summary: 'Website only.', releases: [{ name: '@deadair/site', type: 'patch' }] },
    ];

    it('ranks by bump, keeping file order among equals', () => {
        expect(changesetsFor('station', changesets, ignored).map(changeset => changeset.id)).toEqual(['b', 'a', 'c']);
    });

    it('puts a changeset naming two units in both', () => {
        expect(changesetsFor('android', changesets, ignored).map(changeset => changeset.id)).toEqual(['c']);
    });

    it('leaves out a unit nothing named', () => {
        expect(changesetsFor('desktop', changesets, ignored)).toEqual([]);
    });
});

describe('renderBullets', () => {
    it('makes one bullet per summary and indents a paragraph under its own bullet', () => {
        expect(renderBullets(['One line.', 'First line\nsecond line.\n\nA second paragraph.'])).toBe(
            '- One line.\n- First line\n  second line.\n\n  A second paragraph.',
        );
    });
});

describe('insertEntry', () => {
    const entry = { version: '0.2.0', previous: '0.1.0', date: '2026-09-12', body: '- A change.', tag: station.tag };

    it('adds the entry under [Unreleased] and moves the links on', () => {
        const out = insertEntry(changelog, entry);
        expect(out).toContain('## [Unreleased]\n\n## [0.2.0] — 2026-09-12\n\n- A change.\n\n## [0.1.0] — 2026-09-09');
        expect(out).toContain(
            `[Unreleased]: ${REPO}/compare/v0.2.0...HEAD\n[0.2.0]: ${REPO}/compare/v0.1.0...v0.2.0\n[0.1.0]: ${REPO}/releases/tag/v0.1.0`,
        );
    });

    it('uses the unit’s own tag names in the links', () => {
        const out = insertEntry(changelog.replace(/v0\.1\.0/g, 'desktop-v0.1.0'), { ...entry, tag: desktop.tag });
        expect(out).toContain(`[0.2.0]: ${REPO}/compare/desktop-v0.1.0...desktop-v0.2.0`);
    });

    it('writes no links for a unit with no tags', () => {
        const out = insertEntry(changelog, { ...entry, tag: undefined });
        expect(out).toContain(`[Unreleased]: ${REPO}/compare/v0.1.0...HEAD\n[0.1.0]:`);
        expect(out).not.toContain('[0.2.0]:');
    });

    it('releases whatever was written under [Unreleased] by hand with the new version', () => {
        const out = insertEntry(changelog.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Written by hand.\n'), entry);
        expect(out).toContain('## [0.2.0] — 2026-09-12\n\n- A change.\n\n- Written by hand.\n\n## [0.1.0]');
    });

    it('refuses a file with no [Unreleased] heading', () => {
        expect(() => insertEntry('# Changelog\n', entry)).toThrow(/Unreleased/);
    });
});

describe('the release workflow’s notes', () => {
    const [[file, program]] = [...awkPrograms('release.yml')];

    it('are cut from the root changelog', () => {
        expect(file).toBe('CHANGELOG.md');
    });

    it('are exactly the new entry, stopping at the previous heading', () => {
        const out = insertEntry(changelog, {
            version: '0.2.0',
            previous: '0.1.0',
            date: '2026-09-12',
            body: renderBullets(['A change\nover two lines.', 'Another.']),
            tag: station.tag,
        });
        expect(runAwk(program, '0.2.0', out).trim()).toBe('- A change\n  over two lines.\n- Another.');
    });

    it('stop at the link references for the oldest entry', () => {
        expect(runAwk(program, '0.1.0', changelog).trim()).toBe('The first release.\n\n### Known limits\n\n- Some.');
    });

    it('find the entry already in the real changelog', () => {
        const version = JSON.parse(readFileSync(join(root, station.manifest), 'utf8')).version;
        expect(runAwk(program, version, readFileSync(join(root, station.changelog), 'utf8')).trim()).not.toBe('');
    });
});

describe('the desktop release’s notes', () => {
    const programs = awkPrograms('desktop-release.yml');

    it('are cut from the desktop changelog, by the same program as the station’s', () => {
        expect([...programs.keys()]).toEqual(['apps/desktop/CHANGELOG.md']);
        expect(programs.get('apps/desktop/CHANGELOG.md')).toBe([...awkPrograms('release.yml').values()][0]);
    });

    it('find the entry already in the real desktop changelog', () => {
        const version = JSON.parse(readFileSync(join(root, desktop.manifest), 'utf8')).version;
        const program = programs.get('apps/desktop/CHANGELOG.md')!;
        expect(runAwk(program, version, readFileSync(join(root, desktop.changelog), 'utf8')).trim()).toMatch(/^- The desktop listener/);
    });
});

describe('the mirrored versions', () => {
    const gradle = 'android {\n    defaultConfig {\n        versionCode = gitCommitCount.get()\n        versionName = "0.1.0"\n    }\n}\n';
    const xml = '<Project>\n  <PropertyGroup>\n    <Version>0.1.0</Version>\n  </PropertyGroup>\n</Project>\n';

    it('are read and rewritten in Gradle', () => {
        expect(readMirror(gradle, android)).toBe('0.1.0');
        expect(writeMirror(gradle, android, '0.2.0')).toBe(gradle.replace('"0.1.0"', '"0.2.0"'));
    });

    it('are read and rewritten in MSBuild', () => {
        expect(readMirror(xml, props)).toBe('0.1.0');
        expect(writeMirror(xml, props, '1.0.0')).toBe(xml.replace('0.1.0', '1.0.0'));
    });

    it('refuse a file that states the version twice or not at all', () => {
        expect(() => readMirror(xml + xml, props)).toThrow(/2 times/);
        expect(() => writeMirror('<Project />', props, '1.0.0')).toThrow(/0 times/);
    });

    it('each match exactly once in the real file, and agree with its manifest', () => {
        for (const mirror of MIRRORS) {
            const manifest = UNITS.find(unit => unit.id === mirror.unit)!.manifest;
            const version = JSON.parse(readFileSync(join(root, manifest), 'utf8')).version;
            expect(readMirror(readFileSync(join(root, mirror.file), 'utf8'), mirror)).toBe(version);
        }
    });
});

describe('pullRequestBody', () => {
    it('lists each unit that moved with its entry', () => {
        const body = pullRequestBody([{ label: 'Station', previous: '0.1.0', version: '0.2.0', body: '- A change.' }]);
        expect(body).toMatch(/^### Station 0\.1\.0 to 0\.2\.0\n\n- A change\.\n\n/);
        expect(body).toContain('no checks run on it');
    });
});
