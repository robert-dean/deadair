import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberFrom, numberOr } from '#modules/shared/setting.numbers.js';

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
    bitrate: 'stream.bitrate',
    /**
     * The optional format mounts, each off by default.
     *
     * MP3 is unconditional: a Sonos, a car head unit and a hardware radio take MP3,
     * AAC or nothing, so it is the compatibility FLOOR rather than a preference.
     * Everything here is an addition beside it, and each one costs an encoder running
     * 24/7 in the stream container whether or not anybody is listening to it — which
     * is why none of them is on for a station that never asked.
     *
     * No mount's PATH is a setting; see {@link MOUNT_PATHS}.
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
    /**
     * The most listeners any ONE way of listening may have at once. Empty or zero is no cap.
     *
     * Per mount rather than for the station, because that is the only form Icecast enforces: a
     * `<max-listeners>` on each `<mount>`. The station-wide `<clients>` is not a listener count at
     * all, since the event feed, the stats reads and the admin calls are clients too, and a cap put
     * there refuses the station's own bookkeeping before it refuses a listener. HLS has no Icecast
     * connection to refuse, so the same number is applied to it in `hls.heartbeat.middleware.ts`.
     *
     * **Saving it restarts Icecast**, which drops everybody listening: it is in the rendered file,
     * and the config watch restarts the server whenever that file changes. The help text says so.
     */
    maxListeners: 'stream.maxListeners',
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
    /**
     * How much the audio chain writes to its own log, as Liquidsoap's own 1-5 scale.
     *
     * A setting because the only way to raise it was a container variable, which on unraid
     * means editing the template and which nothing in the console could show. What made that
     * worth fixing: on 2026-09-16 Liquidsoap took a record into its queue and never began
     * resolving it, wrote no log line for the 72 seconds before the watchdog restarted it, and
     * the reason it stopped is a layer that only logs at 4. The whole diagnosis ended at "raise
     * the level and wait", which was a thing an operator could not do.
     *
     * **Saving this restarts the audio chain**, like every other key in the rendered file, so it
     * costs the seconds of silence a restart costs — and a restart CLEARS the kind of fault this
     * is for. It is "set it and wait for the next one", never "turn it up while it is stuck",
     * and the help text says so.
     *
     * **At 4 and above the log holds the playout bridge secret in plain text**, because the harbor
     * records every header of every `/control/*` call and the app polls that endpoint
     * continuously. That is why `GET /logs/*` is `platform.manage` rather than `platform.view`
     * (see `apps/api/README.md`), and it is the reason this is worth an operator putting back
     * afterwards rather than leaving. What bounds the exposure now is rotation: the secret ages
     * out of `/data/streamlogs` with the segments rather than sitting in one file for ever.
     */
    logLevel: 'stream.logLevel',
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
    /** The most listeners one mount may have. `0` is no cap. See {@link STREAM_KEYS.maxListeners}. */
    maxListeners: number;
    /** Hostname Icecast advertises. Empty means "derive it from publicUrl, else localhost". */
    hostname: string;
    /** Where the station broadcasts from. Empty renders no `<location>`. */
    location: string;
    /** BCP 47 tag sent as `Content-Language` on the source connection. Empty sends none. */
    language: string;
    icecastHost: string;
    icecastPort: string;
    /** Liquidsoap's own log level, 1-5. Always an integer, because `radio.liq` reads it as one. */
    logLevel: number;
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
    // No cap. A station that never asked for one must not start turning listeners away, and an
    // upgrade must render exactly the file it rendered before.
    maxListeners: 0,
    hostname: '',
    location: '',
    language: '',
    icecastHost: 'icecast',
    icecastPort: '8000',
    // Liquidsoap's own default, and the level every measurement quoted in `radio.liq` was taken
    // at. 4 is a diagnostic position rather than a place to leave a station: it logs every header
    // of every control call, and the app polls that endpoint continuously.
    logLevel: 3,
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
        // The one value here that is derived when empty rather than defaulted; see the resolver.
        publicUrl: resolvePublicUrl(config),
        // The seven keys that decide which mounts exist, through the one resolver that
        // reads them. Spread rather than repeated here because `/nowplaying` needs the
        // same seven and cannot call this function: it holds no scope, and the
        // `EncryptionProvider` the secrets below need is scoped.
        ...resolveMountSettings(config),
        // Clamped rather than refused, on the resolver rule: this is reading a row that is
        // already stored, and a setting that will not load stops the render behind it. The
        // console refuses an out-of-range figure at the point somebody types one.
        hlsSegmentSeconds: clamp(numberOr(config, STREAM_KEYS.hlsSegmentSeconds, STREAM_DEFAULTS.hlsSegmentSeconds), 1, 10),
        hlsSegmentCount: clamp(numberOr(config, STREAM_KEYS.hlsSegmentCount, STREAM_DEFAULTS.hlsSegmentCount), 3, 20),
        maxListeners: resolveMaxListeners(config),
        hostname: values.get(STREAM_KEYS.hostname) ?? STREAM_DEFAULTS.hostname,
        location: values.get(STREAM_KEYS.location) ?? STREAM_DEFAULTS.location,
        language: values.get(STREAM_KEYS.language) ?? STREAM_DEFAULTS.language,
        icecastHost: values.get(STREAM_KEYS.icecastHost) ?? STREAM_DEFAULTS.icecastHost,
        icecastPort: values.get(STREAM_KEYS.icecastPort) ?? STREAM_DEFAULTS.icecastPort,
        // Through `numberFrom` over the raw value rather than `numberOr` beside it, because
        // `numberOr` answers `Number('')`, which is 0 and finite, so a key stored as the empty
        // string resolves to zero rather than to the default. Clamped to 1 that would be
        // "critical only" — a station that stopped logging because a setting was blanked. Clamp
        // rather than refuse on the resolver rule: this is reading a row that is already stored.
        logLevel: clamp(numberFrom(values.get(STREAM_KEYS.logLevel), STREAM_DEFAULTS.logLevel), 1, 5),
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
/**
 * `stream.publicUrl` as a base to build on: trimmed, with no trailing slash.
 *
 * The setting is "where listeners reach the station", which is the console's origin, and the
 * API is reached under `/api/` on it (`authentication.options.ts`). Empty when the operator has
 * set nothing, and every caller treats that as "there is no outside address", not as localhost.
 */
export function stationOrigin(publicUrl: string): string {
    return publicUrl.trim().replace(/\/+$/, '');
}

/**
 * Where listeners reach the station: `stream.publicUrl` when the operator set one, else the
 * console's address from the environment, else nothing. Always as an origin, with no trailing
 * slash.
 *
 * Derived rather than defaulted, the way the advertised hostname derives from this setting. An
 * operator who reaches the station through a tunnel has already written that address once, as
 * `SPA_BASE_URL` (and `APP_BASE_URL`, which in the image is the same address; see "The station's
 * address" in deploy/README.md), and a setting asking for it a second time is the kind that stays
 * blank: the live station had the environment set and this empty, so the mount carried no artwork
 * and Icecast advertised itself as localhost. The registry's default stays empty, on the rule that
 * the registry's default and the resolver's agree; what happens to an EMPTY value is a derivation,
 * and the field's help text says so.
 */
export function resolvePublicUrl(config: AppConfig): string {
    const stored = stationOrigin(String(config.get(STREAM_KEYS.publicUrl, STREAM_DEFAULTS.publicUrl) ?? ''));
    return stored || deployedOrigin(config);
}

/**
 * The address the station was DEPLOYED with: `SPA_BASE_URL`, else `APP_BASE_URL`, else nothing.
 * An origin, with no trailing slash.
 *
 * Split out of {@link resolvePublicUrl} so it can be asked on its own, which is what the settings
 * read does. "What is in force" prefers the operator's stored setting and "what an empty box works
 * out to" has to skip it, so a console asking the resolver would be handed the operator's own value
 * and would call it a derivation.
 */
export function deployedOrigin(config: AppConfig): string {
    for (const key of ['SPA_BASE_URL', 'APP_BASE_URL'] as const) {
        const origin = stationOrigin(String(config.get<string, string>(key, '') ?? ''));
        if (origin) return origin;
    }
    return '';
}

/**
 * Hostname Icecast advertises: the configured one, else the public URL's, else localhost.
 *
 * The explicit setting first, which is what both settings' help text has always promised. It was
 * the other way round, so an operator who filled in both got the public URL's hostname and a field
 * that was silently ignored.
 *
 * Beside the public URL it reads rather than in `stream.config.ts` where it is rendered, because
 * the settings read asks it too: a hostname field left empty still has a value in force, and the
 * console now shows it. `localhost` included — that is genuinely what Icecast calls itself with
 * nothing to go on, and an operator seeing it there is the whole point.
 */
export function advertisedHostname(publicUrl: string, hostname: string): string {
    if (hostname) return hostname;
    if (publicUrl) {
        try {
            return new URL(publicUrl).hostname;
        } catch {
            // A malformed public URL is a setting to fix, not a reason to skip the render.
        }
    }
    return 'localhost';
}

/**
 * The station's own face, as a listener's player can fetch it: the console's `logo.png` on
 * the origin listeners reach.
 *
 * It is what the mount shows when the station ITSELF is what is playing (a break, the bed, off
 * air), for the same reason the mount carries the station's name then. Empty without a public
 * URL: a URL nobody outside this network can fetch is worse than none. See `listenerArtwork` in
 * `playout/annotate.ts` for the record half and `STREAM_ART_URL` in `radio.liq` for the labels
 * Liquidsoap puts up itself.
 */
export function stationArtwork(publicUrl: string): string {
    const origin = stationOrigin(publicUrl);
    return origin ? `${origin}/logo.png` : '';
}

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

/**
 * The log levels the console offers, named rather than numbered.
 *
 * Liquidsoap's scale is 1-5 and its own names for them are not words an operator has any reason
 * to know, so the menu says what each one is FOR. A closed list on the `OPUS_BITRATES` rule and
 * not on the `MP3_BITRATES` one: the resolver clamps anything stored into 1-5 anyway, so this is
 * the shorter menu rather than the limit.
 *
 * 1 is deliberately not offered. It is the level at which a station stops reporting the faults an
 * operator opened this page to read, and nothing is gained by it that 2 does not give.
 */
export const LOG_LEVELS = [
    { value: '2', label: 'Problems only' },
    { value: '3', label: 'Normal' },
    { value: '4', label: 'Debug — for diagnosing a fault' },
    { value: '5', label: 'Trace — everything' },
] as const;

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
 * Where each format is published. Fixed, and not a setting.
 *
 * The MP3 path was one (`stream.mount`), with the rest derived from it by swapping the
 * extension, and nothing needed it to vary: the station runs its own Icecast, so there
 * is no neighbouring station on it to collide with. What it did offer was a way to
 * break every URL a listener had saved, applied only on the stream container's next
 * restart. Three things already treated `/live` as fixed besides: the HLS playlist
 * below, which `radio.liq` names as a literal, and both listener apps, which tune to
 * `/live.mp3` before the station has told them its mounts.
 *
 * A stored `stream.mount` row from before is ignored rather than deleted, on the
 * registry's rule for rows nobody declares.
 */
export const MOUNT_PATHS: Readonly<Record<StreamFormat, string>> = {
    mp3: '/live.mp3',
    opus: '/live.opus',
    aac: '/live.aac',
    flac: '/live.flac',
};

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
    'bitrate' | 'opusEnabled' | 'opusBitrate' | 'aacEnabled' | 'aacBitrate' | 'flacEnabled' | 'hlsEnabled'
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
        bitrate: text(STREAM_KEYS.bitrate, STREAM_DEFAULTS.bitrate),
        opusEnabled: settingIsOn(config, STREAM_KEYS.opusEnabled, STREAM_DEFAULTS.opusEnabled),
        opusBitrate: text(STREAM_KEYS.opusBitrate, STREAM_DEFAULTS.opusBitrate),
        aacEnabled: settingIsOn(config, STREAM_KEYS.aacEnabled, STREAM_DEFAULTS.aacEnabled),
        aacBitrate: text(STREAM_KEYS.aacBitrate, STREAM_DEFAULTS.aacBitrate),
        flacEnabled: settingIsOn(config, STREAM_KEYS.flacEnabled, STREAM_DEFAULTS.flacEnabled),
        hlsEnabled: settingIsOn(config, STREAM_KEYS.hlsEnabled, STREAM_DEFAULTS.hlsEnabled),
    };
}

/** The range `stream.maxListeners` takes, shared with the registry for the reason every range there is. */
export const MAX_LISTENERS_RANGE = { min: 0, max: 10_000 } as const;

/**
 * `stream.maxListeners` as a number, `0` meaning no cap.
 *
 * Its own export, and read straight off the config with no scope, because two things need it and
 * one of them is a middleware answering every HLS playlist request. Through `numberFrom` for
 * `logLevel`'s reason: an empty string must be the default rather than `Number('')`, although here
 * the two happen to agree. Clamped rather than refused, on the resolver rule.
 */
export function resolveMaxListeners(config: AppConfig): number {
    return clamp(
        numberFrom(config.get(STREAM_KEYS.maxListeners, ''), STREAM_DEFAULTS.maxListeners),
        MAX_LISTENERS_RANGE.min,
        MAX_LISTENERS_RANGE.max,
    );
}

/**
 * Where the HLS master playlist is. `radio.liq` writes `playlist = "live.m3u8"` as a
 * literal; see `nginx/snippets/hls.conf` for how the edge reaches it.
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

    const mounts: StreamMount[] = [{ format: 'mp3', path: MOUNT_PATHS.mp3, bitrateKbps: bitrate(settings.bitrate, Number(STREAM_DEFAULTS.bitrate)) }];
    if (settings.opusEnabled) {
        mounts.push({ format: 'opus', path: MOUNT_PATHS.opus, bitrateKbps: bitrate(settings.opusBitrate, Number(STREAM_DEFAULTS.opusBitrate)) });
    }
    if (settings.aacEnabled) {
        mounts.push({ format: 'aac', path: MOUNT_PATHS.aac, bitrateKbps: bitrate(settings.aacBitrate, Number(STREAM_DEFAULTS.aacBitrate)) });
    }
    if (settings.flacEnabled) mounts.push({ format: 'flac', path: MOUNT_PATHS.flac });

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
 * Idempotent: only a missing key is filled, so a value set by hand is never
 * overwritten. Returns true when it seeded at least one.
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
