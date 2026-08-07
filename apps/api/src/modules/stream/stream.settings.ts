import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
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
 * Read the stream settings, decrypting the secrets and filling in defaults that
 * match the committed static configs (`stream/radio.default.env`,
 * `stream/icecast.default.xml`), so an unconfigured station still renders a
 * coherent config rather than a half-empty one.
 */
export async function resolveStreamSettings(repository: SettingsRepository, encryption: EncryptionProvider): Promise<StreamSettings> {
    const values = await repository.getMany(Object.values(STREAM_KEYS));

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
        title: values.get(STREAM_KEYS.title) ?? 'Deadair',
        description: values.get(STREAM_KEYS.description) ?? '',
        genre: values.get(STREAM_KEYS.genre) ?? 'Music',
        publicUrl: values.get(STREAM_KEYS.publicUrl) ?? '',
        mount: values.get(STREAM_KEYS.mount) ?? '/live.mp3',
        bitrate: values.get(STREAM_KEYS.bitrate) ?? '128',
        hostname: values.get(STREAM_KEYS.hostname) ?? '',
        icecastHost: values.get(STREAM_KEYS.icecastHost) ?? 'icecast',
        icecastPort: values.get(STREAM_KEYS.icecastPort) ?? '8000',
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
