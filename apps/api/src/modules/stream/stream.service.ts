import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { CONTROL_TTL_S, PLAYOUT_LEAD } from '#modules/playout/liquidsoap.control.js';
import { playoutAiredUrl, playoutListenerUrl, playoutStarveUrl, resolvePlayoutBaseUrl } from '#modules/playout/playout.urls.js';
import { defaultStreamAssetsDir, defaultStreamConfigDir, writeStreamConfig, type StreamPlayoutConfig } from './stream.config.js';
import { ensureStreamSecrets, resolveStreamSettings, type StreamSettings } from './stream.settings.js';
import { StreamConfigWatch } from './stream.staleness.js';

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
        private readonly logger: Logger,
    ) {}

    /** The resolved settings, secrets decrypted. */
    settings(): StreamSettings {
        return resolveStreamSettings(this.config, this.encryption);
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
            // The same base Liquidsoap reports air on, because it is the same question:
            // where this app is, as a container on the stream's network sees it.
            ...(settings.listenerHooks
                ? { listenerHooks: { addUrl: playoutListenerUrl(base, 'add'), removeUrl: playoutListenerUrl(base, 'remove') } }
                : {}),
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
