import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { musicbrainzManifest } from '../src/musicbrainz.manifest.js';
import { createFakePluginHost, type FakePluginHost } from './fake.plugin.host.js';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy', durationMs: 301_000 };

const searchResult = {
    recordings: [
        {
            id: 'rec-1',
            score: 100,
            title: 'Glory Box',
            length: 301_000,
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
    isrcs: ['GBAAA9400123'],
    genres: [{ name: 'trip hop', count: 12 }],
};

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', baseUrl: 'https://musicbrainz.org/ws/2', matchScore: 90, ...config });
    await plugin.init(host);
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('manifest', () => {
    it('declares the pacing MusicBrainz asks for, on one bucket for both hostnames', () => {
        // ListenBrainz is paced here too, on its own bucket — see
        // `listenbrainz.test.ts`. What this asserts is the MusicBrainz half:
        // both of its hostnames draw on one limiter, because the published
        // limit covers the service rather than the host.
        const paced = musicbrainzManifest.permissions.network.filter(entry => typeof entry !== 'string' && 'host' in entry);
        expect(paced.filter(entry => (entry as { host: string }).host.includes('musicbrainz.org'))).toEqual([
            { host: 'musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
            { host: '*.musicbrainz.org', ratePerSecond: 1, bucket: 'musicbrainz' },
        ]);
    });

    it('lets the operator name a mirror, and lists it after the public entries so those keep their rate', () => {
        expect(musicbrainzManifest.permissions.network.at(-1)).toEqual({ fromConfig: 'baseUrl' });
    });

    it('asks for no capability beyond the network it reads from', () => {
        // The host stores every answer against the entity it is about, so there
        // is nothing left for plugin-private storage to hold.
        expect(musicbrainzManifest.permissions.storage).toBe(false);
        expect(musicbrainzManifest.permissions.oauth).toBe(false);
    });
});

describe('init', () => {
    it('runs at the canonical priority and matches on both keys', () => {
        expect(plugin.priority).toBe(100);
        expect(plugin.matchKeys).toEqual(['isrc', 'artist-title']);
    });

    it('leaves the plugin inert when no contact address is configured', async () => {
        await initialize({ contactEmail: '' });
        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});

describe('testConnection', () => {
    it('says what to fix before it says the connection failed', async () => {
        await initialize({ contactEmail: '   ' });
        await expect(plugin.testConnection()).resolves.toEqual({
            ok: false,
            message: 'Add a contact email address. MusicBrainz refuses clients that do not identify themselves.',
        });
    });

    it('looks up a known artist and reports the status when that fails', async () => {
        await initialize();
        host.queueResponse({ status: 503, body: '' });
        await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'MusicBrainz replied HTTP 503.' });
    });

    it('refuses a 200 that is not a MusicBrainz artist', async () => {
        await initialize();
        host.queueResponse({ body: '{"ok":true}' });
        const result = await plugin.testConnection();
        expect(result.ok).toBe(false);
        expect(result.message).toContain('not with a MusicBrainz artist');
    });

    it('passes on a real artist document', async () => {
        await initialize();
        host.queueResponse({ body: '{"id":"art-1","name":"Pink Floyd"}' });
        // No token is seeded here, so the message says which path the
        // station is actually on rather than a bare "connected".
        await expect(plugin.testConnection()).resolves.toEqual({
            ok: true,
            message: 'Connected to MusicBrainz. No ListenBrainz token, so enrichment runs one request per second.',
        });
    });
});

describe('enrichTrack', () => {
    it('searches, then loads the match, and maps what came back', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls[0]!.url).toContain('recording?query=recording%3A%22Glory+Box%22+AND+artist%3A%22Portishead%22');
        expect(host.calls[1]!.url).toContain('recording/rec-1?inc=artist-credits%2Breleases%2Brelease-groups%2Bisrcs%2Bgenres%2Btags');
        expect(enrichment).toMatchObject({ artist: 'Portishead', album: 'Dummy', year: 1994, genres: ['trip hop'], isrc: 'GBAAA9400123' });
    });

    it('prefers the ISRC and never runs the search when it resolves', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ isrc: 'GBAAA9400123', recordings: [searchResult.recordings[0]] }) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        await plugin.enrichTrack({ ...ref, isrc: 'GBAAA9400123' });

        expect(host.calls[0]!.url).toContain('isrc/GBAAA9400123');
        expect(host.calls.some(call => call.url.includes('recording?query'))).toBe(false);
    });

    it('falls back to the search when the ISRC is one MusicBrainz has never seen', async () => {
        await initialize();
        host.queueResponse({ status: 404, body: '{"error":"Not Found"}' });
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        const enrichment = await plugin.enrichTrack({ ...ref, isrc: 'GBAAA0000000' });

        expect(host.calls[0]!.url).toContain('isrc/GBAAA0000000');
        expect(host.calls[1]!.url).toContain('recording?query');
        expect(enrichment.title).toBe('Glory Box');
    });

    it('upper cases the code, because a lower case one is a 400 rather than a lookup', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ isrc: 'GBAAA9400123', recordings: [searchResult.recordings[0]] }) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        await plugin.enrichTrack({ ...ref, isrc: 'gbaaa9400123' });

        expect(host.calls[0]!.url).toContain('isrc/GBAAA9400123');
    });

    it('falls back to the search when MusicBrainz refuses the code outright', async () => {
        await initialize();
        host.queueResponse({ status: 400, body: '{"error":"Invalid isrc."}' });
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        // A 400 must not fail the track: one malformed code in a rotation would
        // otherwise spend a strike on the breaker and quarantine the plugin.
        const enrichment = await plugin.enrichTrack({ ...ref, isrc: 'NOTANISRC123' });

        expect(host.calls[1]!.url).toContain('recording?query');
        expect(enrichment.title).toBe('Glory Box');
    });

    it('returns nothing when no candidate is confident enough', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ recordings: [{ ...searchResult.recordings[0], score: 40 }] }) });

        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
        expect(host.calls).toHaveLength(1);
    });

    it('honours a lowered match score from the settings card', async () => {
        await initialize({ matchScore: 30 });
        host.queueResponse({ body: JSON.stringify({ recordings: [{ ...searchResult.recordings[0], score: 40 }] }) });
        host.queueResponse({ body: JSON.stringify(recordingDetail) });

        await expect(plugin.enrichTrack(ref)).resolves.toMatchObject({ title: 'Glory Box' });
    });

    it('keeps a confident match when the detail lookup fails', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(searchResult) });
        host.queueResponse({ status: 503, body: '' });

        const enrichment = await plugin.enrichTrack(ref);

        expect(enrichment).toMatchObject({ artist: 'Portishead', album: 'Dummy' });
        expect(enrichment.year).toBeUndefined();
    });

    it('lets a broken search reach the host rather than swallowing it as a miss', async () => {
        await initialize();
        host.queueResponse({ status: 500, body: '' });

        await expect(plugin.enrichTrack(ref)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('goes quiet after dispose', async () => {
        await initialize();
        await plugin.dispose();
        await expect(plugin.enrichTrack(ref)).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});
