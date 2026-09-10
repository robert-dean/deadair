import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AudienceWatch } from '#modules/playout/audience.watch.js';
import { Rundown } from '#modules/playout/rundown.js';
import { HLS_PLAYLIST_PATH, STREAM_DEFAULTS, STREAM_KEYS, resolveMountSettings, streamMounts } from '#modules/stream/stream.settings.js';
import type { NowPlaying, NowPlayingMount } from './types/nowplaying.types.js';

/**
 * What the station is playing, for anything that is not the console.
 *
 * The mount itself carries the track in its ICY metadata (see
 * `itemAnnotations`), which is what a player reads off the stream. This is the
 * same answer for everything that cannot read ICY: a station page, a hi-fi
 * streamer, a widget, a TuneIn-style entry. A poll rather than a push, because
 * that is what those consumers do and it costs the station nothing to be asked.
 *
 * Deliberately narrower than `/playout/status`, which it otherwise resembles.
 * That one is the operator's transport — the running order, the queue depth,
 * whether the stream is reachable — and it is gated. This says what is on air
 * and stops, because it is public and everything it reports is already audible
 * to anyone listening.
 *
 * **Answers out of memory, with no database work at all.** The rundown holds
 * what is airing, and `AppConfig` is a live view over `deadair.settings`
 * needing no scope, so the station's name is read straight off it on every
 * call rather than fetched through a repository. That is what lets this route
 * be transaction-exempt and lets a device poll it every few seconds without
 * spending a pooled connection on each ask, while a rename still reaches the
 * very next poll.
 */
@Injectable()
export class NowPlayingService {
    constructor(
        private readonly rundown: Rundown,
        private readonly audience: AudienceWatch,
        private readonly config: AppConfig,
    ) {}

    /** What the station calls itself, as the setting currently stands. Read per call, like `getNowPlaying`'s other facts. */
    private stationName(): string {
        return this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
    }

    /**
     * Every way to listen, MP3 first.
     *
     * Through `streamMounts` rather than assembled here, because it is the single source
     * of truth for which mounts exist and the config renderer, the audience gate and the
     * console all read it: a client offered a mount the renderer never wrote is worse
     * than a client offered none. `resolveMountSettings` rather than the full resolver
     * because that one decrypts secrets and takes a SCOPED `EncryptionProvider`, which
     * this service deliberately does not hold.
     *
     * HLS is appended rather than coming out of `streamMounts`, and that is not an
     * oversight: it is not an Icecast mount. Nothing publishes it as one, the audience
     * gate counts its listeners a different way, and its path is its own constant,
     * {@link HLS_PLAYLIST_PATH}, rather than one of `MOUNT_PATHS`. Its bitrate is left
     * absent because the figure a listener would get is the AAC variant's, and reporting
     * the AAC setting here would state a rate for an output whose own setting is not it.
     */
    private mounts(): NowPlayingMount[] {
        const settings = resolveMountSettings(this.config);
        const mounts: NowPlayingMount[] = streamMounts(settings).map(mount => ({
            format: mount.format,
            path: mount.path,
            ...(mount.bitrateKbps === undefined ? {} : { bitrateKbps: mount.bitrateKbps }),
        }));

        if (settings.hlsEnabled) mounts.push({ format: 'hls', path: HLS_PLAYLIST_PATH });

        return mounts;
    }

    /**
     * Answers even when nothing is airing, with `onAir: false` and no track. A
     * 404 for a quiet station would make an ordinary state look like a fault, and
     * a poller would have to special-case it to tell "off air" from "this URL is
     * wrong".
     */
    getNowPlaying(): NowPlaying {
        // What the PLAYER says, not what was last handed over: an item is pushed and
        // downloaded an item ahead of air, so the hand-over names the wrong track for
        // most of a track's length.
        const nowPlaying = this.rundown.nowPlaying();
        // Reported whether or not anything is airing: a station page showing "nobody is
        // listening" while it is quiet is the honest pair, and in an audience-gated
        // station the two facts explain each other.
        const listeners = this.audience.listenerCount();
        // On both answers, because a client picking how to listen has to be able to ask that
        // of a station that is currently quiet — which, under `audience` air mode, is every
        // station nobody has tuned into yet.
        const mounts = this.mounts();
        if (!nowPlaying) return { station: this.stationName(), onAir: false, listeners, mounts };

        const { item, startedAt, remainingMs } = nowPlaying;
        return {
            station: this.stationName(),
            onAir: true,
            listeners,
            mounts,
            track: {
                title: item.title,
                // A display line, not a list. Everything downstream renders it as text,
                // and a device that wants one string should not have to join ours.
                artist: item.artists.join(', '),
                ...(item.album === undefined ? {} : { album: item.album }),
                ...(item.artworkUrl === undefined ? {} : { artworkUrl: item.artworkUrl }),
                ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
                startedAt,
                ...(remainingMs === undefined ? {} : { remainingMs }),
            },
        };
    }
}
