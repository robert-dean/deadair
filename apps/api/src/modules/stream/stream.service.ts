import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { playoutAiredUrl, resolvePlayoutBaseUrl } from '#modules/playout/playout.urls.js';
import { defaultStreamAssetsDir, defaultStreamConfigDir, writeStreamConfig, type StreamPlayoutConfig } from './stream.config.js';
import { ensureStreamSecrets, resolveStreamSettings, type StreamSettings } from './stream.settings.js';

/**
 * The duck, and whether the DJ talks over the music or between tracks.
 *
 * Constants rather than settings: the director that would own them does not
 * exist here, and nothing pushes voice to the harbor yet, so these only decide
 * what a future break would sound like. They match `stream/radio.default.env`
 * so the rendered file agrees with the committed fallback.
 */
const TALK_OVER_TRACKS = true;
const DUCK_GAIN_DB = -12;
const DUCK_FADE_MS = 300;

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
 * `stream.*` settings has to call {@link materialize} itself, because nothing
 * watches the table.
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
        private readonly logger: Logger,
    ) {}

    /** The resolved settings, secrets decrypted. */
    async settings(): Promise<StreamSettings> {
        return resolveStreamSettings(this.settingsRepository, this.encryption);
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
     */
    async materialize(): Promise<boolean> {
        try {
            const settings = await this.settings();
            return writeStreamConfig({
                settings,
                playout: this.playoutConfig(settings),
                assetsDir: this.config.get('STREAM_ASSETS_DIR', defaultStreamAssetsDir()),
                configDir: this.config.get('STREAM_CONFIG_DIR', defaultStreamConfigDir()),
                musicDir: this.config.get('STREAM_MUSIC_DIR', DEFAULT_MUSIC_DIR),
                harborPort: this.config.get('STREAM_HARBOR_PORT', DEFAULT_HARBOR_PORT),
                log: message => this.logger.info(`stream: ${message}`),
            });
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
        return {
            playoutAiredUrl: playoutAiredUrl(resolvePlayoutBaseUrl(this.config)),
            playoutBridgeSecret: settings.playoutBridgeSecret ?? '',
            talkOverTracks: TALK_OVER_TRACKS,
            duckGainDb: DUCK_GAIN_DB,
            duckFadeMs: DUCK_FADE_MS,
        };
    }
}
