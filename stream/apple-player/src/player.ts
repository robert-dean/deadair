import type { CdpClient } from './cdp.ts';

/**
 * Driving the web player's own MusicKit instance, and knowing when a record has finished.
 *
 * `music.apple.com` IS a MusicKit JS application, so the supported API is already on the page with a
 * developer token this container does not have to hold and an authorization the operator did in a
 * browser. Tapping `MusicKit.getInstance()` is what every desktop Apple Music client does.
 *
 * **This file is the part of the container that cannot be proven without a subscription.** Everything
 * else — Chrome, the CDM, the sink, ffmpeg, the token, the queue — is verifiable by `/health` and
 * `/selftest` on any machine. The shape below is written against MusicKit v3's documented surface,
 * and the README says plainly which lines are unexercised.
 */

/** What `GET /track/{id}` needs to know, and nothing else. */
export interface PlayedRecord {
    /** What the player says it played, for the log and for the caller's sanity check. */
    readonly title: string;
    readonly durationMs: number;
    readonly playedMs: number;
}

export class PlaybackRefused extends Error {
    /**
     * Whether this is "Apple will not play this record here", which is a copy the station should
     * write off, as opposed to a fault that may work next time.
     *
     * The distinction is the whole reason this class exists: `TrackAudioService` turns a 410 into
     * `UnplayableCopy` and stops asking, and turns anything else into a retry with backoff. Getting
     * it the wrong way round means either a dead binding retried forever or a live one benched by a
     * blip.
     *
     * Declared and assigned rather than taken as a parameter property, for cdp.ts's reason: Node
     * strips the types in this file and cannot transform one.
     */
    readonly unplayable: boolean;

    constructor(message: string, unplayable: boolean) {
        super(message);
        this.unplayable = unplayable;
    }
}

/**
 * Installed in the page once and read by polling.
 *
 * A recorder rather than a CDP event subscription, deliberately: a missed `Runtime.bindingCalled`
 * during a reconnect would leave a capture running until its ceiling, where a missed poll simply
 * happens again 250ms later. It also means the page keeps the authoritative view of its own state
 * and this process only ever reads it.
 */
export const RECORDER = `(() => {
    if (window.__deadairPlayer) return { installed: false, reason: 'already installed' };
    const mk = window.MusicKit && window.MusicKit.getInstance ? window.MusicKit.getInstance() : undefined;
    if (!mk) return { installed: false, reason: 'no MusicKit instance on this page' };

    const state = { events: [], lastState: undefined, error: undefined };
    const name = code => {
        const states = window.MusicKit.PlaybackStates || {};
        for (const key of Object.keys(states)) if (states[key] === code) return key;
        return String(code);
    };

    mk.addEventListener('playbackStateDidChange', event => {
        const label = typeof event.state === 'number' ? name(event.state) : String(event.state);
        state.lastState = label;
        state.events.push({ at: Date.now(), state: label });
        if (state.events.length > 200) state.events.shift();
    });
    mk.addEventListener('mediaPlaybackError', event => {
        state.error = String((event && (event.message || event.name)) || 'playback error');
    });

    window.__deadairPlayer = {
        state,
        mk,
        reset() {
            state.events.length = 0;
            state.lastState = undefined;
            state.error = undefined;
        },
        read() {
            return {
                lastState: state.lastState,
                error: state.error,
                isPlaying: !!mk.isPlaying,
                time: mk.currentPlaybackTime || 0,
                duration: mk.currentPlaybackDuration || 0,
                title: (mk.nowPlayingItem && mk.nowPlayingItem.title) || '',
                authorized: !!mk.isAuthorized,
                states: state.events.map(e => e.state),
            };
        },
    };
    return { installed: true };
})()`;

export interface PlayerReading {
    lastState?: string;
    error?: string;
    isPlaying: boolean;
    time: number;
    duration: number;
    title: string;
    authorized: boolean;
    states: string[];
}

export interface PlayerHandle {
    /** Put the recorder on the page, or say why it could not go there. */
    install(): Promise<{ installed: boolean; reason?: string }>;
    /**
     * Install the recorder if the page has not got one, and say whether it now has.
     *
     * Every path that touches the player goes through this, and it is not a convenience. The page is
     * a single-page application: at boot it answers "no MusicKit instance on this page" for a second
     * or two while its own bundle loads, and later it can navigate out from under a recorder that was
     * installed successfully. Measured on the live web player — an install fired 14ms after Chrome
     * came up failed, and the same call a moment later found MusicKit 3.2636.0 exactly where it was
     * expected. Installing once at boot therefore produces a container that is permanently unable to
     * play anything for a reason that has already gone away.
     */
    ensure(): Promise<{ installed: boolean; reason?: string }>;
    read(): Promise<PlayerReading>;
    /** Whether the operator's Apple Music session is live in this browser. */
    authorized(): Promise<boolean>;
    /** Queue one catalog song and start it. Resolves when the player says it is playing. */
    start(catalogId: string, timeoutMs: number): Promise<void>;
    stop(): Promise<void>;
}

export function playerOn(client: CdpClient, session: string): PlayerHandle {
    const evaluate = async <T>(expression: string): Promise<T> => client.evaluate<T>(session, expression);

    const read = async (): Promise<PlayerReading> => {
        const reading = await evaluate<PlayerReading | undefined>('window.__deadairPlayer && window.__deadairPlayer.read()');
        if (reading === undefined) throw new PlaybackRefused('the recorder is not installed on the player page', false);
        return reading;
    };

    const install = (): Promise<{ installed: boolean; reason?: string }> => evaluate<{ installed: boolean; reason?: string }>(RECORDER);

    const ensure = async (): Promise<{ installed: boolean; reason?: string }> => {
        const present = await evaluate<boolean>('!!window.__deadairPlayer');
        if (present) return { installed: true };
        const result = await install();
        // `install` answers `already installed` when the recorder is there, which only happens if it
        // appeared between the two calls. Either way the page now has one, so both read as installed.
        return result.installed || result.reason === 'already installed' ? { installed: true } : result;
    };

    return {
        install,
        ensure,
        read,
        authorized: async () => {
            const authorized = await evaluate<boolean>(
                '!!(window.MusicKit && window.MusicKit.getInstance && window.MusicKit.getInstance().isAuthorized)',
            );
            return authorized;
        },
        async start(catalogId, timeoutMs) {
            // Before anything else, because the page may have navigated since the last record and a
            // missing recorder is recoverable in one round trip.
            const ready = await ensure();
            if (!ready.installed) throw new PlaybackRefused(`the player page has no MusicKit instance: ${ready.reason ?? 'unknown'}`, false);

            await evaluate(`window.__deadairPlayer.reset()`);
            // `setQueue` with `startPlaying` is one round trip and one state machine rather than a
            // queue call followed by a play that can race it.
            //
            // Its throw is classified rather than allowed to propagate, and the reason is measured: a
            // record MusicKit cannot resolve answers `MKError: [mk-007] NOT_FOUND; One or more items
            // could not be resolved`, which is a copy that will never play here. Left as a bare
            // evaluate failure it reached the server as a 502 and the station would have retried a
            // dead binding until four failures benched it, instead of writing it off at once.
            try {
                await evaluate(`window.__deadairPlayer.mk.setQueue({ song: ${JSON.stringify(catalogId)}, startPlaying: true })`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new PlaybackRefused(message, isUnplayable(message));
            }

            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const reading = await read();
                if (reading.error !== undefined) throw new PlaybackRefused(reading.error, isUnplayable(reading.error));
                if (reading.isPlaying && reading.time > 0) return;
                await pause(200);
            }
            throw new PlaybackRefused(`the player did not start inside ${timeoutMs}ms`, false);
        },
        stop: async () => {
            await evaluate('window.__deadairPlayer && window.__deadairPlayer.mk.stop()').catch(() => undefined);
        },
    };
}

/**
 * Which refusals mean this copy will never play here.
 *
 * Kept as a small list of substrings rather than a clever matcher, and erring towards "retry": a
 * record wrongly benched is invisible until somebody wonders why it never airs, where a record
 * wrongly retried costs four fetches and then benches itself anyway.
 */
const UNPLAYABLE_SIGNS = [
    'content_restricted',
    'content restricted',
    'not available',
    'unavailable',
    'not_found',
    'restricted_region',
    // MusicKit's own words for "there is no such record in this storefront", observed live:
    // `MKError: [mk-007] NOT_FOUND; One or more items could not be resolved: <id>`.
    'could not be resolved',
];

export function isUnplayable(reason: string): boolean {
    const lowered = reason.toLowerCase();
    return UNPLAYABLE_SIGNS.some(sign => lowered.includes(sign));
}

/**
 * Watch a record to its end, and decide which end it was.
 *
 * Three ways it can finish and all three are needed. The player saying `completed` is the ordinary
 * one. Position reaching duration is the backstop for a state we never see, which costs nothing to
 * check and saves a whole capture. And a position that stops advancing while the player claims to be
 * playing is a stall, which has to be a failure rather than a wait: the alternative is a capture that
 * runs to its ceiling and hands the station a record with silence welded onto the end of it.
 */
export async function playToEnd(
    player: PlayerHandle,
    options: { slackMs: number; stallMs: number; poll?: (ms: number) => Promise<void> },
): Promise<PlayedRecord> {
    const wait = options.poll ?? pause;
    const started = Date.now();
    let ceiling = started + options.slackMs;
    let title = '';
    let durationMs = 0;
    let furthest = 0;
    let furthestAt = Date.now();

    while (Date.now() < ceiling) {
        const reading = await player.read();
        if (reading.error !== undefined) throw new PlaybackRefused(reading.error, isUnplayable(reading.error));

        if (reading.title !== '') title = reading.title;
        if (reading.duration > 0) {
            durationMs = Math.round(reading.duration * 1000);
            // The ceiling is only knowable once the player has told us how long the record is, which
            // is why it is recomputed rather than set once from a guess.
            ceiling = started + durationMs + options.slackMs;
        }

        const playedMs = Math.round(reading.time * 1000);
        if (playedMs > furthest) {
            furthest = playedMs;
            furthestAt = Date.now();
        }

        const completed = reading.lastState === 'completed' || reading.lastState === 'ended';
        const ranOut = durationMs > 0 && playedMs >= durationMs - 250;
        if (completed || ranOut) return { title, durationMs, playedMs: Math.max(furthest, playedMs) };

        if (Date.now() - furthestAt > options.stallMs) {
            throw new PlaybackRefused(`playback stalled at ${furthest}ms after ${options.stallMs}ms without progress`, false);
        }

        await wait(250);
    }

    throw new PlaybackRefused(`the record did not finish inside its duration plus ${options.slackMs}ms`, false);
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
