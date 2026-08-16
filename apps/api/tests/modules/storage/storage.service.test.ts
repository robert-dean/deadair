// Two figures that disagree in two directions, each meaning something different: a file no row
// claims is a crash between writing bytes and writing a row, and a row whose file has gone is a
// directory somebody emptied. What this pins is that neither is hidden, neither is repaired, and the
// one store nothing can claim is not reported as one long orphan.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageService } from '../../../src/modules/storage/storage.service.js';
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

const store = (root: string, files: StoredFile[]) => ({ root, list: vi.fn(async () => files) });

let capBytes: number;

beforeEach(() => {
    capBytes = 0;
});

/** A service over four fake stores and a fake repository, with everything else real. */
const build = (options: {
    tracks?: StoredFile[];
    art?: StoredFile[];
    segments?: StoredFile[];
    voices?: StoredFile[];
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

    const config = { get: (_key: string, fallback: unknown) => (capBytes > 0 ? capBytes : fallback) } as unknown as AppConfig;

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
        // The store is only ever listed. Nothing here can remove anything.
        expect(Object.keys(stores.tracks)).toEqual(['root', 'list']);
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
