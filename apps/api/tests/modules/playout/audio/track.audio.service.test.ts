// The one place audio for a record comes from, so this file is where the three sources have to be told
// apart: the file on disk, a fetch already running, and the provider. There used to be a fourth, an
// in-memory hold for a station told to keep nothing, and it went with `playout.trackCache`: a record
// may not be committed until its audio is HERE, so a station keeping nothing would never commit.

import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TRACK_BYTES, TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';
import { TrackAudioRepository, type SourceAudio } from '../../../../src/modules/playout/audio/track.audio.repository.js';
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
const build = (options: { source: SourceAudio | undefined; url?: string }) => {
    const findForSource = vi.fn(async () => options.source);
    // The bulk read `readyFor` goes through. Defaults to answering with whatever `source` is, since
    // the window and the single binding are the same record in every test here that uses both.
    const findForBindings = vi.fn(async () => (options.source === undefined ? [] : [options.source]));
    const recordSuccess = vi.fn(async () => {});
    const recordFailure = vi.fn(async () => {});
    const markBindingMissing = vi.fn(async () => true);
    const disposeAsync = vi.fn(async () => {});

    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) =>
                token === TrackAudioRepository
                    ? { findForSource, findForBindings, recordSuccess, recordFailure }
                    : token === TracksRepository
                      ? { markBindingMissing }
                      : undefined,
            disposeAsync,
        }),
    } as unknown as Container;

    const resolveBinding = vi.fn(async () => options.url ?? AUDIO_URL);
    const resolver = { resolveBinding } as unknown as PluginTrackResolver;

    return {
        service: new TrackAudioService(container, store, resolver, logger),
        findForSource,
        findForBindings,
        recordSuccess,
        recordFailure,
        markBindingMissing,
        resolveBinding,
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

    // Not being able to write the mark must not fail a request that has already answered.
    it('swallows a failure to write the mark', async () => {
        const { service, markBindingMissing } = build({ source: failing(3) });
        markBindingMissing.mockRejectedValue(new Error('the pool is gone'));
        respondWith(RECORD, { status: 502, contentType: 'audio/ogg' });

        await expect(service.ensure(SOURCE_ID)).resolves.toBeUndefined();
    });
});
