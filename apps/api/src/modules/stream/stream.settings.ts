import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SettingsRepository } from '#modules/settings/settings.repository.js';

/**
 * The `deadair.settings` keys backing the stream config.
 *
 * These live in the database rather than the environment on purpose: Icecast
 * and Liquidsoap run in sibling containers that cannot read Postgres, so the
 * app renders their config from these values onto a shared volume (see
 * `stream.config.ts`). Env keeps only what the app needs before a database
 * exists.
 */
export const STREAM_KEYS = {
    title: 'stream.title',
    description: 'stream.description',
    genre: 'stream.genre',
    publicUrl: 'stream.publicUrl',
    mount: 'stream.mount',
    bitrate: 'stream.bitrate',
    /** Hostname Icecast advertises in its own config. */
    hostname: 'stream.hostname',
    /** Host and port the app tells Liquidsoap to publish to (the compose service). */
    icecastHost: 'stream.icecastHost',
    icecastPort: 'stream.icecastPort',
    /**
     * Whether the rendered `icecast.xml` asks Icecast to tell the app about each
     * listener arriving and leaving.
     *
     * On by default, because the whole point is that the station is on air before
     * the first listener's player has finished buffering. It is a setting at all
     * because `<authentication type="url">` needs an Icecast built with libcurl:
     * one that was not refuses to start on a config naming it, and an operator on
     * such an image needs a way back that is not a code change. Turning it off
     * costs the seconds between a connection and the next stats poll, nothing
     * more.
     */
    listenerHooks: 'stream.listenerHooks',
    // Secrets below. Stored encrypted, never returned in the clear to a response.
    sourcePassword: 'stream.sourcePassword',
    adminPassword: 'stream.adminPassword',
    /**
     * Shared secret the app presents when pushing DJ voice to Liquidsoap's harbor
     * input, and that Liquidsoap authenticates the push against (`HARBOR_PASSWORD`
     * in radio.env). Seeded now even though nothing pushes voice yet: radio.liq
     * opens the harbor either way, and an unset password there is an open mount.
     */
    harborPassword: 'stream.harborPassword',
    /**
     * Shared secret gating the track shim's `POST /session`, which is how the app
     * hands it the login it opens its own Spotify session with. Materialized as
     * `SPOTIFY_SHIM_SECRET` so the shim inherits it from the entrypoint's sourced
     * radio.env, with no container-side config.
     */
    spotifyShimSecret: 'stream.spotifyShimSecret',
    /**
     * Shared secret gating the playout bridge in both directions: Liquidsoap's air
     * confirmation to us, and our pushes to its `/control/*` endpoints. Without it
     * every call is rejected and the running order never airs.
     */
    playoutBridgeSecret: 'stream.playoutBridgeSecret',
} as const;

/**
 * Whether a settings key is one the rendered container configs are built from.
 *
 * What makes a `stream.*` write different from any other setting: Icecast and
 * Liquidsoap cannot read the database, so a change to one of these is not in
 * force until it has been written out as files. See `StreamService.materialize`.
 */
export const isStreamSettingKey = (key: string): boolean => (Object.values(STREAM_KEYS) as string[]).includes(key);

/** The keys whose stored values are ciphertext. */
export const STREAM_SECRET_KEYS: string[] = [
    STREAM_KEYS.sourcePassword,
    STREAM_KEYS.adminPassword,
    STREAM_KEYS.harborPassword,
    STREAM_KEYS.spotifyShimSecret,
    STREAM_KEYS.playoutBridgeSecret,
];

export interface StreamSettings {
    title: string;
    description: string;
    genre: string;
    publicUrl: string;
    mount: string;
    bitrate: string;
    /** Hostname Icecast advertises. Empty means "derive it from publicUrl, else localhost". */
    hostname: string;
    icecastHost: string;
    icecastPort: string;
    /** Whether Icecast is asked to notify the app of each listener. See {@link STREAM_KEYS.listenerHooks}. */
    listenerHooks: boolean;
    /** Decrypted Icecast source password, `undefined` when unset. */
    sourcePassword?: string;
    /** Decrypted Icecast admin password, `undefined` when unset. */
    adminPassword?: string;
    /** Decrypted harbor push password, `undefined` when unset. */
    harborPassword?: string;
    /** Decrypted track shim secret, `undefined` when unset. */
    spotifyShimSecret?: string;
    /** Decrypted playout bridge secret, `undefined` when unset. */
    playoutBridgeSecret?: string;
}

/**
 * What an unconfigured station is, key by key.
 *
 * These match the committed static configs (`stream/radio.default.env`,
 * `stream/icecast.default.xml`), so a station nobody has set up yet renders a
 * coherent config rather than a half-empty one.
 *
 * Named rather than inline because two things now have to agree about them: the
 * resolver below, and the settings registry that offers these to an operator as
 * the value they are about to change. A default shown in the console that is not
 * the default the renderer uses is a bug nobody would think to look for.
 *
 * Secrets are deliberately absent: there is no default for one, and
 * {@link ensureStreamSecrets} mints them instead.
 */
export const STREAM_DEFAULTS = {
    title: 'Deadair',
    description: '',
    genre: 'Music',
    publicUrl: '',
    mount: '/live.mp3',
    bitrate: '128',
    hostname: '',
    icecastHost: 'icecast',
    icecastPort: '8000',
    listenerHooks: true,
} as const;

/**
 * Read the stream settings, decrypting the secrets and filling in
 * {@link STREAM_DEFAULTS} for everything the operator has not set.
 */
export function resolveStreamSettings(config: AppConfig, encryption: EncryptionProvider): StreamSettings {
    // From the config rather than a query: `deadair.settings` is one of its sources, so this reads
    // the same rows the repository would and costs no round trip. What it does NOT change is the
    // ciphertext — the source loads the table as it is stored, so the secrets arrive here
    // encrypted exactly as they did before, and are decrypted below.
    //
    // Built through `has` rather than a default of `''`, which keeps the distinction the defaults
    // below are written against: an ABSENT key has to fall through to its default, and a key
    // stored as the empty string has to stay empty. Reading every key with `get(key, '')` would
    // collapse the two and quietly turn `stream.title` into the empty string on a fresh install.
    const values = new Map<string, string>();
    for (const key of Object.values(STREAM_KEYS)) {
        if (config.has(key)) values.set(key, config.get(key, ''));
    }

    const decrypt = (raw: string | undefined): string | undefined => {
        if (!raw) return undefined;
        try {
            return encryption.decrypt(raw);
        } catch {
            // Tolerate a plaintext value: an operator seeding a password by hand with
            // psql is a reasonable thing to do, and failing the whole render over it
            // would take the stream down rather than the one setting.
            return raw;
        }
    };

    return {
        title: values.get(STREAM_KEYS.title) ?? STREAM_DEFAULTS.title,
        description: values.get(STREAM_KEYS.description) ?? STREAM_DEFAULTS.description,
        genre: values.get(STREAM_KEYS.genre) ?? STREAM_DEFAULTS.genre,
        publicUrl: values.get(STREAM_KEYS.publicUrl) ?? STREAM_DEFAULTS.publicUrl,
        mount: values.get(STREAM_KEYS.mount) ?? STREAM_DEFAULTS.mount,
        bitrate: values.get(STREAM_KEYS.bitrate) ?? STREAM_DEFAULTS.bitrate,
        hostname: values.get(STREAM_KEYS.hostname) ?? STREAM_DEFAULTS.hostname,
        icecastHost: values.get(STREAM_KEYS.icecastHost) ?? STREAM_DEFAULTS.icecastHost,
        icecastPort: values.get(STREAM_KEYS.icecastPort) ?? STREAM_DEFAULTS.icecastPort,
        // Only an explicit `false` turns them off, so an unset key (every install
        // until someone decides otherwise) gets the fast start.
        listenerHooks: values.get(STREAM_KEYS.listenerHooks) !== 'false',
        sourcePassword: decrypt(values.get(STREAM_KEYS.sourcePassword)),
        adminPassword: decrypt(values.get(STREAM_KEYS.adminPassword)),
        harborPassword: decrypt(values.get(STREAM_KEYS.harborPassword)),
        spotifyShimSecret: decrypt(values.get(STREAM_KEYS.spotifyShimSecret)),
        playoutBridgeSecret: decrypt(values.get(STREAM_KEYS.playoutBridgeSecret)),
    };
}

/** A strong secret that is safe unquoted in XML, a shell-sourced env file and a URL. */
function strongSecret(): string {
    return randomBytes(24).toString('base64url');
}

/**
 * First-boot self-configuration: seed a strong random value for every stream
 * secret the operator has not set.
 *
 * Without this the materializer skips (no Icecast passwords), the control
 * endpoints reject everything (no bridge secret) and the shim cannot log in (no
 * login secret) — three separate silent failures whose only fix is manual setup
 * of secrets nobody needs to choose.
 *
 * Idempotent: only a missing key is filled, so an operator-chosen password is
 * never overwritten. Returns true when it seeded at least one.
 *
 * NB: these differ from the committed dev defaults, so an Icecast that already
 * started on `icecast.default.xml` has to be restarted once to adopt them.
 */
export async function ensureStreamSecrets(repository: SettingsRepository, encryption: EncryptionProvider): Promise<boolean> {
    const existing = await repository.getMany(STREAM_SECRET_KEYS);

    let seeded = false;
    for (const key of STREAM_SECRET_KEYS) {
        if (existing.has(key)) continue;
        await repository.set(key, encryption.encrypt(strongSecret()));
        seeded = true;
    }
    return seeded;
}
