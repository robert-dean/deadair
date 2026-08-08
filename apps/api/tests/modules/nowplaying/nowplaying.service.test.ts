// The one public route in the app, and the only thing most listeners will ever
// call. So what is tested here is mostly what it must NOT do: no 404 for a quiet
// station, no leaking of the running order it sits next to, and no reporting of
// an item that was merely handed to the player.

import { describe, expect, it, vi } from 'vitest';

import { NowPlayingService } from '../../../src/modules/nowplaying/nowplaying.service.js';
import type { Rundown, NowPlaying as RundownNowPlaying } from '../../../src/modules/playout/rundown.js';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';

/** The station's audience, as this route reports it. Zero unless a test says otherwise. */
const audienceOf = (listeners = 0) => ({ listenerCount: () => listeners }) as unknown as AudienceWatch;

const item = {
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'trk_1',
    title: 'Windowlicker',
    artists: ['Aphex Twin', 'Someone Else'],
    durationMs: 366_000,
    album: 'Windowlicker',
    artworkUrl: 'art/asset-1',
    year: 1999,
    trackId: 'cat-1',
};

const build = (nowPlaying?: RundownNowPlaying, stationName = 'Static Between Stations', listeners = 0) => {
    const rundown = { nowPlaying: vi.fn(() => nowPlaying) } as unknown as Rundown;
    const service = new NowPlayingService(rundown, audienceOf(listeners));
    service.useStationName(stationName);
    return { service, rundown };
};

describe('NowPlayingService', () => {
    it('names what is on air, with the art and album the catalog filled in', () => {
        const { service } = build({ item, startedAt: 1_700_000_000_000, remainingMs: 120_000 }, 'Static Between Stations', 12);

        expect(service.getNowPlaying()).toEqual({
            station: 'Static Between Stations',
            onAir: true,
            listeners: 12,
            track: {
                title: 'Windowlicker',
                artist: 'Aphex Twin, Someone Else',
                album: 'Windowlicker',
                artworkUrl: 'art/asset-1',
                durationMs: 366_000,
                startedAt: 1_700_000_000_000,
                remainingMs: 120_000,
            },
        });
    });

    it('answers a quiet station rather than failing at it', () => {
        // A 404 would make an ordinary state look like a fault, and a poller would
        // have to special-case it to tell "off air" from "this URL is wrong".
        const { service } = build(undefined);

        // The count comes back with it: "nobody is listening" is why a quiet station
        // is quiet, once the audience is what holds the mount.
        expect(service.getNowPlaying()).toEqual({ station: 'Static Between Stations', onAir: false, listeners: 0 });
    });

    it('reports what the player says, not what was last handed over', () => {
        // The rundown's own distinction, and the reason this asks it rather than
        // reading the queue: an item is pushed and downloaded an item ahead of air.
        const { service, rundown } = build({ item, startedAt: 1 });

        service.getNowPlaying();

        expect(rundown.nowPlaying).toHaveBeenCalled();
    });

    it('says nothing about the running order behind it', () => {
        // This is public. `/playout/status` is the surface that reports the queue,
        // and it is gated; everything reported here is already audible on the mount.
        const { service } = build({ item, startedAt: 1 });

        expect(Object.keys(service.getNowPlaying())).toEqual(['station', 'onAir', 'listeners', 'track']);
    });

    it('omits what nobody could tell it, rather than sending empty fields', () => {
        const bare = { id: 'item-2', pluginId: 'p', externalId: 'e', title: 'Untitled', artists: [] };
        const { service } = build({ item: bare, startedAt: 42 });

        expect(service.getNowPlaying().track).toEqual({ title: 'Untitled', artist: '', startedAt: 42 });
    });

    it('is answerable before the station has been named', () => {
        // `ready` pushes the name in after the socket is up, so a poll that arrives
        // in between must still answer rather than throwing on an unset field.
        const rundown = { nowPlaying: vi.fn(() => undefined) } as unknown as Rundown;

        expect(new NowPlayingService(rundown, audienceOf()).getNowPlaying()).toEqual({ station: '', onAir: false, listeners: 0 });
    });
});
