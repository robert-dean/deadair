import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { ARTIST_TTL_MS, cacheFingerprint, MATCH_TTL_MS, MISS_TTL_MS, MusicBrainzCache } from '../src/musicbrainz.cache.js';
import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { createFakePluginHost, type FakePluginHost } from './fake.plugin.host.js';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const searchResult = {
    recordings: [
        {
            id: 'rec-1',
            score: 100,
            title: 'Glory Box',
            'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
            releases: [{ id: 'rel-1', title: 'Dummy' }],
        },
    ],
};

const recordingDetail = {
    id: 'rec-1',
    title: 'Glory Box',
    'first-release-date': '1994-08-22',
    'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
    releases: [{ id: 'rel-1', title: 'Dummy', 'release-group': { 'primary-type': 'Album' } }],
};

const artistDetail = { id: 'art-1', name: 'Portishead', type: 'Group', 'begin-area': { name: 'Bristol' }, 'life-span': { begin: '1991' } };

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90, ...config });
    await plugin.init(host);
};

/** Every request a full, uncached enrichment makes. */
const queueFullPass = (): void => {
    host.queueResponse({ body: JSON.stringify(searchResult) });
    host.queueResponse({ body: JSON.stringify(recordingDetail) });
    host.queueResponse({ body: JSON.stringify({ id: 'rel-1', title: 'Dummy', 'label-info': [{ label: { name: 'Go! Beat' } }] }) });
    host.queueResponse({ body: JSON.stringify(artistDetail) });
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('MusicBrainzCache', () => {
    const cache = (): MusicBrainzCache => new MusicBrainzCache(host.storage, host.logger, 'fp');

    it('keys a track by its ISRC when it has one', () => {
        expect(cache().matchKey({ ...ref, isrc: 'gbaaa9400123' })).toBe('v1:fp:match:isrc:GBAAA9400123');
    });

    it('keys a track without one by the same normalised pair the search would use', () => {
        expect(cache().matchKey({ artist: 'Beyoncé', title: 'Mr. Brightside' })).toBe('v1:fp:match:at:beyonce|mr brightside');
    });

    it('round-trips a value', async () => {
        const subject = cache();
        await subject.write('k', { year: 1994 }, MATCH_TTL_MS);
        await expect(subject.read('k')).resolves.toEqual({ value: { year: 1994 } });
    });

    it('remembers a miss as an entry with no value, which is not the same as no entry', async () => {
        const subject = cache();
        await subject.write('k', undefined, MISS_TTL_MS);

        await expect(subject.read('k')).resolves.toEqual({});
        await expect(subject.read('other')).resolves.toBeUndefined();
    });

    it('stops answering once the entry has expired', async () => {
        const subject = cache();
        await subject.write('k', { year: 1994 }, 1_000);

        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2_000);
        await expect(subject.read('k')).resolves.toBeUndefined();
        vi.restoreAllMocks();
    });

    it('reads a storage failure as a miss rather than failing the enrichment', async () => {
        const failing = { ...host.storage, get: vi.fn(async () => Promise.reject(new Error('no storage'))) };
        const subject = new MusicBrainzCache(failing, host.logger, 'fp');
        await expect(subject.read('k')).resolves.toBeUndefined();
    });

    it('swallows a storage failure on write', async () => {
        const failing = { ...host.storage, set: vi.fn(async () => Promise.reject(new Error('no storage'))) };
        const subject = new MusicBrainzCache(failing, host.logger, 'fp');
        await expect(subject.write('k', { year: 1994 }, MATCH_TTL_MS)).resolves.toBeUndefined();
    });

    it('ignores whatever else may be sitting under a key', async () => {
        host.seedStorage('k', 'not an envelope');
        await expect(cache().read('k')).resolves.toBeUndefined();
    });
});

describe('cacheFingerprint', () => {
    it('changes when a setting that changes the answer changes', () => {
        const base = { matchScore: 90, includeArtwork: true, includeArtistFacts: true };
        expect(cacheFingerprint(base)).toBe('90af');
        expect(cacheFingerprint({ ...base, matchScore: 70 })).not.toBe(cacheFingerprint(base));
        expect(cacheFingerprint({ ...base, includeArtwork: false })).not.toBe(cacheFingerprint(base));
    });
});

describe('enrichTrack with the cache', () => {
    it('answers a second identical track without a single request', async () => {
        await initialize();
        queueFullPass();

        const first = await plugin.enrichTrack(ref);
        const requests = host.calls.length;
        const second = await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(requests);
        expect(second).toEqual(first);
        expect(second.label).toBe('Go! Beat');
    });

    it('remembers a miss, so the next pass does not search again', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ recordings: [] }) });

        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
        expect(host.calls).toHaveLength(1);
    });

    it('reuses an artist across the tracks that share them', async () => {
        await initialize();
        queueFullPass();
        await plugin.enrichTrack(ref);

        // A different song by the same artist: everything but the artist lookup runs again.
        host.queueResponse({ body: JSON.stringify({ recordings: [{ ...searchResult.recordings[0], id: 'rec-2', title: 'Sour Times' }] }) });
        host.queueResponse({ body: JSON.stringify({ ...recordingDetail, id: 'rec-2', title: 'Sour Times' }) });
        host.queueResponse({ body: JSON.stringify({ id: 'rel-1', title: 'Dummy' }) });

        const second = await plugin.enrichTrack({ ...ref, title: 'Sour Times' });

        expect(second.facts).toEqual(['Portishead formed in Bristol in 1991.']);
        expect(host.calls.filter(call => call.url.includes('artist/art-1'))).toHaveLength(1);
    });

    it('does not remember an artist lookup that never happened', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });
        host.queueResponse({ body: JSON.stringify({ id: 'rel-1', title: 'Dummy' }) });
        host.queueResponse({ status: 503, ok: false, body: '' });

        await plugin.enrichTrack(ref);

        expect(host.storageKeys().some(key => key.includes(':artist:'))).toBe(false);
    });

    it('does not answer out of a cache filled under different settings', async () => {
        await initialize();
        queueFullPass();
        await plugin.enrichTrack(ref);
        const filled = host.calls.length;

        await initialize({ matchScore: 40 });
        queueFullPass();
        await plugin.enrichTrack(ref);

        expect(host.calls.length).toBeGreaterThan(filled);
    });

    it('writes each entry under the ttl it advertises', async () => {
        await initialize();
        queueFullPass();
        const before = Date.now();

        await plugin.enrichTrack(ref);

        const expiryOf = (marker: string): number => {
            const key = host.storageKeys().find(candidate => candidate.includes(marker))!;
            return (host.getStorageEntry(key) as { expiresAt: number }).expiresAt;
        };

        expect(expiryOf(':match:')).toBeGreaterThanOrEqual(before + MATCH_TTL_MS);
        expect(expiryOf(':artist:')).toBeGreaterThanOrEqual(before + ARTIST_TTL_MS);
    });
});
