// The batch path. What is being asserted throughout is the *request count*:
// this whole seam exists because MusicBrainz is paced at one request a second,
// so "answered twelve tracks" is only interesting alongside "in three requests".
//
// The fake host routes by URL rather than replaying a FIFO queue, because these
// paths branch — a record whose release-group search misses takes a different
// number of requests than one that hits, and a queue would hide that behind an
// ordering assumption.

import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { createFakePluginHost, fakeHostFetchResponse, type FakePluginHost } from './fake.plugin.host.js';

/** Five tracks off one record, as the walk hands them over: clustered, with ISRCs. */
const dummy: TrackRef[] = [
    { artist: 'Portishead', title: 'Mysterons', album: 'Dummy', isrc: 'GBAAA9400001', durationMs: 305_000 },
    { artist: 'Portishead', title: 'Sour Times', album: 'Dummy', isrc: 'GBAAA9400002', durationMs: 254_000 },
    { artist: 'Portishead', title: 'Strangers', album: 'Dummy', isrc: 'GBAAA9400003', durationMs: 238_000 },
    { artist: 'Portishead', title: 'It Could Be Sweet', album: 'Dummy', isrc: 'GBAAA9400004', durationMs: 256_000 },
    { artist: 'Portishead', title: 'Glory Box', album: 'Dummy', isrc: 'GBAAA9400005', durationMs: 301_000 },
];

const credit = [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }];

/** The release document as `inc=recordings` returns it: tracks nested under media. */
const tracklistRelease = {
    id: 'rel-1',
    title: 'Dummy',
    date: '1994-08-22',
    'release-group': { id: 'rg-1', 'primary-type': 'Album', 'first-release-date': '1994-08-22' },
    media: [
        {
            position: 1,
            tracks: dummy.map((track, position) => ({
                id: `track-${position}`,
                position: position + 1,
                length: track.durationMs,
                recording: {
                    id: `rec-${position}`,
                    title: track.title,
                    length: track.durationMs,
                    'first-release-date': '1994-08-22',
                    'artist-credit': credit,
                    isrcs: [track.isrc],
                },
            })),
        },
    ],
};

const json = (body: unknown) => fakeHostFetchResponse({ body: JSON.stringify(body) });

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

/** Routes a request to the first matching pattern, so a test only scripts what it cares about. */
const route = (routes: [RegExp, unknown][]): void => {
    host.setFetchImpl(async (url: string) => {
        const matched = routes.find(([pattern]) => pattern.test(url));
        if (!matched) throw new Error(`unrouted request: ${url}`);
        return json(matched[1]);
    });
};

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90, ...config });
    await plugin.init(host);
};

/** Every request the plugin made, with the query string dropped, for counting by endpoint. */
const paths = (): string[] => host.calls.map(call => call.url.split('?')[0]!.replace('https://musicbrainz.org/ws/2/', ''));

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('enrichTracks: a record at a time', () => {
    const releaseRoutes: [RegExp, unknown][] = [
        [/release-group\?/, { 'release-groups': [{ id: 'rg-1' }] }],
        [/release-group\/rg-1/, { id: 'rg-1', title: 'Dummy', releases: [{ id: 'rel-1', date: '1994-08-22' }] }],
        [/release\/rel-1/, tracklistRelease],
    ];

    it('answers a whole record from one tracklist rather than one lookup per track', async () => {
        await initialize();
        route(releaseRoutes);

        const answers = await plugin.enrichTracks(dummy);

        expect(answers.map(answer => answer.title)).toEqual(dummy.map(track => track.title));
        // Three requests for five tracks: find the record, open it, read it.
        // The per-track path would have cost ten.
        expect(paths()).toEqual(['release-group', 'release-group/rg-1', 'release/rel-1']);
    });

    it('carries the release group through, so the album pass gets a lookup instead of a search', async () => {
        await initialize();
        route(releaseRoutes);

        const [first] = await plugin.enrichTracks(dummy);

        expect(first!.externalIds).toContainEqual({ source: 'musicbrainz-release-group', id: 'rg-1' });
    });

    it('matches by ISRC ahead of title, so two mixes under one name do not swap', async () => {
        await initialize();
        route([
            [/release-group\?/, { 'release-groups': [{ id: 'rg-1' }] }],
            [/release-group\/rg-1/, { id: 'rg-1', releases: [{ id: 'rel-1' }] }],
            [
                /release\/rel-1/,
                {
                    id: 'rel-1',
                    title: 'Dummy',
                    media: [
                        {
                            tracks: [
                                { recording: { id: 'rec-album', title: 'Glory Box', 'artist-credit': credit, isrcs: ['GBAAA9400005'] } },
                                { recording: { id: 'rec-single', title: 'Glory Box', 'artist-credit': credit, isrcs: ['GBAAA9499999'] } },
                                { recording: { id: 'rec-x', title: 'Mysterons', 'artist-credit': credit, isrcs: ['GBAAA9400001'] } },
                                { recording: { id: 'rec-y', title: 'Sour Times', 'artist-credit': credit, isrcs: ['GBAAA9400002'] } },
                            ],
                        },
                    ],
                },
            ],
        ]);

        const answers = await plugin.enrichTracks([dummy[4]!, dummy[0]!, dummy[1]!]);

        expect(answers[0]!.externalIds).toContainEqual({ source: 'musicbrainz', id: 'rec-album' });
    });

    it('leaves a record with too few outstanding tracks to the per-track path', async () => {
        await initialize();
        route([
            [/recording\?/, { recordings: [{ id: 'rec-0', score: 100, title: 'Mysterons', 'artist-credit': credit }] }],
            [/recording\/rec-0/, { id: 'rec-0', title: 'Mysterons', 'artist-credit': credit }],
            [/isrc\//, { recordings: [{ id: 'rec-0', title: 'Mysterons', 'artist-credit': credit }] }],
        ]);

        await plugin.enrichTracks([dummy[0]!, dummy[1]!]);

        // Two tracks cost two requests either way, so the release lookup is
        // never attempted: nothing here asked about a release group.
        expect(paths().some(path => path.startsWith('release'))).toBe(false);
    });

    it('hands a track the tracklist did not contain to the per-track path rather than dropping it', async () => {
        await initialize();
        const bonus: TrackRef = { artist: 'Portishead', title: 'Sheared Times', album: 'Dummy', isrc: 'GBAAA9400777' };
        route([
            [/release-group\?/, { 'release-groups': [{ id: 'rg-1' }] }],
            [/release-group\/rg-1/, { id: 'rg-1', releases: [{ id: 'rel-1' }] }],
            [/release\/rel-1/, tracklistRelease],
            [/recording\?/, { recordings: [{ id: 'rec-bonus', score: 100, title: 'Sheared Times', 'artist-credit': credit }] }],
            [/recording\/rec-bonus/, { id: 'rec-bonus', title: 'Sheared Times', 'artist-credit': credit }],
            [/isrc\//, { recordings: [] }],
        ]);

        const answers = await plugin.enrichTracks([...dummy, bonus]);

        expect(answers.at(-1)!.title).toBe('Sheared Times');
    });
});

describe('enrichTracks: a batch of ISRCs in one search', () => {
    /** Tracks with no album, so the release path never engages and the ISRC path is what runs. */
    const singles: TrackRef[] = [
        { artist: 'Portishead', title: 'Mysterons', isrc: 'GBAAA9400001' },
        { artist: 'Portishead', title: 'Sour Times', isrc: 'GBAAA9400002' },
        { artist: 'Portishead', title: 'Strangers', isrc: 'GBAAA9400003' },
    ];

    const pool = {
        recordings: singles.map((track, position) => ({
            id: `rec-${position}`,
            score: 100,
            title: track.title,
            'artist-credit': credit,
        })),
    };

    it('identifies the whole chunk with one search instead of one lookup per code', async () => {
        await initialize();
        route([
            [/recording\?/, pool],
            [/recording\/rec-/, { id: 'rec-0', title: 'Mysterons', 'artist-credit': credit }],
        ]);

        await plugin.enrichTracks(singles);

        expect(paths().filter(path => path === 'recording')).toHaveLength(1);
        expect(host.calls[0]!.url).toContain('isrc%3AGBAAA9400001+OR+isrc%3AGBAAA9400002');
    });

    it('scores the pool back against each ref rather than reading it positionally', async () => {
        await initialize();
        // Deliberately returned in an order that does not match the refs, which
        // is what a real search does: relevance order, not request order.
        route([
            [/recording\?/, { recordings: [...pool.recordings].reverse() }],
            [/recording\/rec-0/, { id: 'rec-0', title: 'Mysterons', 'artist-credit': credit }],
            [/recording\/rec-1/, { id: 'rec-1', title: 'Sour Times', 'artist-credit': credit }],
            [/recording\/rec-2/, { id: 'rec-2', title: 'Strangers', 'artist-credit': credit }],
        ]);

        const answers = await plugin.enrichTracks(singles);

        expect(answers.map(answer => answer.title)).toEqual(['Mysterons', 'Sour Times', 'Strangers']);
    });

    it('upper-cases the codes, because the service will not take them lower', async () => {
        await initialize();
        route([
            [/recording\?/, { recordings: [] }],
            [/isrc\//, { recordings: [] }],
        ]);

        await plugin.enrichTracks(singles.map(track => ({ ...track, isrc: track.isrc!.toLowerCase() })));

        expect(host.calls[0]!.url).toContain('GBAAA9400001');
    });

    it('returns an empty answer for a ref nothing could account for, not a throw', async () => {
        await initialize();
        route([
            [/recording\?/, { recordings: [] }],
            [/isrc\//, { recordings: [] }],
        ]);

        const answers = await plugin.enrichTracks(singles);

        expect(answers).toEqual([{}, {}, {}]);
    });
});

describe('enrichTracks: the contract the host relies on', () => {
    it('answers index-aligned and the same length as it was asked', async () => {
        await initialize();
        route([
            [/recording\?/, { recordings: [] }],
            [/isrc\//, { recordings: [] }],
        ]);

        const answers = await plugin.enrichTracks(dummy.slice(0, 2));

        expect(answers).toHaveLength(2);
    });

    it('answers every ref emptily when no contact address was configured', async () => {
        await initialize({ contactEmail: '' });

        expect(await plugin.enrichTracks(dummy)).toEqual(dummy.map(() => ({})));
        expect(host.calls).toHaveLength(0);
    });

    it('keeps what it already resolved when the budget runs out part way through', async () => {
        await initialize();
        route([
            [/release-group\?/, { 'release-groups': [{ id: 'rg-1' }] }],
            [/release-group\/rg-1/, { id: 'rg-1', releases: [{ id: 'rel-1' }] }],
            [/release\/rel-1/, tracklistRelease],
        ]);
        host.seedRemainingMs(0);

        // Every optional step sheds, so nothing is answered — but the call
        // returns the aligned array rather than failing the whole batch.
        expect(await plugin.enrichTracks(dummy)).toEqual(dummy.map(() => ({})));
    });
});
