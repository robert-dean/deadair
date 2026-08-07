import { Injectable } from 'injectkit';
import { Rundown } from '#modules/playout/rundown.js';
import type { NowPlaying } from './types/nowplaying.types.js';

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
 * what is airing, and the station's name is pushed in once at boot rather than
 * read per request. That is what lets this route be transaction-exempt and lets
 * a device poll it every few seconds without spending a pooled connection on
 * each ask. The cost is that renaming the station reaches this on the next
 * restart — the same terms Icecast itself is on, since it too reads its config
 * once at startup.
 */
@Injectable()
export class NowPlayingService {
    /** Empty until the module's `ready` has read the stream settings. */
    private stationName = '';

    constructor(private readonly rundown: Rundown) {}

    /** Publish the station's on-air name. Called once, from the module's `ready`. */
    useStationName(name: string): void {
        this.stationName = name;
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
        if (!nowPlaying) return { station: this.stationName, onAir: false };

        const { item, startedAt, remainingMs } = nowPlaying;
        return {
            station: this.stationName,
            onAir: true,
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
