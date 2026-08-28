import { readFile } from 'node:fs/promises';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { CONTROL_TTL_S, PLAYOUT_LEAD } from '#modules/playout/liquidsoap.control.js';
import { playoutAiredUrl, playoutStarveUrl, resolvePlayoutBaseUrl } from '#modules/playout/playout.urls.js';
import {
    defaultStreamAssetsDir,
    defaultStreamConfigDir,
    defaultStreamHlsDir,
    parseFileMode,
    writeStreamConfig,
    type StreamPlayoutConfig,
} from './stream.config.js';
import { ensureStreamSecrets, resolveStreamSettings, type StreamSettings } from './stream.settings.js';
import { hlsPlaylistPath } from './hls.playlist.js';
import { SpotifyShimClient, type FetcherResult } from './spotify.shim.client.js';
import { StreamConfigWatch } from './stream.staleness.js';
import type {
    FetcherAuthorization,
    FetcherAuthorizationFinished,
    FetcherAuthorizationInput,
    FetcherAuthorizationStart,
} from './types/stream.types.js';

/**
 * How a break sounds: whether the DJ talks over the music or between tracks, how
 * far the bed drops under it, how long that ramp takes, and the trim on the
 * voice itself.
 *
 * Constants rather than settings, still: these are the values an operator tunes
 * by ear, and the seam that would hold them (`STREAM_KEYS` in
 * `stream.settings.ts`) is the one every other stream value already goes
 * through. They stay here because `radio.liq` reads all four at STARTUP, so
 * making them settings without also solving the restart trigger would give the
 * console a knob that silently does nothing until the container bounces. See
 * `docs/todo/mixer-settings-in-db.md`.
 *
 * They match `stream/radio.default.env` so the rendered file agrees with the
 * committed fallback.
 */
const TALK_OVER_TRACKS = true;
const DUCK_GAIN_DB = -12;
const DUCK_FADE_MS = 300;

/**
 * The operator's trim on the DJ voice, on top of the gain the app decides for
 * each segment.
 *
 * Zero, and it is the only one of these four that is zero because it has nothing
 * to correct rather than because nobody has tuned it. The level itself is
 * `liq_amplify`, stamped per segment by `playout/annotate.ts` from that
 * segment's level against `playout.targetLufs` and applied in the mic chain —
 * which is what makes this a trim again. It was briefly +10, carrying the whole
 * correction for a speech engine that measures around -26.5 LUFS against records
 * airing at -16; that number belongs in the app, where it can be a measurement
 * rather than a constant, and where it also reaches a break aired BETWEEN two
 * records, which never touches the mic chain at all.
 */
const VOICE_GAIN_DB = 0;

/** Where Liquidsoap finds the local music bed inside its own container. */
const DEFAULT_MUSIC_DIR = '/music';

/** Harbor port, which has to match the one published in docker-compose.yml. */
const DEFAULT_HARBOR_PORT = '8005';

/**
 * Owns the rendered Icecast/Liquidsoap config.
 *
 * The containers cannot read Postgres, so every change to a stream setting has
 * to be pushed out as files on the shared volume. Today that happens at boot
 * (`StreamModule.ready`); anything that grows into a second writer of the
 * `stream.*` settings has to call {@link materialize} itself. The app's config
 * store does watch the table, so a write is visible to {@link settings} on its
 * own — but nothing turns that into a render, and a render is what the
 * containers read.
 *
 * A render only reaches the containers on their next restart: both read their
 * config once, at startup.
 */
@Injectable()
export class StreamService {
    constructor(
        private readonly settingsRepository: SettingsRepository,
        private readonly encryption: EncryptionProvider,
        private readonly config: AppConfig,
        // Told what a render put on the volume, because a render is the only moment
        // the app learns what the containers OUGHT to be running. Nothing here reads
        // it back: this service writes files, and judging who has adopted them is a
        // singleton's job that outlives the request scope this one lives in.
        private readonly staleness: StreamConfigWatch,
        // The track fetcher's control surface. A singleton, injected here rather than reached for,
        // because the three authorization routes are the only place in the app where an OPERATOR
        // talks to it — everywhere else it is spoken to on the way to resolving a record.
        private readonly fetcher: SpotifyShimClient,
        private readonly logger: Logger,
    ) {}

    /** The resolved settings, secrets decrypted. */
    settings(): StreamSettings {
        return resolveStreamSettings(this.config, this.encryption);
    }

    /**
     * One HLS playlist off the volume Liquidsoap writes it to.
     *
     * The app serves these and nginx serves the segments beside them, which is not an
     * arbitrary split: a live player re-fetches the playlist every target duration to
     * learn what to play next, so this request is the heartbeat that makes an HLS
     * listener countable at all. The tick itself is recorded by the middleware in front
     * of this, which is where the request context lives; this method only has to answer
     * with the file.
     *
     * **The name is a filename, never a path.** It is refused unless it is a bare
     * `*.m3u8`, so `..` and any separator are out before `join` is reached rather than
     * being normalised away afterwards — this route is anonymous and reachable by
     * anybody who can reach the station, and it reads from a directory by name. A
     * rejected name answers 404 rather than 400, because a caller who is trying it on
     * learns nothing from being told they were caught, and a player asking for
     * something that is not there wants the same answer either way.
     */
    async getHlsPlaylist(name: string): Promise<{ body: Buffer; headers: { cacheControl?: string } }> {
        const path = hlsPlaylistPath(this.config.get('STREAM_HLS_DIR', defaultStreamHlsDir()), name);
        if (path === undefined) throw httpError(404).withDetails({ message: 'not a playlist' });

        let body: Buffer;
        try {
            body = await readFile(path);
        } catch {
            // The ordinary case on a station with HLS switched off: Liquidsoap has written
            // nothing, so there is no directory and no playlist. A player retries against
            // this harmlessly, which is why it is not worth distinguishing from a typo.
            throw httpError(404).withDetails({ message: 'no such playlist' });
        }

        // A live playlist is rewritten every segment and is worthless a moment later, so it
        // must not be held anywhere. Without this a caching proxy between the station and a
        // listener can pin a player to a window of segments that have since been deleted,
        // which stalls it permanently rather than visibly.
        return { body, headers: { cacheControl: 'no-cache, no-store, must-revalidate' } };
    }

    /**
     * What the track fetcher holds by way of a Spotify login.
     *
     * A pass-through, and deliberately: the client already answers in exactly these terms and every
     * failure it can have is a STATE rather than an error, so there is nothing here to translate. The
     * two facts worth keeping straight are that `authorized` is the fetcher's own stored credential
     * — the only kind Spotify's login accepts — and that `reachable` is what stops a fetcher which is
     * merely down being reported as one nobody has authorized.
     */
    async readAuthorization(): Promise<FetcherAuthorization> {
        return this.fetcher.authorization();
    }

    /** Start the fetcher's one-time authorization and answer with the URL the operator has to open. */
    async startAuthorization(): Promise<FetcherAuthorizationStart> {
        return this.answer(await this.fetcher.beginAuthorization());
    }

    /**
     * Finish an authorization from the address the operator's browser ended up at.
     *
     * The address goes over WHOLE. It is taken apart by the fetcher, which already owns the one
     * parser for it, so this route stays a relay rather than becoming a second reading of the same
     * thing that can disagree with the first.
     */
    async finishAuthorization(input: FetcherAuthorizationInput): Promise<FetcherAuthorizationFinished> {
        return this.answer(await this.fetcher.completeAuthorization(input.redirectUrl));
    }

    /**
     * The fetcher's own answer, or its own refusal as an HTTP error.
     *
     * The status is carried through rather than flattened, because the fetcher already drew the line
     * that matters: 400 is this attempt (nothing pending, a stale URL, a callback from somewhere
     * else) and 502 is Spotify. An operator deciding whether pressing the button again is worth
     * anything is deciding exactly between those two, so collapsing them here would throw away the
     * only part of the answer they can act on.
     */
    private answer<T>(result: FetcherResult<T>): T {
        if (result.ok) return result.value;

        this.logger.warn('stream: the track fetcher refused an authorization', { status: result.status, message: result.message });
        throw httpError(result.status).withDetails({ message: result.message });
    }

    /**
     * Seed any stream secret the operator has not set. Returns true when it
     * seeded at least one, which the caller reports: the operator needs to know
     * a running Icecast has to be restarted once to adopt them.
     */
    async ensureSecrets(): Promise<boolean> {
        return ensureStreamSecrets(this.settingsRepository, this.encryption);
    }

    /**
     * Render `icecast.xml` and `radio.env` from the current settings.
     *
     * Never throws: a stream that cannot be configured must not stop the app
     * from serving, and both containers have a committed static fallback.
     *
     * A render that changed something is also the moment the running containers
     * became stale, so the result is handed to {@link StreamConfigWatch} before
     * the boolean is returned. Neither container is restarted or signalled here,
     * and deliberately: see that class for why the app reports this rather than
     * fixing it.
     */
    /**
     * The mode to leave the rendered config with, or `undefined` to take the default.
     *
     * A value that is not a mode is REPORTED rather than taken as unset, because the whole
     * reason anybody sets this is to make a file holding passwords less readable, and
     * silently leaving it as it was would tell them they had.
     */
    private configMode(): number | undefined {
        const raw = String(this.config.get('STREAM_CONFIG_MODE', '')).trim();
        if (!raw) return undefined;

        const mode = parseFileMode(raw);
        if (mode === undefined) {
            this.logger.warn(`stream: STREAM_CONFIG_MODE is not an octal file mode (${raw}); the rendered config keeps the default permissions`);
        }
        return mode;
    }

    async materialize(): Promise<boolean> {
        try {
            const settings = await this.settings();
            const render = writeStreamConfig({
                settings,
                playout: this.playoutConfig(settings),
                assetsDir: this.config.get('STREAM_ASSETS_DIR', defaultStreamAssetsDir()),
                configDir: this.config.get('STREAM_CONFIG_DIR', defaultStreamConfigDir()),
                musicDir: this.config.get('STREAM_MUSIC_DIR', DEFAULT_MUSIC_DIR),
                harborPort: this.config.get('STREAM_HARBOR_PORT', DEFAULT_HARBOR_PORT),
                configMode: this.configMode(),
                log: message => this.logger.info(`stream: ${message}`),
            });

            this.staleness.noteRender(render);
            return render !== undefined;
        } catch (error) {
            this.logger.error(error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    }

    /**
     * The playout half of `radio.env`. The bridge secret comes from the same
     * stored setting the app authenticates incoming calls against, so the two
     * ends of the bridge cannot drift apart.
     */
    private playoutConfig(settings: StreamSettings): StreamPlayoutConfig {
        const base = resolvePlayoutBaseUrl(this.config);

        return {
            playoutAiredUrl: playoutAiredUrl(base),
            playoutStarveUrl: playoutStarveUrl(base),
            playoutBridgeSecret: settings.playoutBridgeSecret ?? '',
            talkOverTracks: TALK_OVER_TRACKS,
            duckGainDb: DUCK_GAIN_DB,
            duckFadeMs: DUCK_FADE_MS,
            voiceGainDb: VOICE_GAIN_DB,
            controlTtlS: CONTROL_TTL_S,
            playoutPrefetch: PLAYOUT_LEAD,
        };
    }
}
