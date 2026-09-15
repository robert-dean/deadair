// The one public route in the app, and the only thing most listeners will ever
// call. So what is tested here is mostly what it must NOT do: no 404 for a quiet
// station, no leaking of the running order it sits next to, and no reporting of
// an item that was merely handed to the player.

import { describe, expect, it, vi } from 'vitest';

import { NowPlayingService } from '../../../src/modules/nowplaying/nowplaying.service.js';
import type { Rundown, RundownBroadcast, NowPlaying as RundownNowPlaying } from '../../../src/modules/playout/rundown.js';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import { TEMPLATE_KEYS } from '../../../src/modules/director/break.templates.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

/** The station's audience, as this route reports it. Zero unless a test says otherwise. */
const audienceOf = (listeners = 0) => ({ listenerCount: () => listeners }) as unknown as AudienceWatch;

/**
 * The MP3 mount every station publishes, which is the floor of `mounts` and has no switch.
 * Named because most of these tests are about something else and would otherwise repeat it.
 */
const MP3_MOUNT = { format: 'mp3', path: '/live.mp3', bitrateKbps: 128 };

const item = {
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'trk_1',
    title: 'Windowlicker',
    artists: ['Aphex Twin', 'Someone Else'],
    artist: 'Aphex Twin',
    durationMs: 366_000,
    album: 'Windowlicker',
    artworkUrl: 'art/asset-1',
    year: 1999,
    trackId: 'cat-1',
};

/** A break the station speaks on its own, as `segmentRundownTrack` puts it into the running order. */
const spoken = {
    id: 'item-3',
    pluginId: 'deadair.render',
    externalId: 'seg-1',
    title: 'Top of the hour',
    artists: [],
    artist: '',
    durationMs: 12_000,
};

const build = (
    nowPlaying?: RundownNowPlaying,
    stationName = 'Static Between Stations',
    listeners = 0,
    settings: Record<string, string> = {},
    broadcast?: RundownBroadcast,
) => {
    const rundown = { nowPlaying: vi.fn(() => nowPlaying), broadcast: vi.fn(() => broadcast) } as unknown as Rundown;
    // A real `AppConfig` over a plain object, because this service reads SETTINGS and every
    // layer of the config holds strings. A double that answered a boolean for `stream.opusEnabled`
    // would pass whichever way the code read it, which is the failure this repository has already
    // had once.
    const config = settingsConfig({ [STREAM_KEYS.title]: stationName, ...settings });
    const service = new NowPlayingService(rundown, audienceOf(listeners), config.config);
    return { service, rundown, config };
};

describe('NowPlayingService', () => {
    it('names what is on air, with the art and album the catalog filled in', () => {
        const { service } = build({ item, startedAt: 1_700_000_000_000, remainingMs: 120_000 }, 'Static Between Stations', 12);

        expect(service.getNowPlaying()).toEqual({
            station: 'Static Between Stations',
            onAir: true,
            listeners: 12,
            mounts: [MP3_MOUNT],
            track: {
                kind: 'record',
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
        expect(service.getNowPlaying()).toEqual({ station: 'Static Between Stations', onAir: false, listeners: 0, mounts: [MP3_MOUNT] });
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

        expect(Object.keys(service.getNowPlaying())).toEqual(['station', 'onAir', 'listeners', 'mounts', 'track']);

        // And with a programme named, the programme and nothing else of the order: not its brief,
        // not its source, not what comes next.
        const { service: named } = build({ item, startedAt: 1 }, 'Station', 0, {}, { name: 'Afternoons', host: 'Ray' });
        expect(Object.keys(named.getNowPlaying())).toEqual(['station', 'onAir', 'listeners', 'mounts', 'show', 'track']);
        expect(Object.keys(named.getNowPlaying().show ?? {})).toEqual(['name', 'host']);
    });

    it('omits what nobody could tell it, rather than sending empty fields', () => {
        const bare = { id: 'item-2', pluginId: 'p', externalId: 'e', title: 'Untitled', artists: [], artist: '' };
        const { service } = build({ item: bare, startedAt: 42 });

        expect(service.getNowPlaying().track).toEqual({ kind: 'record', title: 'Untitled', artist: '', startedAt: 42 });
    });

    describe('the programme and who is talking', () => {
        // A listener app leads with the show and its host, and says so when the host is the one on
        // air. Everything here is pushed by the director or read off settings: nothing touches the
        // database, which is what keeps this route transaction-exempt.

        it('names the show and who is presenting it', () => {
            const { service } = build({ item, startedAt: 1 }, 'Station', 0, {}, { name: 'Afternoons', host: 'Ray' });

            expect(service.getNowPlaying().show).toEqual({ name: 'Afternoons', host: 'Ray' });
        });

        it('calls a break the station speaks on its own a break, under its own label', () => {
            const { service } = build({ item: spoken, startedAt: 42 }, 'Station', 0, {}, { name: 'Afternoons', host: 'Ray' });

            expect(service.getNowPlaying().track).toEqual({ kind: 'break', title: 'Top of the hour', artist: '', durationMs: 12_000, startedAt: 42 });
        });

        it("names somebody else's programme as a record is named, not as the station talking", () => {
            const carried = { ...spoken, title: 'Episode 12', artists: ['The Long Wave'], programme: true };
            const { service } = build({ item: carried, startedAt: 42 });

            expect(service.getNowPlaying().track).toMatchObject({ kind: 'record', title: 'Episode 12', artist: 'The Long Wave' });
        });

        it('leaves a record a record while the presenter talks over its start', () => {
            // The voice rides the record, and the record is what the listener hears for all but a
            // few seconds of it. There is no end time for the talking, so nothing could say when to
            // stop calling it a break.
            const { service } = build({ item: { ...item, voice: { segmentId: 'seg-2', atMs: 0 } }, startedAt: 1 });

            expect(service.getNowPlaying().track?.kind).toBe('record');
        });

        it("falls back to the station's presenter name when the host has none of their own", () => {
            const { service } = build({ item, startedAt: 1 }, 'Station', 0, { [TEMPLATE_KEYS.djName]: 'Ray' }, { name: 'Afternoons' });

            expect(service.getNowPlaying().show).toEqual({ name: 'Afternoons', host: 'Ray' });
        });

        it("says nothing about a host when the station's presenter name is blank", () => {
            // A STRING of spaces, which is what an operator who cleared the field may leave behind.
            const { service } = build({ item, startedAt: 1 }, 'Station', 0, { [TEMPLATE_KEYS.djName]: '   ' }, { name: 'Afternoons' });

            expect(service.getNowPlaying().show).toEqual({ name: 'Afternoons' });
        });

        it("prefers the host's own on-air name to the station's", () => {
            const { service } = build(
                { item, startedAt: 1 },
                'Station',
                0,
                { [TEMPLATE_KEYS.djName]: 'Ray' },
                { name: 'Afternoons', host: 'Cap Ray' },
            );

            expect(service.getNowPlaying().show?.host).toBe('Cap Ray');
        });

        it('names no show while the station is off air, whatever it was last told', () => {
            const { service } = build(undefined, 'Station', 0, {}, { name: 'Afternoons', host: 'Ray' });

            expect(service.getNowPlaying()).not.toHaveProperty('show');
        });

        it('names no show the director has not described', () => {
            const { service } = build({ item, startedAt: 1 });

            expect(service.getNowPlaying()).not.toHaveProperty('show');
        });

        it("answers the station's presenter name as it stands now", () => {
            const { service, config } = build({ item, startedAt: 1 }, 'Station', 0, { [TEMPLATE_KEYS.djName]: 'Ray' }, { name: 'Afternoons' });

            expect(service.getNowPlaying().show?.host).toBe('Ray');

            config.set(TEMPLATE_KEYS.djName, 'Raymond');

            expect(service.getNowPlaying().show?.host).toBe('Raymond');
        });
    });

    it('answers the name as it stands now, not as it stood at boot', () => {
        // The name is read off `AppConfig` on every call rather than cached, so a
        // rename between two polls has to reach the very next one.
        const { service, config } = build(undefined, 'Static Between Stations');

        expect(service.getNowPlaying().station).toBe('Static Between Stations');

        config.set(STREAM_KEYS.title, 'New Call Letters');

        expect(service.getNowPlaying().station).toBe('New Call Letters');
    });

    describe('the mounts it offers', () => {
        // A listener client picks how to listen from this list. It exists so that nothing has
        // to find out by CONNECTING to each mount in turn: under `playout.airMode: audience` a
        // connection is an audience, so probing five mounts would put a quiet station on air
        // and hold it there for the linger.

        it('offers the MP3 mount on a station nobody has configured', () => {
            // MP3 has no switch, so the list is never empty and never needs to be checked for it.
            const { service } = build(undefined);

            expect(service.getNowPlaying().mounts).toEqual([MP3_MOUNT]);
        });

        it('offers a format the operator switched on, with the bitrate they chose', () => {
            const { service } = build(undefined, 'Station', 0, {
                [STREAM_KEYS.opusEnabled]: 'true',
                [STREAM_KEYS.opusBitrate]: '256',
                [STREAM_KEYS.aacEnabled]: 'true',
                [STREAM_KEYS.flacEnabled]: 'true',
            });

            expect(service.getNowPlaying().mounts).toEqual([
                MP3_MOUNT,
                { format: 'opus', path: '/live.opus', bitrateKbps: 256 },
                { format: 'aac', path: '/live.aac', bitrateKbps: 192 },
                // No rate on FLAC: it is lossless, so there is none to report.
                { format: 'flac', path: '/live.flac' },
            ]);
        });

        it('leaves out a format switched off with the STRING false', () => {
            // The whole of the settings rule in one assertion. `config.get(key, false)` answers
            // `'false'`, which is truthy, so a switch read that way could be turned on and never
            // back off — and a test handing over a real boolean would pass either way.
            const { service } = build(undefined, 'Station', 0, {
                [STREAM_KEYS.opusEnabled]: 'false',
                [STREAM_KEYS.aacEnabled]: 'off',
                [STREAM_KEYS.flacEnabled]: '0',
                [STREAM_KEYS.hlsEnabled]: 'no',
            });

            expect(service.getNowPlaying().mounts).toEqual([MP3_MOUNT]);
        });

        it('ignores a `stream.mount` row left from when the mount was a setting', () => {
            // Nothing renders a renamed mount any more, so a client told about one would tune
            // to a path Icecast does not serve.
            const { service } = build(undefined, 'Station', 0, {
                'stream.mount': '/wireless.mp3',
                [STREAM_KEYS.opusEnabled]: 'true',
            });

            expect(service.getNowPlaying().mounts).toEqual([
                { format: 'mp3', path: '/live.mp3', bitrateKbps: 128 },
                { format: 'opus', path: '/live.opus', bitrateKbps: 160 },
            ]);
        });

        it('offers HLS at its own fixed path', () => {
            const { service } = build(undefined, 'Station', 0, {
                [STREAM_KEYS.hlsEnabled]: 'true',
            });

            expect(service.getNowPlaying().mounts).toEqual([
                { format: 'mp3', path: '/live.mp3', bitrateKbps: 128 },
                // No bitrate: what a listener gets is the AAC variant's rate, and reporting the
                // AAC setting here would state a figure for an output whose setting is not it.
                { format: 'hls', path: '/live.m3u8' },
            ]);
        });

        it('answers the mounts as they stand now, not as they stood at boot', () => {
            // Same rule as the station name: an operator switching a format on between two polls
            // has to reach the very next one, so nothing here may be cached at construction.
            const { service, config } = build(undefined);

            expect(service.getNowPlaying().mounts).toEqual([MP3_MOUNT]);

            config.set(STREAM_KEYS.flacEnabled, 'true');

            expect(service.getNowPlaying().mounts).toEqual([MP3_MOUNT, { format: 'flac', path: '/live.flac' }]);
        });
    });
});
