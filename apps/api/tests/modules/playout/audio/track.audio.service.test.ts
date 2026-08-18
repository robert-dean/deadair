// The one place audio for a record comes from, so this file is where the three sources have to be told
// apart: the file on disk, a fetch already running, and the provider. There used to be a fourth, an
// in-memory hold for a station told to keep nothing, and it went with `playout.trackCache`: a record
// may not be committed until its audio is HERE, so a station keeping nothing would never commit.

import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from 'injectkit';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TRACK_BYTES, TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';
import { TrackAudioRepository, type CachedFile, type SourceAudio } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { TrackStore } from '../../../../src/modules/playout/audio/track.store.js';
import type { PluginTrackResolver } from '../../../../src/modules/playout/providers/plugin.resolver.js';
import { TracksRepository } from '../../../../src/modules/catalog/tracks.repository.js';

const SOURCE_ID = '11111111-2222-3333-4444-555555555555';
const AUDIO_URL = 'http://127.0.0.1:3679/track/track-42?t=signed';

/** Comfortably over the floor, so the size guards are not what most of these tests are about. */
const RECORD = Buffer.alloc(32 * 1024, 7);

const BINDING: SourceAudio = { sourceId: SOURCE_ID, pluginId: 'deadair.spotify', externalId: 'track-42', attempts: 0 };

let root: string;
let store: TrackStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-track-audio-test-'));
    store = new TrackStore(root);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
});

/**
 * A service over a real store and a fake everything-else.
 *
 * No default on `source`, because "the catalog does not know this binding" is one of the cases here
 * and a default would quietly turn it into the happy path.
 */
const build = (options: { source: SourceAudio | undefined; url?: string; capBytes?: number; cached?: CachedFile[] }) => {
    const findForSource = vi.fn(async () => options.source);
    // The bulk read `readyFor` goes through. Defaults to answering with whatever `source` is, since
    // the window and the single binding are the same record in every test here that uses both.
    const findForBindings = vi.fn(async () => (options.source === undefined ? [] : [options.source]));
    const recordSuccess = vi.fn(async () => {});
    const recordFailure = vi.fn(async () => {});
    const markServed = vi.fn(async () => {});
    const markBindingMissing = vi.fn(async () => true);
    const markBindingUnplayable = vi.fn(async () => true);
    const disposeAsync = vi.fn(async () => {});

    // A cache the sweep can actually eat into: rows in the order the LRU index would answer, minus
    // whatever the sweep has already cleared and whatever it was told not to touch.
    const held = [...(options.cached ?? [])];
    const cleared = new Set<string>();
    const totalCachedBytes = vi.fn(async () => held.filter(file => !cleared.has(file.sourceId)).reduce((sum, file) => sum + file.byteSize, 0));
    const leastRecentlyServed = vi.fn(async (limit: number, exclude: readonly string[]) =>
        held.filter(file => !cleared.has(file.sourceId) && !exclude.includes(file.sourceId)).slice(0, limit),
    );
    const clearBytes = vi.fn(async (sourceIds: readonly string[]) => {
        sourceIds.forEach(sourceId => cleared.add(sourceId));
        return sourceIds.length;
    });
    // What another row still claims, which is the real repository's answer minus the rows just
    // cleared — the same exclusion the caller passes.
    const checksumsReferenced = vi.fn(
        async (checksums: readonly string[], excluding: readonly string[]) =>
            new Set(
                held
                    .filter(file => !cleared.has(file.sourceId) && !excluding.includes(file.sourceId) && checksums.includes(file.checksum))
                    .map(file => file.checksum),
            ),
    );

    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) =>
                token === TrackAudioRepository
                    ? {
                          findForSource,
                          findForBindings,
                          recordSuccess,
                          recordFailure,
                          markServed,
                          totalCachedBytes,
                          leastRecentlyServed,
                          clearBytes,
                          checksumsReferenced,
                      }
                    : token === TracksRepository
                      ? { markBindingMissing, markBindingUnplayable }
                      : undefined,
            disposeAsync,
        }),
    } as unknown as Container;

    const resolveBinding = vi.fn(async () => options.url ?? AUDIO_URL);
    const resolver = { resolveBinding } as unknown as PluginTrackResolver;
    const config = { get: vi.fn((_key: string, fallback: unknown) => options.capBytes ?? fallback) } as unknown as AppConfig;

    return {
        service: new TrackAudioService(container, store, resolver, config, logger),
        findForSource,
        findForBindings,
        recordSuccess,
        recordFailure,
        markServed,
        markBindingMissing,
        markBindingUnplayable,
        resolveBinding,
        totalCachedBytes,
        leastRecentlyServed,
        clearBytes,
    };
};

const respondWith = (body: Buffer | undefined, init: { status?: number; contentType?: string } = {}): ReturnType<typeof vi.fn> => {
    const stub = vi.fn(async () => {
        const headers = new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType });
        return new Response(body === undefined ? null : new Uint8Array(body), { status: init.status ?? 200, headers });
    });
    vi.stubGlobal('fetch', stub);

    return stub;
};

/** Every file the store holds, temp files included, so a failed write leaving a prefix behind shows up. */
const filesOnDisk = async (): Promise<string[]> => {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });

    return entries.filter(entry => entry.isFile()).map(entry => entry.name);
};

// What the director's commit pass asks before it will commit a record: is the audio HERE. The two
// halves are deliberately both required — a row saying there is a file, and a file.
describe('TrackAudioService.readyFor', () => {
    const WANTED = [{ pluginId: 'deadair.spotify', externalId: 'track-42' }];

    it('answers with a binding whose file is on disk', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });

        expect(await service.readyFor(WANTED)).toEqual(new Set(['deadair.spotify track-42']));
    });

    // The case a caller reading the row itself would get wrong, and the reason this lives on the
    // service rather than in the director: `locate` repairs a row like this by re-fetching, but it
    // does it inside the request the player is waiting on.
    it('does not answer with a row whose file has been deleted', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        await rm(store.pathFor(checksum, 'ogg'));
        const { service } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });

        expect(await service.readyFor(WANTED)).toEqual(new Set());
    });

    it('does not answer with a binding nothing has ever fetched', async () => {
        const { service } = build({ source: BINDING });

        expect(await service.readyFor(WANTED)).toEqual(new Set());
    });

    // A benched binding is absent from the query rather than reported unready, which is the same
    // answer here: not something to commit.
    it('answers emptily for a window the catalog has nothing for', async () => {
        const { service } = build({ source: undefined });

        expect(await service.readyFor(WANTED)).toEqual(new Set());
    });

    it('asks nothing at all for an empty window', async () => {
        const { service, findForBindings } = build({ source: BINDING });

        expect(await service.readyFor([])).toEqual(new Set());
        expect(findForBindings).not.toHaveBeenCalled();
    });
});

describe('TrackAudioService.ensure', () => {
    it('serves the file when the station already holds the record', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service, resolveBinding } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toEqual({ contentType: 'audio/ogg', body: RECORD, checksum });
        expect(resolveBinding).not.toHaveBeenCalled();
    });

    // The point of the reshape: a record nobody has fetched is still playable, on the spot.
    it('fetches from the provider when nothing local has the record', async () => {
        const { service, recordSuccess } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/mpeg' });

        const served = await service.ensure(SOURCE_ID);

        expect(served?.body).toEqual(RECORD);
        expect(served?.contentType).toBe('audio/mpeg');
        expect(await store.read(served!.checksum, 'mp3')).toEqual(RECORD);
        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, {
            checksum: served!.checksum,
            ext: 'mp3',
            contentType: 'audio/mpeg',
            byteSize: RECORD.byteLength,
        });
    });

    it('reads the extension off the content type, parameters and all', async () => {
        const { service, recordSuccess } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'AUDIO/X-FLAC; charset=binary' });

        await service.ensure(SOURCE_ID);

        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, expect.objectContaining({ ext: 'flac', contentType: 'audio/x-flac' }));
    });

    // Two things wanting one record at once: a MAX_HAND_OVERS retry landing mid-download, or the
    // ripener racing the request it was meant to spare. One download, both callers served.
    it('coalesces concurrent requests into one provider fetch', async () => {
        const { service, resolveBinding } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const [first, second] = await Promise.all([service.ensure(SOURCE_ID), service.ensure(SOURCE_ID)]);

        expect(first?.body).toEqual(RECORD);
        expect(second?.body).toEqual(RECORD);
        expect(resolveBinding).toHaveBeenCalledTimes(1);
    });

    it('reports a fetch in flight, so the ripener does not queue a second', async () => {
        const { service } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const pending = service.ensure(SOURCE_ID);
        expect(service.isFetching(SOURCE_ID)).toBe(true);

        await pending;
        expect(service.isFetching(SOURCE_ID)).toBe(false);
    });

    // A row claiming bytes the disk does not have — an emptied TRACKS_DIR, a half-restored backup.
    // Re-fetching repairs it; a 404 would skip a record the station can perfectly well fetch again.
    it('re-fetches when the row claims a file that is gone', async () => {
        const { service, resolveBinding } = build({ source: { ...BINDING, checksum: 'a'.repeat(64), ext: 'ogg' } });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        const served = await service.ensure(SOURCE_ID);

        expect(served?.body).toEqual(RECORD);
        expect(resolveBinding).toHaveBeenCalledTimes(1);
    });

    it('has nothing to serve when the catalog does not know the binding', async () => {
        const { service, recordFailure } = build({ source: undefined });
        const stub = respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(stub).not.toHaveBeenCalled();
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it.each([
        ['a provider that will not mint a url', { url: '' }, () => respondWith(RECORD, { contentType: 'audio/mpeg' })],
        ['an upstream that answered 502', {}, () => respondWith(RECORD, { status: 502, contentType: 'audio/mpeg' })],
        ['an error page served as a 200', {}, () => respondWith(Buffer.from('<html>nope</html>'), { contentType: 'text/html' })],
        ['a response with no content type at all', {}, () => respondWith(RECORD)],
        ['a body too short to be a record', {}, () => respondWith(Buffer.from('unauthorized'), { contentType: 'audio/mpeg' })],
    ])('records %s as a failure and serves nothing', async (_, overrides, respond) => {
        const { service, recordFailure, recordSuccess } = build({ source: BINDING, ...overrides });
        respond();

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(SOURCE_ID, expect.any(String), expect.any(Number), expect.any(Number));
        expect(recordSuccess).not.toHaveBeenCalled();
    });

    it('refuses a url a plugin minted for something that is not http', async () => {
        const { service, recordFailure } = build({ source: BINDING, url: 'file:///etc/passwd' });
        const stub = respondWith(RECORD, { contentType: 'audio/mpeg' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.stringMatching(/refusing to fetch file:/),
            expect.any(Number),
            expect.any(Number),
        );
        expect(stub).not.toHaveBeenCalled();
    });

    // A truncated record would air as a song that stops mid-verse. Nothing is served and nothing is
    // left behind — no file under a name claiming to be the whole record, and no temp file either.
    it('serves and stores nothing when the body runs over the cap', async () => {
        const { service, recordFailure } = build({ source: BINDING });
        respondWith(Buffer.alloc(MAX_TRACK_BYTES + 1024, 3), { contentType: 'audio/flac' });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();
        expect(recordFailure).toHaveBeenCalledWith(SOURCE_ID, expect.stringContaining('larger than'), expect.any(Number), expect.any(Number));
        expect(await filesOnDisk()).toEqual([]);
    });
});

// What an eviction sweep orders by, so what counts as "used" is the whole question. A record is used
// when its bytes are handed over from disk, and at no other moment.
describe('noting that a record was served', () => {
    it('stamps the row when the file on disk is served', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service, markServed } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });

        await service.ensure(SOURCE_ID);

        // Fire and forget, so it lands a tick behind the bytes.
        await vi.waitFor(() => expect(markServed).toHaveBeenCalledExactlyOnceWith(SOURCE_ID));
    });

    // A fetch is not a serve. The row is new, and the column's default already says so; stamping here
    // as well would only make a just-fetched record look warmer than one played a minute ago.
    it('does not stamp a record it had to fetch', async () => {
        const { service, markServed } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markServed).not.toHaveBeenCalled();
    });

    // The commit pass stats this same window every few seconds. Stamping there would report the whole
    // forward order as freshly served and flatten the ordering the sweep depends on.
    it('does not stamp the window the commit pass asks about', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service, markServed } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });

        await service.readyFor([{ pluginId: 'deadair.spotify', externalId: 'track-42' }]);

        expect(markServed).not.toHaveBeenCalled();
    });

    it('serves the record even when the stamp cannot be written', async () => {
        const checksum = await store.write(RECORD, 'ogg');
        const { service, markServed } = build({ source: { ...BINDING, checksum, ext: 'ogg' } });
        markServed.mockRejectedValue(new Error('the pool is gone'));

        await expect(service.ensure(SOURCE_ID)).resolves.toEqual({ contentType: 'audio/ogg', body: RECORD, checksum });
    });
});

// The cap is the trigger and age is only the order, so nothing here evicts because a record is old.
// What it must never take is a record about to air or one being fetched: the director commits a
// record on its audio being present, so pulling a file out from under a committed item produces
// exactly the silence the commit gate exists to prevent.
describe('TrackAudioService.sweep', () => {
    const MB = 1024 * 1024;

    /** A cached record, oldest first in the order the LRU index would answer. */
    const file = (n: number, bytes = 10 * MB): CachedFile => ({
        sourceId: `source-${n}`,
        checksum: String(n).repeat(64).slice(0, 64),
        ext: 'ogg',
        byteSize: bytes,
    });

    /** The store, holding a file per row so a deletion is observable. */
    const fill = async (files: readonly CachedFile[]) => {
        for (const held of files) {
            await store.writeStreamAs(
                held.checksum,
                (async function* () {
                    yield new Uint8Array(RECORD);
                })(),
                held.ext,
            );
        }
    };

    it('does nothing at all when no cap is set', async () => {
        const { service, totalCachedBytes, leastRecentlyServed } = build({ source: BINDING, cached: [file(1), file(2)] });

        const result = await service.sweep();

        expect(result).toMatchObject({ evicted: 0, capBytes: 0, stillOver: false });
        // One aggregate at most, and nothing chosen: a station with no cap must not pay for a walk.
        expect(leastRecentlyServed).not.toHaveBeenCalled();
        expect(totalCachedBytes).toHaveBeenCalledTimes(1);
    });

    it('does nothing while the station is under its cap', async () => {
        const { service, leastRecentlyServed } = build({ source: BINDING, capBytes: 100 * MB, cached: [file(1), file(2)] });

        expect(await service.sweep()).toMatchObject({ evicted: 0, stillOver: false });
        expect(leastRecentlyServed).not.toHaveBeenCalled();
    });

    // Only as many as it takes: the batch is a query size, not a quota.
    it('drops the coldest records and stops as soon as it is under', async () => {
        const cached = [file(1), file(2), file(3), file(4)];
        await fill(cached);
        const { service, clearBytes } = build({ source: BINDING, capBytes: 25 * MB, cached });

        const result = await service.sweep();

        expect(result).toMatchObject({ evicted: 2, freedBytes: 20 * MB, heldBytes: 20 * MB, stillOver: false });
        expect(clearBytes).toHaveBeenCalledWith(['source-1', 'source-2']);
        expect(await store.exists(cached[0]!.checksum, 'ogg')).toBe(false);
        expect(await store.exists(cached[1]!.checksum, 'ogg')).toBe(false);
        // The two it did not need are untouched, files and rows alike.
        expect(await store.exists(cached[2]!.checksum, 'ogg')).toBe(true);
        expect(await store.exists(cached[3]!.checksum, 'ogg')).toBe(true);
    });

    it('will not touch a record the running order is about to need', async () => {
        const cached = [file(1), file(2), file(3)];
        await fill(cached);
        const { service, clearBytes } = build({ source: BINDING, capBytes: 25 * MB, cached });
        service.protect(['source-1']);

        const result = await service.sweep();

        expect(clearBytes).toHaveBeenCalledWith(['source-2']);
        expect(result).toMatchObject({ evicted: 1, stillOver: false });
        expect(await store.exists(cached[0]!.checksum, 'ogg')).toBe(true);
    });

    // A set nobody has refreshed is a station that went off air, and it must not go on protecting
    // whatever it happened to have planned at the time.
    it('stops trusting a protected set nobody has refreshed', async () => {
        const cached = [file(1), file(2), file(3)];
        await fill(cached);
        const { service, clearBytes } = build({ source: BINDING, capBytes: 25 * MB, cached });
        service.protect(['source-1']);

        vi.useFakeTimers();
        try {
            vi.setSystemTime(Date.now() + 5 * 60 * 1000);
            await service.sweep();
        } finally {
            vi.useRealTimers();
        }

        expect(clearBytes).toHaveBeenCalledWith(['source-1']);
    });

    it('will not touch a record something is fetching right now', async () => {
        const cached = [file(1), file(2), file(3)];
        await fill(cached);
        const { service, clearBytes } = build({ source: BINDING, capBytes: 25 * MB, cached });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        // `ensure` keys the in-flight map by source id, so this is what a download in progress looks
        // like from the sweep's side.
        const fetching = service.ensure('source-1');
        await service.sweep();
        await fetching;

        expect(clearBytes).toHaveBeenCalledWith(['source-2']);
    });

    // Two bindings that resolved to identical audio are ONE file. Dropping the row for one of them
    // must not delete the bytes the other is still claiming, or the second record fails at the
    // moment it is wanted rather than at the moment it was evicted.
    it('keeps a file another binding still claims', async () => {
        const shared = { ...file(1), sourceId: 'source-1' };
        const twin = { ...shared, sourceId: 'source-2' };
        const cached = [shared, twin, file(3)];
        await fill(cached);
        const { service } = build({ source: BINDING, capBytes: 25 * MB, cached });

        await service.sweep();

        // One row cleared, and the bytes stay because the twin still holds them.
        expect(await store.exists(shared.checksum, 'ogg')).toBe(true);
    });

    // Everything left is about to air. That is an ordinary outcome and the caller says so once,
    // rather than the sweep forcing its way to the cap.
    it('reports being stuck over the cap rather than taking what it may not', async () => {
        const cached = [file(1), file(2)];
        await fill(cached);
        const { service, clearBytes } = build({ source: BINDING, capBytes: 5 * MB, cached });
        service.protect(['source-1', 'source-2']);

        expect(await service.sweep()).toMatchObject({ evicted: 0, stillOver: true, heldBytes: 20 * MB, capBytes: 5 * MB });
        expect(clearBytes).not.toHaveBeenCalled();
    });
});

describe('TrackAudioService.warm', () => {
    it('gets the record in hand and says so', async () => {
        const { service } = build({ source: BINDING });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.warm(SOURCE_ID)).toBe(true);
        expect(await filesOnDisk()).toHaveLength(1);
    });

    // A warm that fails must not fail its job: the request that actually needs the record will try
    // again, and the failure is already on the row.
    it('answers false rather than throwing when the record cannot be had', async () => {
        const { service, recordFailure } = build({ source: BINDING });
        respondWith(RECORD, { status: 404, contentType: 'audio/ogg' });

        expect(await service.warm(SOURCE_ID)).toBe(false);
        expect(recordFailure).toHaveBeenCalled();
    });
});

// Giving up on a copy the provider will not serve. The station narrows its own rotation here, so the
// threshold has to be reached by CONSECUTIVE failures and by nothing else.
describe('benching a binding that will not serve', () => {
    const failing = (attempts: number): SourceAudio => ({ ...BINDING, attempts });

    it('leaves a binding alone while it is still worth retrying', async () => {
        const { service, markBindingMissing } = build({ source: failing(2) });
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).not.toHaveBeenCalled();
    });

    it('writes the copy off once the failures run out of patience', async () => {
        // Three already recorded, so this failure is the fourth.
        const { service, markBindingMissing } = build({ source: failing(3) });
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).toHaveBeenCalledExactlyOnceWith('deadair.spotify', 'track-42');
    });

    // The mark is idempotent in the repository, so a later failure on an already-benched binding says
    // nothing rather than repeating a line an operator has seen.
    it('says nothing when the copy was already written off', async () => {
        const { service, markBindingMissing } = build({ source: failing(9) });
        markBindingMissing.mockResolvedValue(false);
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingMissing).toHaveBeenCalled();
    });

    // The failure mode with teeth: `attempts` has to mean CONSECUTIVE failures, so a binding three
    // failures deep that then WORKS must not be one failure away from being benched for good.
    it('resets nothing itself, but records a success that does', async () => {
        const { service, recordSuccess, markBindingMissing } = build({ source: failing(3) });
        respondWith(RECORD, { contentType: 'audio/ogg' });

        expect(await service.ensure(SOURCE_ID)).toBeDefined();
        expect(recordSuccess).toHaveBeenCalledWith(SOURCE_ID, expect.objectContaining({ ext: 'ogg' }));
        expect(markBindingMissing).not.toHaveBeenCalled();
    });

    // The other kind of giving up, and the two must not be confused: a bench is the station's own
    // guess from repeated failures and heals on the next sync, where this is the provider answering
    // and must not. Four records on this install failed, were benched, were un-benched by the sync
    // and failed again, once an hour, for days — because a 502 was all the shim would say.
    it('writes a copy off for good when the provider says it will never serve it', async () => {
        const { service, markBindingUnplayable, markBindingMissing } = build({ source: BINDING });
        respondWith(undefined, { status: 410 });

        expect(await service.ensure(SOURCE_ID)).toBeUndefined();

        expect(markBindingUnplayable).toHaveBeenCalledExactlyOnceWith('deadair.spotify', 'track-42');
        // NOT the temporary mark: that one the hourly sync clears, which is the whole bug.
        expect(markBindingMissing).not.toHaveBeenCalled();
    });

    // No ladder, no fourth attempt: the attempts exist to find out whether a failure is transient,
    // and a 410 has already answered that.
    it('does not wait for four failures before writing one off', async () => {
        const { service, markBindingUnplayable } = build({ source: { ...BINDING, attempts: 0 } });
        respondWith(undefined, { status: 410 });

        await service.ensure(SOURCE_ID);

        expect(markBindingUnplayable).toHaveBeenCalled();
    });

    // The status is read narrowly on purpose. A signed URL that has expired answers 404 and the next
    // attempt mints a fresh one, so only 410 — which means exactly this — is permanent.
    it('still treats a 404 as something to try again', async () => {
        const { service, markBindingUnplayable, recordFailure } = build({ source: BINDING });
        respondWith(RECORD, { status: 404, contentType: 'audio/ogg' });

        await service.ensure(SOURCE_ID);

        expect(markBindingUnplayable).not.toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalled();
    });

    it('swallows a failure to write a copy off', async () => {
        const { service, markBindingUnplayable } = build({ source: BINDING });
        markBindingUnplayable.mockRejectedValue(new Error('the pool is gone'));
        respondWith(undefined, { status: 410 });

        await expect(service.ensure(SOURCE_ID)).resolves.toBeUndefined();
    });

    // Not being able to write the mark must not fail a request that has already answered.
    it('swallows a failure to write the mark', async () => {
        const { service, markBindingMissing } = build({ source: failing(3) });
        markBindingMissing.mockRejectedValue(new Error('the pool is gone'));
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await expect(service.ensure(SOURCE_ID)).resolves.toBeUndefined();
    });
});
