import type { PlayoutStatus } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { NowPlayingKeys, viewFor } from '../../src/actions/now.playing.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { PROGRESS_STEPS } from '../../src/display/key.image.js';
import type { Station } from '../../src/station/station.settings.js';
import { StatusPoller, type Playout } from '../../src/station/status.poller.js';
import { fakeKey } from '../fixtures/fake.key.js';
import { airing, record, stoodDown, waitingForListener } from '../fixtures/playout.status.js';

const API = 'https://radio.example.com/api';
const station: Station = { origin: 'https://radio.example.com', apiBase: API, apiKey: 'da_key' };

describe('viewFor', () => {
    it('shows a record: its cover, its title and who it is by, and the bar', () => {
        expect(viewFor({ status: airing(), stale: false }, 0, API)).toEqual({
            title: 'Pale Blue…\nThe Velvet…',
            face: { tone: 'live', stale: false, shade: true, step: Math.floor((141_000 / 341_000) * PROGRESS_STEPS) },
            coverUrl: `${API}/${record.artworkUrl}`,
        });
    });

    it('shows the station’s own words when nothing is on air', () => {
        expect(viewFor({ status: waitingForListener(), stale: false }, 0, API)).toEqual({
            title: 'ready',
            face: { tone: 'standby', stale: false, shade: true },
        });
        expect(viewFor({ status: stoodDown(), stale: false }, 0, API)).toEqual({
            title: 'off air',
            face: { tone: 'off', stale: false, shade: true },
        });
    });

    it('keeps the last cover through a failure and says what went wrong instead of the title', () => {
        const view = viewFor({ status: airing(), failure: 'unreachable', stale: true }, 0, API);
        expect(view.title).toBe('No station');
        expect(view.face.stale).toBe(true);
        expect(view.coverUrl).toBeDefined();
    });

    it('asks to be set up before there is a station', () => {
        expect(viewFor({ failure: 'unconfigured', stale: false }, 0, undefined)).toEqual({
            title: 'Set up',
            face: { tone: 'off', stale: false, shade: true },
        });
        expect(viewFor({ failure: 'unauthorised', stale: false }, 0, API)).toEqual({
            title: 'Key refused',
            face: { tone: 'fault', stale: false, shade: true },
        });
    });

    it('leaves out the title and its shade when the key says so, and keeps the cover and the bar', () => {
        const view = viewFor({ status: airing(), stale: false }, 0, API, { progress: true, title: false });
        expect(view.title).toBe('');
        expect(view.face.shade).toBe(false);
        expect(view.face.step).toBeDefined();
        expect(view.coverUrl).toBeDefined();
    });

    it('leaves out the bar when the key says so', () => {
        const view = viewFor({ status: airing(), stale: false }, 0, API, { progress: false, title: true });
        expect(view.face.step).toBeUndefined();
        expect(view.title).toBe('Pale Blue…\nThe Velvet…');
    });

    it('still says why it is quiet, or what failed, with the title turned off', () => {
        const hidden = { progress: false, title: false };
        expect(viewFor({ status: stoodDown(), stale: false }, 0, API, hidden).title).toBe('off air');
        expect(viewFor({ status: airing(), failure: 'unreachable', stale: true }, 0, API, hidden).title).toBe('No station');
    });

    it('draws no bar for a record the decoder cannot measure', () => {
        const status = airing();
        status.nowPlaying = { ...status.nowPlaying!, remainingMs: undefined };
        expect(viewFor({ status, stale: false }, 0, API).face.step).toBeUndefined();
    });
});

describe('NowPlayingKeys', () => {
    let answers: PlayoutStatus[];
    let poller: StatusPoller;
    let artwork: ArtworkCache;
    let fetch: Mock<typeof globalThis.fetch>;

    beforeEach(() => {
        vi.useFakeTimers();
        answers = [airing()];
        const playout: Playout = {
            getPlayoutStatus: async () => (answers.length > 1 ? answers.shift()! : answers[0]!),
            skipTheCurrentItem: async () => airing(),
            startPlayout: async () => airing(),
            stopPlayout: async () => stoodDown(),
        };
        poller = new StatusPoller();
        poller.reconfigure(playout);
        fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('cover', { headers: { 'content-type': 'image/jpeg' } }));
        artwork = new ArtworkCache({ fetch, userAgent: 'agent' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function keys(openConsole = vi.fn(async () => undefined)) {
        return new NowPlayingKeys({ poller, artwork, station: () => station, openConsole });
    }

    it('holds the poller while a key shows and lets go when the last one goes', async () => {
        const acquire = vi.spyOn(poller, 'acquire');
        const nowPlaying = keys();
        nowPlaying.appear(fakeKey('one'));
        nowPlaying.appear(fakeKey('two'));
        expect(acquire).toHaveBeenCalledTimes(1);

        nowPlaying.disappear('one');
        nowPlaying.disappear('two');
        const status = vi.spyOn(poller, 'current', 'get');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(status).not.toHaveBeenCalled();
    });

    it('draws the cover once it arrives, fetched once', async () => {
        const key = fakeKey('one');
        keys().appear(key);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetch).toHaveBeenCalledTimes(1);
        const images = key.calls.filter(call => call.startsWith('image '));
        expect(decodeURIComponent(images.at(-1)!)).toContain(`xlink:href="data:image/jpeg;base64,${Buffer.from('cover').toString('base64')}"`);
        expect(key.calls).toContain('title Pale Blue…\nThe Velvet…');
    });

    it('sends no image for ticks that do not move the bar a step', async () => {
        // A step of a 341-second record is about 9.5 seconds. 198.8 seconds left is just past the
        // start of one, so the next nine seconds of ticks move nothing.
        answers = [airing({ nowPlaying: { item: record, startedAt: 1_000, remainingMs: 198_800 } })];
        const key = fakeKey('one');
        keys().appear(key);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);
        const images = () => key.calls.filter(call => call.startsWith('image ')).length;
        const before = images();

        await vi.advanceTimersByTimeAsync(8_000);
        expect(images()).toBe(before);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(images()).toBe(before + 1);
    });

    it('moves the bar as the record plays, between readings', async () => {
        const key = fakeKey('one');
        keys().appear(key);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);
        const before = key.calls.filter(call => call.startsWith('image ')).length;
        // Readings that keep saying 200 seconds left re-anchor the clock every two seconds, so the
        // move has to come from the station's own countdown dropping.
        answers = [airing({ nowPlaying: { item: record, startedAt: 1_000, remainingMs: 180_000 } })];
        await vi.advanceTimersByTimeAsync(2_000);
        expect(key.calls.filter(call => call.startsWith('image ')).length).toBeGreaterThan(before);
    });

    it('draws each key by its own settings, and redraws one when its settings change', async () => {
        const plain = fakeKey('plain');
        const bare = fakeKey('bare');
        const nowPlaying = keys();
        nowPlaying.show(plain, {});
        nowPlaying.show(bare, { showProgress: false, showTitle: false });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);

        const lastImage = (key: ReturnType<typeof fakeKey>) => decodeURIComponent(key.calls.filter(call => call.startsWith('image ')).at(-1)!);
        expect(lastImage(plain)).toContain('height="8"');
        expect(lastImage(plain)).toContain('url(#shade)');
        expect(lastImage(bare)).not.toContain('height="8"');
        expect(lastImage(bare)).not.toContain('url(#shade)');
        expect(plain.calls).toContain('title Pale Blue…\nThe Velvet…');
        expect(bare.calls).not.toContain('title Pale Blue…\nThe Velvet…');

        nowPlaying.configure('bare', { showTitle: true });
        expect(bare.calls.at(-1)).toBe('title Pale Blue…\nThe Velvet…');
        expect(lastImage(bare)).toContain('height="8"');
    });

    it('draws the station’s mark while there is no cover yet', async () => {
        const key = fakeKey('one');
        new NowPlayingKeys({ poller, artwork, station: () => station, openConsole: vi.fn(), mark: 'data:image/png;base64,MARK' }).appear(key);
        const first = decodeURIComponent(key.calls.find(call => call.startsWith('image '))!);
        expect(first).toContain('xlink:href="data:image/png;base64,MARK"');
    });

    it('opens the console at the station’s address when pressed', async () => {
        const openConsole = vi.fn(async () => undefined);
        const nowPlaying = keys(openConsole);
        nowPlaying.appear(fakeKey('one'));
        await nowPlaying.press('one');
        expect(openConsole).toHaveBeenCalledWith('https://radio.example.com');
    });

    it('refuses a press with no station to open', async () => {
        const key = fakeKey('one');
        const openConsole = vi.fn(async () => undefined);
        const nowPlaying = new NowPlayingKeys({ poller, artwork, station: () => undefined, openConsole });
        nowPlaying.appear(key);
        await nowPlaying.press('one');
        expect(openConsole).not.toHaveBeenCalled();
        expect(key.calls).toContain('alert');
    });
});
