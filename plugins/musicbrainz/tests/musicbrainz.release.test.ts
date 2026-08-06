import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { coverArtUrl, mapRelease } from '../src/musicbrainz.mapping.js';
import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import type { MusicBrainzRelease } from '../src/musicbrainz.types.js';
import { createFakePluginHost, type FakePluginHost } from './fake.plugin.host.js';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const releaseDetail: MusicBrainzRelease = {
    id: 'rel-1',
    title: 'Dummy',
    date: '1994-08-22',
    'label-info': [{ label: { id: 'lab-1', name: 'Go! Beat' } }],
    'cover-art-archive': { artwork: true, front: true, count: 4 },
};

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
    releases: [{ id: 'rel-1', title: 'Dummy', date: '1994-08-22', 'release-group': { 'primary-type': 'Album' } }],
};

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

/** Artist background is off throughout: this suite is about the release, and its request would only add noise. */
const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90, includeArtwork: true, includeArtistFacts: false, ...config });
    await plugin.init(host);
};

/** Queues the two requests every match makes, so a test only has to script the third. */
const queueMatch = (): void => {
    host.queueResponse({ body: JSON.stringify(searchResult) });
    host.queueResponse({ body: JSON.stringify(recordingDetail) });
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('coverArtUrl', () => {
    it('derives the front cover without asking anyone', () => {
        expect(coverArtUrl(releaseDetail)).toBe('https://coverartarchive.org/release/rel-1/front-500');
    });

    it('says nothing when the archive holds no front cover', () => {
        expect(coverArtUrl({ id: 'rel-1', 'cover-art-archive': { artwork: true, front: false } })).toBeUndefined();
        expect(coverArtUrl({ id: 'rel-1' })).toBeUndefined();
        expect(coverArtUrl(undefined)).toBeUndefined();
    });
});

describe('mapRelease', () => {
    it('reads the label, the date and the artwork', () => {
        expect(mapRelease(releaseDetail, true)).toEqual({
            label: 'Go! Beat',
            releaseDate: '1994-08-22',
            year: 1994,
            artworkUrl: 'https://coverartarchive.org/release/rel-1/front-500',
        });
    });

    it('leaves the artwork out when the operator turned it off', () => {
        expect(mapRelease(releaseDetail, false).artworkUrl).toBeUndefined();
    });

    it('skips a joint issue entry that names no label', () => {
        const joint: MusicBrainzRelease = { ...releaseDetail, 'label-info': [{ 'catalog-number': 'GOD 123' }, { label: { name: 'Go! Beat' } }] };
        expect(mapRelease(joint, true).label).toBe('Go! Beat');
    });

    it('has nothing to say about a release it was never given', () => {
        expect(mapRelease(undefined, true)).toEqual({});
    });
});

describe('enrichTrack with the release lookup', () => {
    it('adds the label and the artwork to the match', async () => {
        await initialize();
        queueMatch();
        host.queueResponse({ body: JSON.stringify(releaseDetail) });

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(3);
        expect(host.calls[2]!.url).toContain('release/rel-1?inc=labels');
        expect(enrichment).toMatchObject({ label: 'Go! Beat', artworkUrl: 'https://coverartarchive.org/release/rel-1/front-500' });
    });

    it('keeps the recording date when the release is a later pressing', async () => {
        await initialize();
        queueMatch();
        host.queueResponse({ body: JSON.stringify({ ...releaseDetail, date: '2008-01-01' }) });

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment.releaseDate).toBe('1994-08-22');
        expect(enrichment.year).toBe(1994);
    });

    it('takes the release date when the recording has no first release', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify({ ...recordingDetail, 'first-release-date': undefined }) });
        host.queueResponse({ body: JSON.stringify(releaseDetail) });

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment.releaseDate).toBe('1994-08-22');
        expect(enrichment.year).toBe(1994);
    });

    it('skips the lookup and returns the match when the budget is spent', async () => {
        await initialize();
        queueMatch();
        host.seedRemainingMs(900);

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(2);
        expect(enrichment.label).toBeUndefined();
        expect(enrichment.title).toBe('Glory Box');
    });

    it('drops the lookup rather than the enrichment when it fails', async () => {
        await initialize();
        queueMatch();
        host.queueResponse({ status: 503, ok: false, body: '' });

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment).toMatchObject({ title: 'Glory Box', album: 'Dummy' });
        expect(enrichment.label).toBeUndefined();
    });

    it('makes no release request for a match with no release at all', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify({ ...recordingDetail, releases: undefined }) });

        await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(2);
    });
});
