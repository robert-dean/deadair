// The archive: what Liquidsoap recorded, read back, and the nightly sweep over it.
//
// Against a real temp directory laid out the way radio.liq lays it out, because what is worth
// pinning is how files and sidecars are read together: a closed file, one still being written, one a
// crash cut short, and an id that tries to climb out of the root.

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ArchiveStore, IN_PROGRESS_GRACE_MS } from '../../../src/modules/stream/archive.store.js';
import { ARCHIVE_DEFAULTS, resolveArchiveDays } from '../../../src/modules/stream/archive.settings.js';
import { pruneArchive } from '../../../src/modules/stream/prune.archive.job.js';

const DAY_MS = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 9, 27, 22, 0, 0);

let root: string;
let store: ArchiveStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-archive-test-'));
    store = new ArchiveStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/** Writes one recording as radio.liq would, with its MP3 last written at `modifiedAt`. */
async function record(day: string, name: string, sidecar: object | undefined, modifiedAt: number, bytes = 1000): Promise<void> {
    await mkdir(join(root, day), { recursive: true });
    const mp3 = join(root, day, `${name}.mp3`);
    await writeFile(mp3, Buffer.alloc(bytes));
    if (sidecar !== undefined) await writeFile(join(root, day, `${name}.json`), JSON.stringify(sidecar));
    await utimes(mp3, new Date(modifiedAt), new Date(modifiedAt));
}

const configWith = (value: string | undefined) => ({ get: (_key: string, fallback: unknown) => value ?? fallback }) as unknown as AppConfig;

describe('ArchiveStore', () => {
    it('reads a closed recording from its file and its sidecar', async () => {
        const started = NOW - 2 * 3600_000;
        await record(
            '2026-10-27',
            '20-00-00-live',
            { kind: 'live', title: 'Pirate Hour', startedAtMs: started, endedAtMs: started + 3600_000 },
            started + 3600_000,
            4096,
        );

        const [one] = await store.list(NOW);

        expect(one).toMatchObject({ id: '2026-10-27T20-00-00-live', kind: 'live', title: 'Pirate Hour', bytes: 4096, recording: false });
        expect(one?.startedAt.toMillis()).toBe(started);
        expect(one?.endedAt?.toMillis()).toBe(started + 3600_000);
    });

    it('lists the newest first, across days', async () => {
        await record('2026-10-26', '23-00-00-hour', { startedAtMs: NOW - DAY_MS, endedAtMs: NOW - DAY_MS + 1 }, NOW - DAY_MS);
        await record('2026-10-27', '21-00-00-hour', { startedAtMs: NOW - 3600_000, endedAtMs: NOW - 1 }, NOW - 1000 * 120);

        expect((await store.list(NOW)).map(r => r.id)).toEqual(['2026-10-27T21-00-00-hour', '2026-10-26T23-00-00-hour']);
    });

    it('takes a file with no end that is still growing for one being written', async () => {
        await record('2026-10-27', '21-30-00-live', { title: 'On now', startedAtMs: NOW - 600_000 }, NOW - 1000);

        const [one] = await store.list(NOW);

        expect(one?.recording).toBe(true);
        expect(one?.endedAt).toBeUndefined();
    });

    it('takes a file with no end that stopped growing for one a crash cut short, ended when it last grew', async () => {
        const lastWrite = NOW - IN_PROGRESS_GRACE_MS - 5000;
        await record('2026-10-27', '21-00-00-hour', { startedAtMs: NOW - 1800_000 }, lastWrite);

        const [one] = await store.list(NOW);

        expect(one?.recording).toBe(false);
        expect(one?.endedAt?.toMillis()).toBe(lastWrite);
    });

    it('still lists a recording whose sidecar is missing or unreadable, untitled', async () => {
        await record('2026-10-27', '19-00-00-live', undefined, NOW - 3600_000);
        await writeFile(join(root, '2026-10-27', '18-00-00-hour.mp3'), Buffer.alloc(10));
        await writeFile(join(root, '2026-10-27', '18-00-00-hour.json'), '{"startedAt');

        const found = await store.list(NOW);

        expect(found.map(r => r.id).sort()).toEqual(['2026-10-27T18-00-00-hour', '2026-10-27T19-00-00-live']);
        expect(found.every(r => r.title === undefined)).toBe(true);
    });

    it('ignores anything in the directory radio.liq did not write', async () => {
        await record('2026-10-27', '20-00-00-hour', { startedAtMs: NOW - 1, endedAtMs: NOW }, NOW - 120_000);
        await writeFile(join(root, 'notes.txt'), 'hello');
        await mkdir(join(root, 'clips'));
        await writeFile(join(root, '2026-10-27', 'my-edit.mp3'), 'x');

        expect((await store.list(NOW)).map(r => r.id)).toEqual(['2026-10-27T20-00-00-hour']);
    });

    it('answers an empty archive when the directory does not exist yet', async () => {
        expect(await new ArchiveStore(join(root, 'nowhere')).list(NOW)).toEqual([]);
    });

    it('turns only a well-formed id into a path, and never one outside the root', () => {
        expect(store.pathFor('2026-10-27T20-00-00-live')).toBe(join(root, '2026-10-27', '20-00-00-live.mp3'));
        for (const id of ['../etc/passwd', '2026-10-27T20-00-00-live/../../x', '2026-10-27/20-00-00-live', '2026-10-27T20-00-00-show', '']) {
            expect(store.pathFor(id)).toBeUndefined();
        }
    });

    it('removes a recording, its sidecar and its emptied day', async () => {
        await record('2026-10-27', '20-00-00-hour', { startedAtMs: NOW - 2, endedAtMs: NOW - 1 }, NOW - 120_000);

        expect(await store.remove('2026-10-27T20-00-00-hour', NOW)).toBe(true);
        expect(await readdir(root)).toEqual([]);
    });

    it('will not remove one still being written, or one that is not there', async () => {
        await record('2026-10-27', '21-30-00-live', { startedAtMs: NOW - 600_000 }, NOW - 1000);

        expect(await store.remove('2026-10-27T21-30-00-live', NOW)).toBe(false);
        expect(await store.remove('2026-10-27T05-00-00-hour', NOW)).toBe(false);
        expect(await store.remove('../2026-10-27T21-30-00-live', NOW)).toBe(false);
        expect((await store.list(NOW)).length).toBe(1);
    });
});

describe('pruneArchive', () => {
    it('removes what ended before the window and keeps what ended inside it', async () => {
        await record(
            '2026-10-10',
            '20-00-00-hour',
            { startedAtMs: NOW - 17 * DAY_MS, endedAtMs: NOW - 17 * DAY_MS + 3600_000 },
            NOW - 17 * DAY_MS,
            500,
        );
        // Began outside the window, ended inside it: kept, because age is from the end.
        await record('2026-10-12', '23-00-00-live', { startedAtMs: NOW - 15 * DAY_MS, endedAtMs: NOW - 13 * DAY_MS }, NOW - 13 * DAY_MS);

        const summary = await pruneArchive(store, 14, NOW);

        expect(summary).toEqual({ removed: 1, freedBytes: 500, days: 14 });
        expect((await store.list(NOW)).map(r => r.id)).toEqual(['2026-10-12T23-00-00-live']);
    });

    it('keeps everything at zero days', async () => {
        await record('2025-01-01', '20-00-00-hour', { startedAtMs: 1, endedAtMs: 2 }, NOW - 400 * DAY_MS);

        expect(await pruneArchive(store, 0, NOW)).toEqual({ removed: 0, freedBytes: 0, days: 0 });
        expect((await store.list(NOW)).length).toBe(1);
    });

    it('never removes a recording still being written', async () => {
        await record('2026-10-01', '20-00-00-live', { startedAtMs: NOW - 26 * DAY_MS }, NOW - 1000);

        expect((await pruneArchive(store, 1, NOW)).removed).toBe(0);
    });
});

describe('resolveArchiveDays', () => {
    it('reads the setting as the string it is stored as', () => {
        expect(resolveArchiveDays(configWith('30'))).toBe(30);
        expect(resolveArchiveDays(configWith('0'))).toBe(0);
    });

    it('takes the default when nothing is set', () => {
        expect(resolveArchiveDays(configWith(undefined))).toBe(ARCHIVE_DEFAULTS.retentionDays);
    });

    it('keeps everything for a value it cannot read, rather than deleting on a guess', () => {
        expect(resolveArchiveDays(configWith('a fortnight'))).toBe(0);
        expect(resolveArchiveDays(configWith('-3'))).toBe(0);
    });
});
