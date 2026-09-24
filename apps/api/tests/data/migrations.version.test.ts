// dbmate's reading of the migrations directory, checked before a database ever sees it.
//
// dbmate records a migration by its number alone, so two files sharing a number are one migration to it.
// A database that has the number recorded skips the second file as applied, and a walk from zero runs
// both and then fails inserting the number twice. The first half is silent: 0047 shipped twice, and a
// station that ran the messaging file first never relaxed the playlist constraint. A file whose name
// does not start with a number is skipped just as quietly, so it is caught here too.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The pattern dbmate matches a file name with (`migrationFileRegexp` in pkg/dbmate); the digits are the version.
const MIGRATION_FILE = /^(\d+).*\.sql$/;

const files = readdirSync(fileURLToPath(new URL('../../data/migrations', import.meta.url))).filter(name => name.endsWith('.sql'));

describe('the migrations directory', () => {
    it('names every file the way dbmate reads it', () => {
        expect(files.filter(name => !MIGRATION_FILE.test(name))).toEqual([]);
    });

    it('gives every migration a version of its own', () => {
        const byVersion = new Map<string, string[]>();
        for (const name of files) {
            const version = MIGRATION_FILE.exec(name)?.[1];
            if (version === undefined) continue;
            byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
        }
        const shared = [...byVersion.values()].filter(names => names.length > 1);
        expect(shared).toEqual([]);
    });
});
