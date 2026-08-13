import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { coverArtUrl, mapAlbum, selectReleaseFromGroup, selectReleaseGroup } from '../src/musicbrainz.mapping.js';
import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import type { MusicBrainzRelease, MusicBrainzReleaseGroup } from '../src/musicbrainz.types.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const releaseDetail: MusicBrainzRelease = {
    id: 'rel-1',
    title: 'Dummy',
    date: '1994-08-22',
    'label-info': [{ label: { id: 'lab-1', name: 'Go! Beat' } }],
    'cover-art-archive': { artwork: true, front: true, count: 4 },
};

const releaseGroup: MusicBrainzReleaseGroup = {
    id: 'rg-1',
    title: 'Dummy',
    'primary-type': 'Album',
    'first-release-date': '1994-08-22',
    'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
    releases: [{ id: 'rel-1', title: 'Dummy', date: '1994-08-22' }],
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
    releases: [{ id: 'rel-1', title: 'Dummy', date: '1994-08-22', 'release-group': { id: 'rg-1', 'primary-type': 'Album' } }],
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

describe('mapAlbum', () => {
    it('reads the title, the label, the date and the artwork', () => {
        expect(mapAlbum(releaseGroup, releaseDetail, true)).toEqual({
            // The release group, because that is what this answer was fetched under
            // and what the host hands back next pass.
            providerRef: 'rg-1',
            name: 'Dummy',
            artist: 'Portishead',
            label: 'Go! Beat',
            releaseDate: '1994-08-22',
            year: 1994,
            artworkUrl: 'https://coverartarchive.org/release/rel-1/front-500',
            externalIds: [
                { source: 'musicbrainz-release-group', id: 'rg-1' },
                { source: 'musicbrainz-release', id: 'rel-1' },
            ],
            links: [{ label: 'MusicBrainz release group', url: 'https://musicbrainz.org/release-group/rg-1' }],
        });
    });

    it('dates the record by its first release, not by the pressing in hand', () => {
        const reissue: MusicBrainzRelease = { ...releaseDetail, date: '2008-01-01' };
        expect(mapAlbum(releaseGroup, reissue, true).year).toBe(1994);
    });

    it('leaves the artwork out when the operator turned it off', () => {
        expect(mapAlbum(releaseGroup, releaseDetail, false).artworkUrl).toBeUndefined();
    });

    it('skips a joint issue entry that names no label', () => {
        const joint: MusicBrainzRelease = { ...releaseDetail, 'label-info': [{ 'catalog-number': 'GOD 123' }, { label: { name: 'Go! Beat' } }] };
        expect(mapAlbum(releaseGroup, joint, true).label).toBe('Go! Beat');
    });

    it('has nothing to say about a record it was never given', () => {
        expect(mapAlbum(undefined, undefined, true)).toEqual({});
    });
});

describe('selectReleaseFromGroup', () => {
    it('takes the original issue, whose label is the one that put the record out', () => {
        const group = {
            releases: [
                { id: 'rel-2', date: '2008-01-01' },
                { id: 'rel-1', date: '1994-08-22' },
            ],
        };
        expect(selectReleaseFromGroup(group)?.id).toBe('rel-1');
    });

    it('has nothing to choose from an empty group', () => {
        expect(selectReleaseFromGroup({ releases: [] })).toBeUndefined();
        expect(selectReleaseFromGroup(undefined)).toBeUndefined();
    });
});

describe('enrichAlbum', () => {
    it('looks the record up by the id the host holds, then one pressing for the label', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(releaseGroup) });
        host.queueResponse({ body: JSON.stringify(releaseDetail) });

        const enrichment = await plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead', mbid: 'rg-1' });

        expect(host.calls).toHaveLength(2);
        expect(host.calls[0]!.url).toContain('release-group/rg-1?inc=');
        expect(host.calls[1]!.url).toContain('release/rel-1?inc=labels');
        expect(enrichment).toMatchObject({ label: 'Go! Beat', artworkUrl: 'https://coverartarchive.org/release/rel-1/front-500' });
    });

    it('searches on artist and title the first time anything asks', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ 'release-groups': [{ id: 'rg-1', title: 'Dummy' }] }) });
        host.queueResponse({ body: JSON.stringify(releaseGroup) });
        host.queueResponse({ body: JSON.stringify(releaseDetail) });

        await plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead' });

        expect(host.calls[0]!.url).toContain('release-group?query=');
        expect(decodeURIComponent(host.calls[0]!.url)).toContain('artist:"Portishead"');
    });

    it('says nothing when the search finds no such record', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ 'release-groups': [] }) });

        await expect(plugin.enrichAlbum({ name: 'Nothing', artist: 'Nobody' })).resolves.toEqual({});
    });

    it('keeps the record when the pressing lookup fails, because a label is not the answer', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(releaseGroup) });
        host.queueResponse({ status: 503, body: '' });

        const enrichment = await plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead', mbid: 'rg-1' });

        expect(enrichment.name).toBe('Dummy');
        expect(enrichment.label).toBeUndefined();
    });
});

describe('enrichTrack no longer pays for the release', () => {
    it('makes no release request of its own', async () => {
        await initialize();
        queueMatch();

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(2);
        expect(enrichment).toMatchObject({ title: 'Glory Box', album: 'Dummy' });
        expect(enrichment.label).toBeUndefined();
    });

    it('still names the release group, which is what fills albums.mbid', async () => {
        await initialize();
        queueMatch();

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment.externalIds).toContainEqual({ source: 'musicbrainz-release-group', id: 'rg-1' });
    });

    it('falls back to the release date when the recording has no first release', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify({ ...recordingDetail, 'first-release-date': undefined }) });

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment.releaseDate).toBe('1994-08-22');
        expect(enrichment.year).toBe(1994);
    });
});

/**
 * The real answer to `releasegroup:"back in black" AND artist:"AC/DC"`, in the
 * order the live service returns it. The single ties with the album at 100 and
 * comes first, which is the whole problem.
 */
const backInBlack = [
    { id: 'rg-single', score: 100, title: 'Back in Black', 'primary-type': 'Single' },
    { id: 'rg-album', score: 100, title: 'Back in Black', 'primary-type': 'Album' },
    { id: 'rg-videos', score: 90, title: 'Back in Black (The Videos)', 'primary-type': 'Other' },
    { id: 'rg-rocker', score: 90, title: 'Rocker / Back in Black', 'primary-type': 'Single' },
    {
        id: 'rg-live',
        score: 84,
        title: 'Back in Black Live: American Radio Broadcasts',
        'primary-type': 'Album',
        'secondary-types': ['Compilation', 'Live'],
    },
];

describe('selectReleaseGroup', () => {
    it('takes the album over the single it is tied with', () => {
        expect(selectReleaseGroup(backInBlack)?.id).toBe('rg-album');
    });

    it('prefers a record to a short record to a single', () => {
        const tied = [
            { id: 'single', score: 100, 'primary-type': 'Single' },
            { id: 'ep', score: 100, 'primary-type': 'EP' },
            { id: 'album', score: 100, 'primary-type': 'Album' },
        ];
        expect(selectReleaseGroup(tied)?.id).toBe('album');
        expect(selectReleaseGroup(tied.slice(0, 2))?.id).toBe('ep');
    });

    it('puts a compilation or a live record below every plain one, whatever its type', () => {
        const candidates = [
            { id: 'live-album', score: 100, 'primary-type': 'Album', 'secondary-types': ['Live'] },
            { id: 'single', score: 100, 'primary-type': 'Single' },
        ];
        expect(selectReleaseGroup(candidates)?.id).toBe('single');
    });

    it('does not reach past a genuine tie into a worse match', () => {
        // The single is what the search actually found; the album named here is
        // a different record that merely shares some words.
        const candidates = [
            { id: 'single', score: 100, 'primary-type': 'Single' },
            { id: 'other-album', score: 60, 'primary-type': 'Album' },
        ];
        expect(selectReleaseGroup(candidates)?.id).toBe('single');
    });

    it('falls back to the best score when nothing has a type at all', () => {
        expect(
            selectReleaseGroup([
                { id: 'a', score: 80 },
                { id: 'b', score: 95 },
            ])?.id,
        ).toBe('b');
    });

    it('ignores a candidate with no id, and says nothing when none are usable', () => {
        expect(selectReleaseGroup([{ score: 100, 'primary-type': 'Album' }])).toBeUndefined();
        expect(selectReleaseGroup([])).toBeUndefined();
    });
});
