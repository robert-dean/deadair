import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberOr } from '#modules/shared/setting.numbers.js';

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
    /**
     * The optional format mounts, each off by default.
     *
     * MP3 is unconditional and is `mount` above: a Sonos, a car head unit and a
     * hardware radio take MP3, AAC or nothing, so it is the compatibility FLOOR
     * rather than a preference. Everything here is an addition beside it, and each
     * one costs an encoder running 24/7 in the stream container whether or not
     * anybody is listening to it — which is why none of them is on for a station
     * that never asked.
     *
     * Their mount paths are DERIVED from `stream.mount` rather than being settings
     * of their own; see {@link streamMounts}. Four more paths to keep in step by
     * hand is four more ways for the edge and the renderer to disagree.
     */
    opusEnabled: 'stream.opusEnabled',
    opusBitrate: 'stream.opusBitrate',
    aacEnabled: 'stream.aacEnabled',
    aacBitrate: 'stream.aacBitrate',
    /** Lossless TRANSPORT, which is only worth anything when the sources are lossless too. */
    flacEnabled: 'stream.flacEnabled',
    /**
     * The HLS output: one URL carrying AAC, and the only transport here that
     * survives a phone moving between wifi and mobile.
     *
     * An Icecast mount is a single long-lived TCP connection, so the handoff changes
     * the source address, the socket dies, and the stream simply ends. Nothing on the
     * server side carries a connection across that. HLS is a sequence of ordinary HTTP
     * requests, so a network change costs at most one segment fetch and the player
     * retries.
     *
     * Off by default like the format mounts, and for the same reason: it is one more
     * encoder running whether or not anybody is listening.
     */
    hlsEnabled: 'stream.hlsEnabled',
    hlsSegmentSeconds: 'stream.hlsSegmentSeconds',
    hlsSegmentCount: 'stream.hlsSegmentCount',
    /** Hostname Icecast advertises in its own config. */
    hostname: 'stream.hostname',
    /**
     * Where the station broadcasts from, as Icecast advertises it.
     *
     * A setting rather than the `Earth` the template used to hardcode, because
     * 2.5's dashboard flags that literal as a placeholder nobody filled in — and
     * it is right to: the field exists so a directory and a listener can tell one
     * station from another, and only the operator knows the answer. Empty renders
     * no `<location>` at all rather than a lie.
     */
    location: 'stream.location',
    /**
     * The language of what the station broadcasts, as a BCP 47 tag.
     *
     * Sent by Liquidsoap as `Content-Language` on the source connection, which is
     * the only way Icecast learns it: 2.5 reads that header and flags a source
     * without one. Empty sends no header.
     */
    language: 'stream.language',
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
    /** The MP3 mount, which is always published. Every other mount's path is derived from it. */
    mount: string;
    bitrate: string;
    opusEnabled: boolean;
    opusBitrate: string;
    aacEnabled: boolean;
    aacBitrate: string;
    flacEnabled: boolean;
    hlsEnabled: boolean;
    /** Target length of one HLS segment, in seconds. */
    hlsSegmentSeconds: number;
    /** How many segments a media playlist lists at once. */
    hlsSegmentCount: number;
    /** Hostname Icecast advertises. Empty means "derive it from publicUrl, else localhost". */
    hostname: string;
    /** Where the station broadcasts from. Empty renders no `<location>`. */
    location: string;
    /** BCP 47 tag sent as `Content-Language` on the source connection. Empty sends none. */
    language: string;
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
    // Off, every one of them: an encoder the operator did not ask for is CPU spent
    // permanently on a mount nobody has been told exists.
    opusEnabled: false,
    // 160 because Opus is near-transparent there and this station's sources are
    // already lossy, so spending more bits re-encoding them buys nothing audible.
    opusBitrate: '160',
    aacEnabled: false,
    // Roughly MP3 320's quality at fewer bits, and the tier hardware players expect.
    aacBitrate: '192',
    flacEnabled: false,
    hlsEnabled: false,
    // Two seconds, six of them: about 6-12s behind the live edge, which is the good end
    // of what HLS does. Shorter segments cut the latency and cost a request per listener
    // per segment; a longer window costs latency and buys resilience on a bad connection.
    hlsSegmentSeconds: 2,
    hlsSegmentCount: 6,
    hostname: '',
    location: '',
    language: '',
    icecastHost: 'icecast',
    icecastPort: '8000',
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
        // The eight keys that decide which mounts exist, through the one resolver that
        // reads them. Spread rather than repeated here because `/nowplaying` needs the
        // same eight and cannot call this function: it holds no scope, and the
        // `EncryptionProvider` the secrets below need is scoped.
        ...resolveMountSettings(config),
        // Clamped rather than refused, on the resolver rule: this is reading a row that is
        // already stored, and a setting that will not load stops the render behind it. The
        // console refuses an out-of-range figure at the point somebody types one.
        hlsSegmentSeconds: clamp(numberOr(config, STREAM_KEYS.hlsSegmentSeconds, STREAM_DEFAULTS.hlsSegmentSeconds), 1, 10),
        hlsSegmentCount: clamp(numberOr(config, STREAM_KEYS.hlsSegmentCount, STREAM_DEFAULTS.hlsSegmentCount), 3, 20),
        hostname: values.get(STREAM_KEYS.hostname) ?? STREAM_DEFAULTS.hostname,
        location: values.get(STREAM_KEYS.location) ?? STREAM_DEFAULTS.location,
        language: values.get(STREAM_KEYS.language) ?? STREAM_DEFAULTS.language,
        icecastHost: values.get(STREAM_KEYS.icecastHost) ?? STREAM_DEFAULTS.icecastHost,
        icecastPort: values.get(STREAM_KEYS.icecastPort) ?? STREAM_DEFAULTS.icecastPort,
        sourcePassword: decrypt(values.get(STREAM_KEYS.sourcePassword)),
        adminPassword: decrypt(values.get(STREAM_KEYS.adminPassword)),
        harborPassword: decrypt(values.get(STREAM_KEYS.harborPassword)),
        spotifyShimSecret: decrypt(values.get(STREAM_KEYS.spotifyShimSecret)),
        playoutBridgeSecret: decrypt(values.get(STREAM_KEYS.playoutBridgeSecret)),
    };
}

/**
 * The bitrates the optional encoders may be set to, as a closed set.
 *
 * Closed because of how Liquidsoap reads an encoder: `%opus(bitrate=…)` and its AAC
 * sibling want a literal at the moment the script is PARSED, not a value that can be
 * handed in, so `radio.liq` selects between fixed encoders rather than interpolating
 * a number into one. A free-text setting would therefore be a figure an operator can
 * type and the stream cannot honour, which is worse than a shorter menu.
 *
 * So these are shared: the console offers exactly this list, and the branch in
 * `radio.liq` covers exactly this list. Adding a value means adding it in both, and
 * `stream.config.test.ts` is where they are held to each other.
 */
export const OPUS_BITRATES = ['96', '128', '160', '192', '256'] as const;
export const AAC_BITRATES = ['96', '128', '160', '192', '256', '320'] as const;

/**
 * The MP3 bitrates the console SUGGESTS, which is a different kind of list to the two above.
 *
 * Open rather than closed, and for the reason those are closed read the other way: `%mp3(bitrate=…)`
 * in `radio.liq` takes an `int_of_string`, so the figure really is handed in and any of them works.
 * Nothing checks a stored value against this and nothing should — it is what the settings form
 * offers while still accepting whatever is typed, so adding a value here changes a menu and not a
 * capability.
 */
export const MP3_BITRATES = ['64', '96', '128', '160', '192', '256', '320'] as const;

/** The formats the station can publish. `mp3` is always one of them. */
export type StreamFormat = 'mp3' | 'opus' | 'aac' | 'flac';

/** One mount the station publishes, as everything downstream needs to see it. */
export interface StreamMount {
    format: StreamFormat;
    /** Same-origin path, leading slash included. */
    path: string;
    /**
     * The encoder's bitrate in kbps, or `undefined` for a format that has none.
     *
     * FLAC is the one without: it is lossless, so its rate is whatever the material
     * needs. {@link FLAC_ASSUMED_KBPS} is what the buffer sizing uses in its place.
     */
    bitrateKbps?: number;
}

/**
 * What a FLAC mount costs per listener, for the sizing that has to assume something.
 *
 * FLAC has no bitrate to read, and the Icecast buffers that have to be sized against
 * one are counted in BYTES. Stereo 44.1 kHz FLAC of ordinary music lands around here;
 * it is used only to size a buffer generously, so being wrong by a hundred kbps costs
 * a slightly roomier queue and nothing else.
 */
export const FLAC_ASSUMED_KBPS = 900;

/**
 * The mount path for a format, derived from the MP3 mount by swapping the extension.
 *
 * Derived rather than configured, and that is the whole design: four more settings
 * would be four more values for the renderer, the audience gate, the edge and the
 * console to disagree about, and an operator would have to keep them in step by hand
 * for no benefit anybody could name. A mount with no extension keeps its own name for
 * MP3 and gains one for the rest, which is the only sane reading of `/live`.
 */
export function mountPathFor(mount: string, format: StreamFormat): string {
    if (format === 'mp3') return mount;

    const cut = mount.lastIndexOf('.');
    const slash = mount.lastIndexOf('/');
    const stem = cut > slash + 1 ? mount.slice(0, cut) : mount;
    return `${stem}.${format}`;
}

/**
 * The settings that decide which mounts exist, and nothing else.
 *
 * A narrower reading than {@link resolveStreamSettings} because it is the one every
 * caller of {@link streamMounts} actually needs, and because the full resolver decrypts
 * five secrets and therefore takes an `EncryptionProvider` — which is SCOPED. That is
 * what puts the full settings out of reach of `/nowplaying`, which answers out of
 * memory with no scope and no transaction so a device can poll it every few seconds.
 * Splitting the read is what lets both have the same answer rather than two derivations
 * of it.
 */
export type MountSettings = Pick<
    StreamSettings,
    'mount' | 'bitrate' | 'opusEnabled' | 'opusBitrate' | 'aacEnabled' | 'aacBitrate' | 'flacEnabled' | 'hlsEnabled'
>;

/**
 * Read {@link MountSettings} straight off the config.
 *
 * Every switch goes through `settingIsOn` and never through a direct `get`, because
 * every layer of `AppConfig` holds STRINGS: `config.get(key, false)` answers `'false'`,
 * which is truthy, and a mount switched on that way could never be switched off again.
 */
export function resolveMountSettings(config: AppConfig): MountSettings {
    // `has` before `get`, on the same rule the full resolver states: an ABSENT key falls
    // through to its default, and a key stored as the empty string stays empty.
    const text = (key: string, fallback: string): string => (config.has(key) ? config.get(key, '') : fallback);

    return {
        mount: text(STREAM_KEYS.mount, STREAM_DEFAULTS.mount),
        bitrate: text(STREAM_KEYS.bitrate, STREAM_DEFAULTS.bitrate),
        opusEnabled: settingIsOn(config, STREAM_KEYS.opusEnabled, STREAM_DEFAULTS.opusEnabled),
        opusBitrate: text(STREAM_KEYS.opusBitrate, STREAM_DEFAULTS.opusBitrate),
        aacEnabled: settingIsOn(config, STREAM_KEYS.aacEnabled, STREAM_DEFAULTS.aacEnabled),
        aacBitrate: text(STREAM_KEYS.aacBitrate, STREAM_DEFAULTS.aacBitrate),
        flacEnabled: settingIsOn(config, STREAM_KEYS.flacEnabled, STREAM_DEFAULTS.flacEnabled),
        hlsEnabled: settingIsOn(config, STREAM_KEYS.hlsEnabled, STREAM_DEFAULTS.hlsEnabled),
    };
}

/**
 * Where the HLS master playlist is, which is a CONSTANT and not derived from the mount.
 *
 * `radio.liq` writes `playlist = "live.m3u8"` as a literal, so the file on disk carries
 * that name whatever `stream.mount` is called. The nginx redirect matches any
 * single-segment `.m3u8` at the root by SHAPE, which makes a renamed mount look like it
 * would work here — it would redirect, and then 404, because nothing writes a playlist
 * under the new name. Deriving this from the mount is therefore the obvious move and the
 * wrong one; see `nginx/snippets/hls.conf` and `stream/radio.liq`.
 */
export const HLS_PLAYLIST_PATH = '/live.m3u8';

/**
 * Every mount this station publishes right now, MP3 first.
 *
 * The single source of truth for "which mounts exist", which four things need and
 * which none of them may work out for itself: the renderer writes a `<mount>` block
 * and an `output.icecast` per entry, the audience gate sums listeners across them,
 * the console lists them, and the staleness check asks about the first. Two of those
 * deriving the list separately is how a listener on a mount nobody counted stops
 * holding the station on air.
 *
 * A format that is switched off is ABSENT rather than present-and-disabled, because
 * every consumer wants the same thing from this: the mounts that are actually there.
 */
export function streamMounts(settings: MountSettings): StreamMount[] {
    const bitrate = (raw: string, fallback: number): number => {
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    const mounts: StreamMount[] = [{ format: 'mp3', path: settings.mount, bitrateKbps: bitrate(settings.bitrate, Number(STREAM_DEFAULTS.bitrate)) }];
    if (settings.opusEnabled) {
        mounts.push({
            format: 'opus',
            path: mountPathFor(settings.mount, 'opus'),
            bitrateKbps: bitrate(settings.opusBitrate, Number(STREAM_DEFAULTS.opusBitrate)),
        });
    }
    if (settings.aacEnabled) {
        mounts.push({
            format: 'aac',
            path: mountPathFor(settings.mount, 'aac'),
            bitrateKbps: bitrate(settings.aacBitrate, Number(STREAM_DEFAULTS.aacBitrate)),
        });
    }
    if (settings.flacEnabled) mounts.push({ format: 'flac', path: mountPathFor(settings.mount, 'flac') });

    return mounts;
}

/** What one mount costs a listener per second, in bytes. FLAC is assumed; see {@link FLAC_ASSUMED_KBPS}. */
export function bytesPerSecond(mount: StreamMount): number {
    return ((mount.bitrateKbps ?? FLAC_ASSUMED_KBPS) * 1000) / 8;
}

/** Hold a number inside the bounds the registry offers, both ends inclusive. */
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(value)));

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
