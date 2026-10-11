/**
 * Everything this container reads from its environment, in one place.
 *
 * Shaped after `stream/spotify-shim`: the config comes from the process env because the compose
 * entrypoint sources `radio.env` with `set -a` before starting anything, so there is no file to
 * parse and no flag to forget. The names follow that shim's — `PLAYOUT_BRIDGE_SECRET` is the same
 * secret, signing the same kind of URL, and a station that has seeded one has seeded both.
 */

/** Where the captured audio is written before it is served, and what it is served as. */
export const CAPTURE_FORMATS = {
    /**
     * The default, and not an obvious one, so the reasoning is here rather than in a commit message.
     *
     * What comes off the null sink is PCM that the browser has already decoded from Apple's 256kbps
     * AAC. Re-encoding it to mp3 would put a second lossy generation on every record the station
     * owns, permanently, to save disk on a machine whose cache limit is already the operator's own
     * setting (`DEFAULT_TRACK_CACHE_MAX_BYTES`). FLAC adds none: the file is exactly what the
     * player produced. About 35MB for a four-minute record, comfortably inside `MAX_TRACK_BYTES`.
     */
    flac: { contentType: 'audio/flac', args: ['-c:a', 'flac', '-compression_level', '5', '-f', 'flac'] },
    /** For an operator who would rather have the disk back than the generation. */
    mp3: { contentType: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3'] },
} as const satisfies Record<string, { contentType: string; args: readonly string[] }>;

export type CaptureFormat = keyof typeof CAPTURE_FORMATS;

export const isCaptureFormat = (value: string | undefined): value is CaptureFormat => value !== undefined && Object.hasOwn(CAPTURE_FORMATS, value);

export interface PlayerConfig {
    /** Listen address for this container's HTTP server. */
    readonly port: number;
    /**
     * Signs `/track/{id}` URLs. The bridge secret, exactly as the Spotify shim uses it.
     *
     * Empty is fatal at startup rather than tolerated, for the shim's reason: a server that cannot
     * verify a signature and serves anyway is a public Apple Music proxy.
     */
    readonly secret: string;
    /** The Pulse sink the browser plays into, whose monitor is what gets captured. */
    readonly sink: string;
    /** Chrome's DevTools port, loopback-only and never published. */
    readonly cdpPort: number;
    /** The page whose MusicKit instance is driven. Overridable for a storefront-specific entry. */
    readonly playerUrl: string;
    readonly format: CaptureFormat;
    /** Where captures are written. A tmpfs in the container; each file is deleted after it is served. */
    readonly captureDir: string;
    /**
     * How much longer than a record's own duration a capture may run before it is abandoned.
     *
     * Generous: the point of the ceiling is that a stalled player cannot hold the one browser
     * forever, not to police a few seconds of lead-in. A record that genuinely needs longer than
     * its duration plus this is a record that is not playing.
     */
    readonly slackMs: number;
    /** How long a fetch waits for the browser when another record is already being captured. */
    readonly queueMs: number;
}

const number = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim() === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

/**
 * Read the config, or say which variable is missing and exit non-zero.
 *
 * The supervisor script restarts this on a throttle the way `spotify-shim-run.sh` does, so an
 * unseeded secret becomes one log line every few seconds rather than a container that looks up.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): PlayerConfig {
    const format = env.APPLE_PLAYER_FORMAT;
    return {
        port: number(env.APPLE_PLAYER_PORT, 3680),
        secret: env.PLAYOUT_BRIDGE_SECRET ?? '',
        sink: env.APPLE_PLAYER_SINK ?? 'deadair',
        cdpPort: number(env.APPLE_PLAYER_CDP_PORT, 9222),
        playerUrl: env.APPLE_PLAYER_URL ?? 'https://music.apple.com/us/browse',
        format: isCaptureFormat(format) ? format : 'flac',
        captureDir: env.APPLE_PLAYER_CAPTURE_DIR ?? '/tmp/captures',
        slackMs: number(env.APPLE_PLAYER_SLACK_MS, 60_000),
        queueMs: number(env.APPLE_PLAYER_QUEUE_MS, 15 * 60_000),
    };
}
