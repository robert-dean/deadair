// Two figures that disagree in two directions, each meaning something different: a file no row
// claims is a crash between writing bytes and writing a row, and a row whose file has gone is a
// directory somebody emptied. What this pins is that neither is hidden, neither is repaired, and the
// one store nothing can claim is not reported as one long orphan.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { StorageService } from '../../../src/modules/storage/storage.service.js';
import { ORPHAN_GRACE_HOURS_KEY, SWEEP_ORPHANS_KEY } from '../../../src/modules/storage/orphan.sweep.js';
import { fileName, type StorageRepository, type StoredClaims } from '../../../src/modules/storage/storage.repository.js';
import type { StoredFile } from '../../../src/modules/shared/content.store.js';

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);

const claims = (names: string[], bytes?: number): StoredClaims => ({
    rows: names.length,
    ...(bytes === undefined ? {} : { bytes }),
    names: new Set(names),
});

/**
 * A file as a case here writes one: everything {@link StoredFile} has, except the age, which almost
 * no case cares about and every case would otherwise have to repeat. A case that DOES care about it
 * — the sweep's grace period is the only one — sets it and the fixture leaves it alone.
 */
type FileInput = Omit<StoredFile, 'modifiedAt'> & { modifiedAt?: DateTime };

const store = (root: string, files: FileInput[]) => {
    const present = new Set(
        files.flatMap(file => (file.checksum === undefined || file.ext === undefined ? [] : [fileName(file.checksum, file.ext)])),
    );

    return {
        root,
        list: vi.fn(async (): Promise<StoredFile[]> => files.map(file => ({ modifiedAt: DateTime.now(), ...file }))),
        // The real store answers false for a file that is not at its own canonical path, which is
        // how an inbox copy survives a sweep, so the fake has to answer false there too or the one
        // case that matters passes for the wrong reason.
        remove: vi.fn(async (checksum: string, ext: string) => present.delete(fileName(checksum, ext))),
    };
};

let capBytes: number;
let settings: Record<string, string>;

beforeEach(() => {
    capBytes = 0;
    settings = {};
});

/** A service over four fake stores and a fake repository, with everything else real. */
const build = (options: {
    tracks?: FileInput[];
    art?: FileInput[];
    segments?: FileInput[];
    voices?: FileInput[];
    trackClaims?: StoredClaims;
    artClaims?: StoredClaims;
    segmentClaims?: StoredClaims;
}) => {
    const repository = {
        trackClaims: vi.fn(async () => options.trackClaims ?? claims([], 0)),
        artClaims: vi.fn(async () => options.artClaims ?? claims([], 0)),
        segmentClaims: vi.fn(async () => options.segmentClaims ?? claims([])),
    } as unknown as StorageRepository;

    const stores = {
        tracks: store('/media/tracks', options.tracks ?? []),
        art: store('/media/art', options.art ?? []),
        segments: store('/media/segments', options.segments ?? []),
        voices: store('/media/voice-samples', options.voices ?? []),
    };

    // Every setting is a STRING here because every setting is a string in the station, and a sweep
    // switch read as a boolean would be truthy on the literal 'false' that turning it off stores.
    const config = {
        get: (key: string, fallback: unknown) => settings[key] ?? (capBytes > 0 ? capBytes : fallback),
    } as unknown as AppConfig;

    return {
        service: new StorageService(
            repository,
            stores.tracks as never,
            stores.art as never,
            stores.segments as never,
            stores.voices as never,
            config,
        ),
        stores,
    };
};

const storeIn = async (service: StorageService, id: string) => (await service.readStorage()).stores.find(entry => entry.id === id)!;

describe('StorageService.readStorage', () => {
    it('reports what is on disk beside what the database claims', async () => {
        const { service } = build({
            tracks: [
                { checksum: CHECKSUM_A, ext: 'ogg', bytes: 1000 },
                { checksum: CHECKSUM_B, ext: 'ogg', bytes: 2000 },
            ],
            trackClaims: claims([fileName(CHECKSUM_A, 'ogg'), fileName(CHECKSUM_B, 'ogg')], 3000),
        });

        expect(await storeIn(service, 'tracks')).toMatchObject({
            files: 2,
            bytes: 3000,
            rows: 2,
            accountedBytes: 3000,
            orphanFiles: 0,
            rowsWithNoFile: 0,
        });
    });

    // What a crash between writing the bytes and writing the row leaves. Counted and left alone.
    it('counts a file no row claims, and does not delete it', async () => {
        const { service, stores } = build({
            tracks: [
                { checksum: CHECKSUM_A, ext: 'ogg', bytes: 1000 },
                { checksum: CHECKSUM_C, ext: 'ogg', bytes: 500 },
            ],
            trackClaims: claims([fileName(CHECKSUM_A, 'ogg')], 1000),
        });

        expect(await storeIn(service, 'tracks')).toMatchObject({ orphanFiles: 1, orphanBytes: 500 });
        // This used to assert the fake store had no `remove` to call, which stopped being the
        // invariant when the sweep gave it one. The invariant was never "the store cannot delete" —
        // it is "READING does not delete", and that is what this says now.
        expect(stores.tracks.remove).not.toHaveBeenCalled();
    });

    // A `.tmp-` file an interrupted streaming write left behind is exactly the sort of thing this
    // exists to surface, so a name the store did not mint counts as unclaimed rather than being
    // quietly skipped.
    it('counts a file the store never named', async () => {
        const { service } = build({
            tracks: [{ bytes: 700 }],
            trackClaims: claims([], 0),
        });

        expect(await storeIn(service, 'tracks')).toMatchObject({ files: 1, bytes: 700, orphanFiles: 1, orphanBytes: 700 });
    });

    // The other direction: an operator emptied the directory. The station heals this by re-fetching,
    // which is why it is reported rather than treated as an error.
    it('counts a row whose file is gone', async () => {
        const { service } = build({
            tracks: [],
            trackClaims: claims([fileName(CHECKSUM_A, 'ogg'), fileName(CHECKSUM_B, 'ogg')], 3000),
        });

        expect(await storeIn(service, 'tracks')).toMatchObject({ files: 0, rows: 2, rowsWithNoFile: 2 });
    });

    // Voice previews are named after the QUESTION they answer, so no table claims them and every
    // file would otherwise read as an orphan — which would be the report libelling a working store.
    it('reports no orphans for the store nothing can claim', async () => {
        const { service } = build({ voices: [{ bytes: 400 }, { bytes: 600 }] });
        const voices = await storeIn(service, 'voices');

        expect(voices).toMatchObject({ files: 2, bytes: 1000, orphanFiles: 0, orphanBytes: 0, rowsWithNoFile: 0 });
        expect(voices.rows).toBeUndefined();
    });

    // `deadair.segments` records which file a break's audio is in and never how big it is, so a zero
    // would be a lie about the store rather than a fact about it.
    it('leaves the accounted total absent where the table records no size', async () => {
        const { service } = build({
            segments: [{ checksum: CHECKSUM_A, ext: 'mp3', bytes: 900 }],
            segmentClaims: claims([fileName(CHECKSUM_A, 'mp3')]),
        });
        const segments = await storeIn(service, 'segments');

        expect(segments.rows).toBe(1);
        expect(segments.accountedBytes).toBeUndefined();
    });

    it('adds every store up, and names where each one is', async () => {
        const { service } = build({
            tracks: [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 1000 }],
            art: [{ checksum: CHECKSUM_B, ext: 'jpg', bytes: 200 }],
            voices: [{ bytes: 50 }],
        });
        const report = await service.readStorage();

        expect(report).toMatchObject({ totalFiles: 3, totalBytes: 1250 });
        expect(report.stores.map(entry => entry.path)).toEqual(['/media/tracks', '/media/art', '/media/segments', '/media/voice-samples']);
    });

    it('carries the cap only for the store that has one, and only once it is set', async () => {
        const { service } = build({});
        expect((await storeIn(service, 'tracks')).capBytes).toBeUndefined();

        capBytes = 20 * 1024 * 1024 * 1024;
        const withCap = build({});
        expect((await storeIn(withCap.service, 'tracks')).capBytes).toBe(capBytes);
        expect((await storeIn(withCap.service, 'art')).capBytes).toBeUndefined();
    });

    // A walk is real I/O and this is a figure somebody leaves on screen. The reading carries the
    // moment it was taken, which is the honest half of caching a number.
    it('walks the directories once and stands on that reading', async () => {
        const { service, stores } = build({ tracks: [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 10 }] });

        const first = await service.readStorage();
        const second = await service.readStorage();

        expect(stores.tracks.list).toHaveBeenCalledTimes(1);
        expect(second.readAt.toMillis()).toBe(first.readAt.toMillis());
    });
});

// Every case here is about a file this must NOT take. The one case about a file it should take is
// the short one, because deleting an unreachable file is the easy half — a file whose row is gone
// cannot be found by anything, since every read starts from a row holding the checksum that is the
// path. What the sweep is actually made of is the four refusals below it.
describe('StorageService.sweep', () => {
    const on = (graceHours = 24) => {
        settings[SWEEP_ORPHANS_KEY] = 'true';
        settings[ORPHAN_GRACE_HOURS_KEY] = String(graceHours);
    };

    const old = () => DateTime.now().minus({ days: 7 });

    it('does nothing at all, and reads no directory, while the switch is off', async () => {
        const { service, stores } = build({ tracks: [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 500, modifiedAt: old() }] });

        expect(await service.sweep()).toEqual({ ran: false, removed: 0, freedBytes: 0, heldBack: 0 });
        // An install that never turns this on must not pay a directory walk for its existence.
        expect(stores.tracks.list).not.toHaveBeenCalled();
    });

    // The whole of the setting rule: config holds STRINGS, so the spelling that turns a switch off
    // is the truthy string 'false'. Read as a boolean this sweep would delete audio on a station
    // that had explicitly said not to.
    it('stays off for the string every other switch stores for off', async () => {
        settings[SWEEP_ORPHANS_KEY] = 'false';
        const { service } = build({ tracks: [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 500, modifiedAt: old() }] });

        expect(await service.sweep()).toMatchObject({ ran: false, removed: 0 });
    });

    it('deletes a file no row claims, and reports what it freed', async () => {
        on();
        const { service, stores } = build({
            tracks: [
                { checksum: CHECKSUM_A, ext: 'ogg', bytes: 1000, modifiedAt: old() },
                { checksum: CHECKSUM_C, ext: 'ogg', bytes: 500, modifiedAt: old() },
            ],
            trackClaims: claims([fileName(CHECKSUM_A, 'ogg')], 1000),
        });

        expect(await service.sweep()).toEqual({ ran: true, removed: 1, freedBytes: 500, heldBack: 0 });
        expect(stores.tracks.remove).toHaveBeenCalledExactlyOnceWith(CHECKSUM_C, 'ogg');
    });

    // The bytes of a half-written file and of a real orphan are identical. Age is the only thing
    // that separates them, and this is the assertion that says so.
    it('holds back an unclaimed file that is younger than the grace period', async () => {
        on(24);
        const { service, stores } = build({
            tracks: [{ checksum: CHECKSUM_C, ext: 'ogg', bytes: 500, modifiedAt: DateTime.now().minus({ minutes: 5 }) }],
        });

        expect(await service.sweep()).toEqual({ ran: true, removed: 0, freedBytes: 0, heldBack: 1 });
        expect(stores.tracks.remove).not.toHaveBeenCalled();
    });

    // Content addressing means an ident at three slots in an hour is ONE file. Deleting it for the
    // row that went would silence the two that stayed.
    it('leaves a file alone while any row still claims it', async () => {
        on();
        const { service, stores } = build({
            segments: [{ checksum: CHECKSUM_A, ext: 'mp3', bytes: 900, modifiedAt: old() }],
            // Three rows, one file, one of them gone. The set still holds the name.
            segmentClaims: claims([fileName(CHECKSUM_A, 'mp3')]),
        });

        expect(await service.sweep()).toMatchObject({ removed: 0 });
        expect(stores.segments.remove).not.toHaveBeenCalled();
    });

    // A voice preview is named after the QUESTION it answers rather than by any row, so every file
    // in that store is unclaimed by construction. A sweep that treated it like the others would
    // empty it on the first run.
    it('never touches the store that no table backs', async () => {
        on();
        const { service, stores } = build({ voices: [{ checksum: CHECKSUM_B, ext: 'wav', bytes: 400, modifiedAt: old() }] });

        expect(await service.sweep()).toMatchObject({ removed: 0, heldBack: 0 });
        expect(stores.voices.list).not.toHaveBeenCalled();
        expect(stores.voices.remove).not.toHaveBeenCalled();
    });

    // A `.tmp-` from an interrupted write, or anything a person dropped in. The store cannot name it,
    // so it has no checksum to remove it by and is left where it is.
    it('leaves a file the store never named where it is', async () => {
        on();
        const { service, stores } = build({ tracks: [{ bytes: 700, modifiedAt: old() }] });

        expect(await service.sweep()).toMatchObject({ removed: 0, heldBack: 0 });
        expect(stores.tracks.remove).not.toHaveBeenCalled();
    });

    // One listing can show the same checksum twice — the store's own copy and a duplicate under the
    // segment inbox — and removing it is one act, not two.
    it('removes a checksum once however many times the listing shows it', async () => {
        on();
        const { service, stores } = build({
            segments: [
                { checksum: CHECKSUM_C, ext: 'mp3', bytes: 300, modifiedAt: old() },
                { checksum: CHECKSUM_C, ext: 'mp3', bytes: 300, modifiedAt: old() },
            ],
        });

        expect(await service.sweep()).toMatchObject({ removed: 1, freedBytes: 300 });
        expect(stores.segments.remove).toHaveBeenCalledTimes(1);
    });

    // `remove` answers false for a file already gone, and for one whose canonical path never held
    // anything — which is exactly what an inbox copy is. Neither is bytes this freed.
    it('counts what actually went rather than what it chose', async () => {
        on();
        const { service, stores } = build({ tracks: [{ checksum: CHECKSUM_B, ext: 'ogg', bytes: 900, modifiedAt: old() }] });
        // What a real store answers for a file that is not at its own canonical path: the inbox copy
        // that a recursive listing surfaced, and the file somebody deleted between the two calls.
        stores.tracks.remove.mockResolvedValue(false);

        expect(await service.sweep()).toEqual({ ran: true, removed: 0, freedBytes: 0, heldBack: 0 });
        expect(stores.tracks.remove).toHaveBeenCalledOnce();
    });

    // Files are listed BEFORE claims are read, so a row written between the two protects its file.
    // The other order leaves that same file looking unclaimed.
    it('reads what the database claims only after it has listed the disk', async () => {
        on();
        const order: string[] = [];
        const { service, stores } = build({ tracks: [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 100, modifiedAt: old() }] });

        stores.tracks.list.mockImplementation(async () => {
            order.push('list');
            return [{ checksum: CHECKSUM_A, ext: 'ogg', bytes: 100, modifiedAt: old() }];
        });
        const repository = (service as unknown as { repository: { trackClaims: () => Promise<StoredClaims> } }).repository;
        const claimed = repository.trackClaims;
        repository.trackClaims = async () => {
            order.push('claims');
            return await claimed.call(repository);
        };

        await service.sweep();

        expect(order.slice(0, 2)).toEqual(['list', 'claims']);
    });
});
