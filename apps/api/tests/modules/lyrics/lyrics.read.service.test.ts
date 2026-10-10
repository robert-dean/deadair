// The read-only lyrics routes: one source's words chosen in the operator's order, timed lines before
// plain, never one source's fields mixed with another's, and every source listed best first.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import type { NowPlaying, RundownItem } from '../../../src/modules/playout/rundown.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import { LYRICS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import { LyricsReadService, pickLyrics } from '../../../src/modules/lyrics/lyrics.read.service.js';
import type { ServedLyrics } from '../../../src/modules/lyrics/lyrics.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

const TRACK = '00000000-0000-0000-0000-000000000001';
const FETCHED = DateTime.fromISO('2026-10-01T12:00:00Z');

const row = (provider: string, fields: Partial<ServedLyrics> = {}): ServedLyrics => ({
    provider,
    instrumental: false,
    fetchedAt: FETCHED,
    ...fields,
});

const build = (rows: ServedLyrics[], settings: Record<string, string> = {}, exists = true, onAir?: NowPlaying) => {
    const lyrics = { wordsForServing: vi.fn(async () => rows.map(each => ({ ...each }))) };
    const tracks = { findTrack: vi.fn(async () => (exists ? { id: TRACK } : undefined)) };
    const rundown = { nowPlaying: vi.fn(() => onAir) };
    return new LyricsReadService(tracks as never, lyrics as never, settingsConfig(settings).config, rundown as never);
};

describe('pickLyrics', () => {
    it('prefers a source with timed lines over one with only the words, whatever the order', () => {
        const answer = pickLyrics(TRACK, [
            row('a.plain', { plain: 'first words' }),
            row('b.synced', { plain: 'first words', synced: [{ atMs: 12_000, text: 'first words' }], language: 'en' }),
        ]);

        expect(answer).toEqual({
            trackId: TRACK,
            kind: 'words',
            provider: 'b.synced',
            plain: 'first words',
            synced: [{ atMs: 12_000, text: 'first words' }],
            language: 'en',
        });
    });

    it('never borrows another source’s plain words for the one it chose', () => {
        const answer = pickLyrics(TRACK, [row('a', { synced: [{ atMs: 1_000, text: 'la' }] }), row('b', { plain: 'other words' })]);
        expect(answer.provider).toBe('a');
        expect(answer.plain).toBeUndefined();
    });

    it('answers instrumental only when no source has words', () => {
        expect(pickLyrics(TRACK, [row('a', { instrumental: true })])).toEqual({ trackId: TRACK, kind: 'instrumental', provider: 'a' });
        expect(pickLyrics(TRACK, [row('a', { instrumental: true }), row('b', { plain: 'words' })]).kind).toBe('words');
    });

    it('answers none with nothing to go on', () => {
        expect(pickLyrics(TRACK, [])).toEqual({ trackId: TRACK, kind: 'none' });
    });
});

describe('LyricsReadService', () => {
    it('takes the first source in the operator’s order', async () => {
        const rows = [row('deadair.alpha', { plain: 'alpha words' }), row('deadair.beta', { plain: 'beta words' })];

        expect((await build(rows).getTrackLyrics(TRACK)).provider).toBe('deadair.alpha');
        expect(
            (await build(rows, { [LYRICS_KEYS.providerOrder]: JSON.stringify([{ source: 'deadair.beta' }]) }).getTrackLyrics(TRACK)).provider,
        ).toBe('deadair.beta');
    });

    it('lists every source best first', async () => {
        const rows = [row('deadair.alpha', { plain: 'alpha words' }), row('deadair.beta', { instrumental: true, providerRef: '42' })];
        const answer = await build(rows, { [LYRICS_KEYS.providerOrder]: JSON.stringify([{ source: 'deadair.beta' }]) }).listTrackLyricsSources(TRACK);

        expect(answer.trackId).toBe(TRACK);
        expect(answer.sources.map(source => source.provider)).toEqual(['deadair.beta', 'deadair.alpha']);
        expect(answer.sources[0]).toEqual({ provider: 'deadair.beta', providerRef: '42', instrumental: true, fetchedAt: FETCHED });
    });

    it('answers none rather than 404 for a record with no lyrics yet', async () => {
        await expect(build([]).getTrackLyrics(TRACK)).resolves.toEqual({ trackId: TRACK, kind: 'none' });
    });

    it('404s a record the catalog does not hold, on both routes', async () => {
        await expect(build([], {}, false).getTrackLyrics(TRACK)).rejects.toMatchObject({ statusCode: 404 });
        await expect(build([], {}, false).listTrackLyricsSources(TRACK)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('LyricsReadService.getNowPlayingLyrics', () => {
    const STARTED = 1_790_000_000_000;
    const airing = (item: Partial<RundownItem>): NowPlaying => ({
        item: { pluginId: 'deadair.navidrome', ...item } as RundownItem,
        startedAt: STARTED,
    });
    const words = [row('deadair.lrclib', { synced: [{ atMs: 9_000, text: 'first words' }] })];

    it('answers off air with nothing else', async () => {
        await expect(build(words).getNowPlayingLyrics()).resolves.toEqual({ onAir: false });
    });

    it('carries no lyrics while the station is talking', async () => {
        const answer = await build(words, {}, true, airing({ pluginId: RENDER_PLUGIN_ID, trackId: TRACK })).getNowPlayingLyrics();
        expect(answer).toEqual({ onAir: true, startedAt: STARTED });
    });

    it('carries no lyrics for a record the catalog never held', async () => {
        await expect(build(words, {}, true, airing({})).getNowPlayingLyrics()).resolves.toEqual({ onAir: true, startedAt: STARTED });
    });

    it('answers the record’s lyrics with its start and its cue-in, timings left on the file’s timeline', async () => {
        const answer = await build(words, {}, true, airing({ trackId: TRACK, cueInMs: 1_500.4 })).getNowPlayingLyrics();
        expect(answer).toEqual({
            onAir: true,
            trackId: TRACK,
            startedAt: STARTED,
            cueInMs: 1_500,
            lyrics: { trackId: TRACK, kind: 'words', provider: 'deadair.lrclib', synced: [{ atMs: 9_000, text: 'first words' }] },
        });
    });

    it('leaves the cue-in out for a record that airs from the top, and answers none rather than failing', async () => {
        const answer = await build([], {}, true, airing({ trackId: TRACK, cueInMs: 0 })).getNowPlayingLyrics();
        expect(answer).toEqual({ onAir: true, trackId: TRACK, startedAt: STARTED, lyrics: { trackId: TRACK, kind: 'none' } });
    });
});
