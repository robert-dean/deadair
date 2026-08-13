// The ListenBrainz transport: the same organisation's data over endpoints that
// answer about a batch at once.
//
// Two things are load-bearing here and both are asserted. First, that a track
// described this way is indistinguishable downstream from one described by the
// web service — it has to emit the same `externalIds` sources, or the host
// quietly stops filling `tracks.mbid` and `albums.mbid`. Second, that answers
// are matched to questions by the echoed arguments and never by position: the
// service omits a pair it could not resolve, so the arrays are not parallel.

import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { musicbrainzManifest, LISTENBRAINZ_BUCKET, LISTENBRAINZ_RATE_PER_SECOND } from '../src/musicbrainz.manifest.js';
import { coverArtUrl, lookupKey, mapListenBrainz, resultKey, tagNames, toLookupQuery } from '../src/listenbrainz.mapping.js';
import { createFakePluginHost, fakeHostFetchResponse, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const RECORDING_MBID = 'e97f805a-ab48-4c52-855e-07049142113d';
const ARTIST_MBID = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';
const GROUP_MBID = 'e75c0549-ad55-39e3-8025-c72c5d4a3c5d';

const refs: TrackRef[] = [
    { artist: 'Portishead', title: 'Glory Box', album: 'Dummy', isrc: 'GBAAA9400005' },
    { artist: 'Massive Attack', title: 'Teardrop', album: 'Mezzanine' },
];

const lookupResults = [
    {
        artist_name_arg: 'Portishead',
        recording_name_arg: 'Glory Box',
        artist_credit_name: 'Portishead',
        recording_name: 'Glory Box',
        recording_mbid: RECORDING_MBID,
        release_mbid: 'rel-mbid',
        release_name: 'Dummy',
        artist_mbids: [ARTIST_MBID],
    },
];

const metadata = {
    [RECORDING_MBID]: {
        release: { name: 'Dummy', year: 1994, mbid: 'rel-mbid', release_group_mbid: GROUP_MBID, caa_id: 12345, caa_release_mbid: 'caa-rel' },
        artist: { name: 'Portishead', artists: [{ name: 'Portishead', artist_mbid: ARTIST_MBID }] },
        tag: {
            recording: [
                { tag: 'trip hop', count: 12 },
                { tag: 'downtempo', count: 4 },
            ],
            release_group: [{ tag: 'electronic', count: 9 }],
        },
    },
};

const json = (body: unknown) => fakeHostFetchResponse({ body: JSON.stringify(body) });

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

const route = (routes: [RegExp, unknown][]): void => {
    host.setFetchImpl(async (url: string) => {
        const matched = routes.find(([pattern]) => pattern.test(url));
        if (!matched) throw new Error(`unrouted request: ${url}`);
        return json(matched[1]);
    });
};

const listenBrainzRoutes: [RegExp, unknown][] = [
    [/metadata\/lookup/, lookupResults],
    [/metadata\/recording/, metadata],
];

/** An empty token is how an operator who has not set one arrives, which is the default. */
const initialize = async (token = 'lb-token'): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90 });
    host.seedSecret('listenBrainzToken', token);
    await plugin.init(host);
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('manifest', () => {
    it('gives ListenBrainz its own bucket, so it is not paced at the MusicBrainz rate', () => {
        expect(musicbrainzManifest.permissions.network).toContainEqual({
            host: 'api.listenbrainz.org',
            ratePerSecond: LISTENBRAINZ_RATE_PER_SECOND,
            bucket: LISTENBRAINZ_BUCKET,
        });
        expect(LISTENBRAINZ_BUCKET).not.toBe('musicbrainz');
    });

    it('still lists the operator mirror last, so the public entries keep their rate', () => {
        expect(musicbrainzManifest.permissions.network.at(-1)).toEqual({ fromConfig: 'baseUrl' });
    });

    it('asks for the token as a secret, so the host encrypts it and the card never reads it back', () => {
        const field = musicbrainzManifest.configFields.find(entry => entry.key === 'listenBrainzToken');
        expect(field?.type).toBe('secret');
        expect(field?.default).toBeUndefined();
    });
});

describe('mapListenBrainz', () => {
    it('emits the same external id sources the host promotes on', () => {
        const mapped = mapListenBrainz(lookupResults[0]!, metadata[RECORDING_MBID], refs[0]!);

        expect(mapped.externalIds).toEqual([
            { source: 'musicbrainz', id: RECORDING_MBID },
            { source: 'musicbrainz-artist', id: ARTIST_MBID },
            { source: 'musicbrainz-release', id: 'rel-mbid' },
            { source: 'musicbrainz-release-group', id: GROUP_MBID },
        ]);
    });

    it('reads the recording tags ahead of the record, and never the artist', () => {
        const mapped = mapListenBrainz(lookupResults[0]!, metadata[RECORDING_MBID], refs[0]!);
        expect(mapped.genres).toEqual(['trip hop', 'downtempo']);
    });

    it('falls back to the release group tags when the recording has none', () => {
        const mapped = mapListenBrainz(
            lookupResults[0]!,
            { ...metadata[RECORDING_MBID], tag: { release_group: [{ tag: 'electronic', count: 9 }] } },
            refs[0]!,
        );
        expect(mapped.genres).toEqual(['electronic']);
    });

    it('takes the year and refuses to invent a date it does not have', () => {
        const mapped = mapListenBrainz(lookupResults[0]!, metadata[RECORDING_MBID], refs[0]!);
        expect(mapped.year).toBe(1994);
        expect(mapped.releaseDate).toBeUndefined();
    });

    it('still answers with the ids when the metadata request said nothing', () => {
        const mapped = mapListenBrainz(lookupResults[0]!, undefined, refs[0]!);

        expect(mapped.externalIds).toContainEqual({ source: 'musicbrainz', id: RECORDING_MBID });
        expect(mapped.year).toBeUndefined();
        expect(mapped.genres).toBeUndefined();
    });

    it('is nothing at all without a recording id, rather than a payload of loose strings', () => {
        expect(mapListenBrainz({ recording_name: 'Glory Box' }, undefined, refs[0]!)).toEqual({});
    });

    it('mints the cover art rather than fetching it, and says nothing when there is none', () => {
        expect(coverArtUrl(12345, 'caa-rel')).toBe('https://coverartarchive.org/release/caa-rel/12345-500.jpg');
        expect(coverArtUrl(undefined, 'caa-rel')).toBeUndefined();
        expect(coverArtUrl(12345, undefined)).toBeUndefined();
    });

    it('drops a tag the community voted down to nothing', () => {
        expect(
            tagNames([
                { tag: 'trip hop', count: 3 },
                { tag: 'nonsense', count: 0 },
            ]),
        ).toEqual(['trip hop']);
    });

    it('pairs an answer to its question through the echoed arguments, not the returned name', () => {
        // The service answers with its own canonical spelling; the `_arg`
        // fields are what was asked, which is the only thing that matches a ref.
        const result = { artist_name_arg: 'Beyonce', recording_name_arg: 'Halo', artist_credit_name: 'Beyoncé', recording_name: 'Halo' };
        expect(resultKey(result)).toBe(lookupKey('Beyonce', 'Halo'));
    });

    it('offers the album as a hint and omits it when there is none', () => {
        expect(toLookupQuery(refs[0]!)).toEqual({ artist_name: 'Portishead', recording_name: 'Glory Box', release_name: 'Dummy' });
        expect(toLookupQuery({ artist: 'Aphex Twin', title: 'Xtal' })).toEqual({ artist_name: 'Aphex Twin', recording_name: 'Xtal' });
    });
});

describe('enrichTracks through ListenBrainz', () => {
    it('describes a batch in two requests instead of one per track', async () => {
        await initialize();
        route(listenBrainzRoutes);

        const answers = await plugin.enrichTracks([refs[0]!]);

        expect(host.calls).toHaveLength(2);
        expect(host.calls.map(call => call.method)).toEqual(['POST', 'POST']);
        expect(answers[0]!.externalIds).toContainEqual({ source: 'musicbrainz', id: RECORDING_MBID });
    });

    it('sends the token, and sends it to ListenBrainz rather than MusicBrainz', async () => {
        await initialize();
        route(listenBrainzRoutes);

        await plugin.enrichTracks([refs[0]!]);

        expect(host.calls[0]!.url).toContain('api.listenbrainz.org');
        expect(host.calls[0]!.headers?.authorization).toBe('Token lb-token');
    });

    it('hands a ref the lookup could not resolve on to the MusicBrainz paths', async () => {
        await initialize();
        route([
            ...listenBrainzRoutes,
            [/recording\?/, { recordings: [{ id: 'rec-td', score: 100, title: 'Teardrop', 'artist-credit': [{ name: 'Massive Attack' }] }] }],
            [/recording\/rec-td/, { id: 'rec-td', title: 'Teardrop', 'artist-credit': [{ name: 'Massive Attack' }] }],
            [/isrc\//, { recordings: [] }],
        ]);

        const answers = await plugin.enrichTracks(refs);

        // The first came from ListenBrainz, the second fell through to the web
        // service. Both are answered.
        expect(answers[0]!.externalIds).toContainEqual({ source: 'musicbrainz', id: RECORDING_MBID });
        expect(answers[1]!.title).toBe('Teardrop');
        expect(host.calls.some(call => call.url.includes('musicbrainz.org'))).toBe(true);
    });

    it('never touches ListenBrainz when no token is configured', async () => {
        await initialize('');
        route([
            [/recording\?/, { recordings: [] }],
            [/isrc\//, { recordings: [] }],
        ]);

        await plugin.enrichTracks(refs);

        expect(host.calls.some(call => call.url.includes('listenbrainz'))).toBe(false);
    });

    it('falls back to the web service when ListenBrainz refuses the token', async () => {
        await initialize();
        host.setFetchImpl(async (url: string) => {
            if (url.includes('listenbrainz')) return fakeHostFetchResponse({ status: 401, statusText: 'Unauthorized', body: '' });
            if (/recording\?/.test(url)) {
                return json({ recordings: [{ id: 'rec-gb', score: 100, title: 'Glory Box', 'artist-credit': [{ name: 'Portishead' }] }] });
            }
            if (/isrc\//.test(url)) return json({ recordings: [] });
            return json({ id: 'rec-gb', title: 'Glory Box', 'artist-credit': [{ name: 'Portishead' }] });
        });

        const answers = await plugin.enrichTracks([refs[0]!]);

        expect(answers[0]!.title).toBe('Glory Box');
    });

    it('still answers from the ids when the metadata request fails', async () => {
        await initialize();
        host.setFetchImpl(async (url: string) => {
            if (url.includes('metadata/lookup')) return json(lookupResults);
            if (url.includes('metadata/recording')) return fakeHostFetchResponse({ status: 503, statusText: 'Unavailable', body: '' });
            throw new Error(`unrouted: ${url}`);
        });

        const answers = await plugin.enrichTracks([refs[0]!]);

        expect(answers[0]!.externalIds).toContainEqual({ source: 'musicbrainz', id: RECORDING_MBID });
        expect(answers[0]!.year).toBeUndefined();
    });
});

describe('testConnection', () => {
    it('says the token is working when it is', async () => {
        await initialize();
        route([[/artist\//, { id: 'x', name: 'Pink Floyd' }], ...listenBrainzRoutes]);

        expect(await plugin.testConnection()).toEqual({ ok: true, message: 'Connected to MusicBrainz, with ListenBrainz batching enabled.' });
    });

    it('says the station is on the slow path when no token is set', async () => {
        await initialize('');
        route([[/artist\//, { id: 'x', name: 'Pink Floyd' }]]);

        const result = await plugin.testConnection();
        expect(result.ok).toBe(true);
        expect(result.message).toContain('one request per second');
    });

    it('still connects, and says so, when the token is refused', async () => {
        await initialize();
        host.setFetchImpl(async (url: string) => {
            if (url.includes('listenbrainz')) return fakeHostFetchResponse({ status: 401, statusText: 'Unauthorized', body: '' });
            return json({ id: 'x', name: 'Pink Floyd' });
        });

        const result = await plugin.testConnection();
        expect(result.ok).toBe(true);
        expect(result.message).toContain('refused the token (HTTP 401)');
    });
});
