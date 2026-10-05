// The plugin: one strict question per record, a 404 as a miss, a refusal as a loud failure, and an
// answer mapped into the station's terms. Every response here is scripted; nothing reaches LRCLIB.

import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';
import type { TrackRef } from '@deadair/plugin-sdk';

import { LrclibPlugin, mapRecord } from '../src/lrclib.plugin.js';
import { LrclibRequestError, USER_AGENT } from '../src/lrclib.client.js';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy', durationMs: 301_400 };

const glory = {
    id: 3794473,
    trackName: 'Glory Box',
    artistName: 'Portishead',
    albumName: 'Dummy',
    duration: 302,
    instrumental: false,
    plainLyrics: "I'm so tired of playing\nPlaying with this bow and arrow",
    syncedLyrics: "[00:29.79] I'm so tired of playing\n[00:34.26] Playing with this bow and arrow\n[00:37.46] ",
};

async function load(config: Record<string, unknown> = {}) {
    const host = createFakePluginHost();
    host.seedConfig({ baseUrl: 'https://lrclib.net', ...config });
    const plugin = new LrclibPlugin();
    await plugin.init(host);
    return { host, plugin };
}

describe('lyricsFor', () => {
    it('asks exactly one strict question, naming itself', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify(glory) });

        await plugin.lyricsFor(ref);

        expect(host.calls).toHaveLength(1);
        const url = new URL(host.calls[0]!.url);
        expect(url.origin + url.pathname).toBe('https://lrclib.net/api/get');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            artist_name: 'Portishead',
            track_name: 'Glory Box',
            album_name: 'Dummy',
            duration: '301',
        });
        expect(host.calls[0]?.headers?.['user-agent']).toBe(USER_AGENT);
    });

    it('answers with the words, the timed lines and the record’s id', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify(glory) });

        const answer = await plugin.lyricsFor(ref);

        expect(answer.plain).toContain('bow and arrow');
        expect(answer.synced?.[0]).toEqual({ atMs: 29_790, text: "I'm so tired of playing" });
        expect(answer.providerRef).toBe('3794473');
    });

    it('reads a 404 as a miss, with no second, looser question', async () => {
        const { host, plugin } = await load();
        host.queueResponse({
            status: 404,
            body: JSON.stringify({ message: 'Failed to find specified track', name: 'TrackNotFound', statusCode: 404 }),
        });

        expect(await plugin.lyricsFor(ref)).toEqual({});
        expect(host.calls).toHaveLength(1);
    });

    it('does not ask about a record with no length, which would be a match on names alone', async () => {
        const { host, plugin } = await load();

        expect(await plugin.lyricsFor({ artist: 'Portishead', title: 'Glory Box' })).toEqual({});
        expect(host.calls).toHaveLength(0);
    });

    it('leaves the album out of the question when the record has none', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify(glory) });

        await plugin.lyricsFor({ artist: 'Portishead', title: 'Glory Box', durationMs: 302_000 });

        expect(new URL(host.calls[0]!.url).searchParams.has('album_name')).toBe(false);
    });

    it('does not believe an answer whose length is far from the record’s', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify({ ...glory, duration: 290 }) });

        expect(await plugin.lyricsFor(ref)).toEqual({});
    });

    it('fails loudly on a refusal, rather than reading it as an empty library', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ status: 403, body: JSON.stringify({ message: 'Forbidden' }) });

        const error = await plugin.lyricsFor(ref).catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(LrclibRequestError);
        expect((error as LrclibRequestError).status).toBe(403);
    });

    it('reports a busy service as a rate limit, carrying how long to wait', async () => {
        const { host, plugin } = await load();
        host.queueResponse({
            status: 503,
            headers: { 'retry-after': '2' },
            body: JSON.stringify({ message: 'The server is busy, please retry in a moment', name: 'ServerOverloaded', statusCode: 503 }),
        });

        const error = (await plugin.lyricsFor(ref).catch((thrown: unknown) => thrown)) as LrclibRequestError;

        expect(error.code).toBe('rate_limited');
        expect(error.retryAfterMs).toBe(2_000);
    });

    it('asks the copy the operator points it at', async () => {
        const { host, plugin } = await load({ baseUrl: 'http://lrclib.lan:3300/' });
        host.queueResponse({ body: JSON.stringify(glory) });

        await plugin.lyricsFor(ref);

        expect(host.calls[0]!.url.startsWith('http://lrclib.lan:3300/api/get?')).toBe(true);
    });
});

describe('mapRecord', () => {
    it('reports LRCLIB’s instrumental flag as an instrumental, with no words', () => {
        expect(mapRecord({ id: 1, instrumental: true, plainLyrics: null, syncedLyrics: null })).toEqual({ instrumental: true, providerRef: '1' });
    });

    it('reports a body that is only an instrumental marker as an instrumental', () => {
        expect(mapRecord({ id: 2, plainLyrics: '[au: instrumental]', syncedLyrics: null })).toEqual({ instrumental: true, providerRef: '2' });
    });

    it('keeps plain words when there are no timings', () => {
        expect(mapRecord({ id: 3, plainLyrics: 'Words only', syncedLyrics: null })).toEqual({ plain: 'Words only', providerRef: '3' });
    });

    it('answers nothing for a record that holds nothing', () => {
        expect(mapRecord({ id: 4, plainLyrics: '', syncedLyrics: '' })).toEqual({});
    });
});

describe('testConnection', () => {
    it('is connected when the test record comes back', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify(glory) });
        expect((await plugin.testConnection()).ok).toBe(true);
    });

    it('is connected when a copy does not hold the test record', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ status: 404, body: '{}' });
        expect((await plugin.testConnection()).ok).toBe(true);
    });

    it('is not connected when something other than LRCLIB answers', async () => {
        const { host, plugin } = await load();
        host.queueResponse({ body: JSON.stringify({ hello: 'world' }) });
        expect((await plugin.testConnection()).ok).toBe(false);
    });
});
