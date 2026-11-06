// Records in a style, from ListenBrainz's tag radio.
//
// Four things are load-bearing. It works with NO token, because both endpoints are open and a
// station without one still needs to reach a style. The popularity window is the operator's floor
// to the top, since the endpoint samples it and the window is the whole of its judgement. The tag
// answer is ids only, so the names and the LEAD artist come from the metadata call, and a record it
// cannot name is dropped rather than guessed at. And every failure is an empty answer, for the
// quarantine reason the similarity tests give.

import { beforeEach, describe, expect, it } from 'vitest';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { DEFAULT_TAG_POPULARITY } from '../src/musicbrainz.manifest.js';
import { tagRecordingMbids, toTagTracks } from '../src/listenbrainz.mapping.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90, ...config });
    host.seedSecret('listenBrainzToken', '');
    await plugin.init(host);
};

const tagged = JSON.stringify([
    { recording_mbid: 'rec-1', percent: 99, source: 'artist', tag_count: 3 },
    { recording_mbid: 'rec-2', percent: 90, source: 'recording', tag_count: 1 },
    { recording_mbid: 'rec-1', percent: 99, source: 'release-group', tag_count: 2 },
]);

const metadata = JSON.stringify({
    'rec-1': {
        recording: { name: 'Hollywood Heights' },
        artist: { name: 'Mitch Murder feat. Someone', artists: [{ name: 'Mitch Murder' }, { name: 'Someone' }] },
        release: { name: 'Interceptor' },
    },
    'rec-2': { recording: { name: 'Prism' }, artist: { artists: [{ name: 'Kalax' }] } },
});

const parameters = (url: string | undefined): URLSearchParams => new URL(url ?? 'https://invalid').searchParams;

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('tracksForTags', () => {
    it('asks the tag radio without a token and names each record by its lead artist', async () => {
        await initialize();
        host.queueResponse({ body: tagged });
        host.queueResponse({ body: metadata });

        const found = await plugin.tracksForTags({ tags: ['Synthwave '], match: 'all' }, 10);

        expect(host.calls[0]?.url).toContain('1/lb-radio/tags?');
        expect(host.calls[0]?.headers?.authorization).toBeUndefined();
        const asked = parameters(host.calls[0]?.url);
        expect(asked.getAll('tag')).toEqual(['synthwave']);
        expect(asked.get('operator')).toBe('AND');
        expect(asked.get('pop_begin')).toBe(String(DEFAULT_TAG_POPULARITY));
        expect(asked.get('pop_end')).toBe('100');
        expect(found).toEqual([
            { title: 'Hollywood Heights', artist: 'Mitch Murder', album: 'Interceptor' },
            { title: 'Prism', artist: 'Kalax' },
        ]);
    });

    it('asks for any of several tags with OR, each tag once', async () => {
        await initialize();
        host.queueResponse({ body: tagged });
        host.queueResponse({ body: metadata });

        await plugin.tracksForTags({ tags: ['synthwave', 'outrun', 'SYNTHWAVE'], match: 'any' }, 10);

        const asked = parameters(host.calls[0]?.url);
        expect(asked.getAll('tag')).toEqual(['synthwave', 'outrun']);
        expect(asked.get('operator')).toBe('OR');
    });

    it('asks from the operator floor, and a floor nobody can read is the default', async () => {
        await initialize({ tagPopularity: 40 });
        host.queueResponse({ body: '[]' });
        await plugin.tracksForTags({ tags: ['synthwave'], match: 'all' }, 10);
        expect(parameters(host.calls[0]?.url).get('pop_begin')).toBe('40');

        host = createFakePluginHost();
        plugin = new MusicBrainzPlugin();
        await initialize({ tagPopularity: 'lots' });
        host.queueResponse({ body: '[]' });
        await plugin.tracksForTags({ tags: ['synthwave'], match: 'all' }, 10);
        expect(parameters(host.calls[0]?.url).get('pop_begin')).toBe(String(DEFAULT_TAG_POPULARITY));
    });

    it('asks nothing for no usable tags', async () => {
        await initialize();
        expect(await plugin.tracksForTags({ tags: [' ', ''], match: 'all' }, 10)).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('stops before the metadata call when no record carries the tags', async () => {
        await initialize();
        host.queueResponse({ body: '[]' });

        expect(await plugin.tracksForTags({ tags: ['nobody-uses-this'], match: 'all' }, 10)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });

    it('answers empty rather than throwing when the endpoint closes to anonymous callers', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ code: 401, error: 'scrapers' }), status: 401 });

        expect(await plugin.tracksForTags({ tags: ['synthwave'], match: 'all' }, 10)).toEqual([]);
    });

    it('stops before naming the records when the call is nearly out of time', async () => {
        await initialize();
        host.queueResponse({ body: tagged });
        host.seedRemainingMs(1_000);

        expect(await plugin.tracksForTags({ tags: ['synthwave'], match: 'all' }, 10)).toEqual([]);
        expect(host.calls).toHaveLength(1);
    });
});

describe('the tag mapping', () => {
    it('keeps each recording once, in the order given', () => {
        expect(tagRecordingMbids([{ recording_mbid: 'a' }, { recording_mbid: 'b' }, { recording_mbid: 'a' }, {}])).toEqual(['a', 'b']);
    });

    it('drops a record it cannot name or find a lead for, and a second copy of one song', () => {
        const tracks = toTagTracks(['a', 'b', 'c', 'd'], {
            a: { recording: { name: 'Prism' }, artist: { artists: [{ name: 'Kalax' }] } },
            b: { recording: { name: 'No Lead' }, artist: { name: 'Somebody' } },
            c: { artist: { artists: [{ name: 'No Title' }] } },
            d: { recording: { name: 'prism' }, artist: { artists: [{ name: 'KALAX' }] }, release: { name: 'The Album' } },
        });
        expect(tracks).toEqual([{ title: 'Prism', artist: 'Kalax' }]);
    });
});
