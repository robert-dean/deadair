import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamSettings } from './stream.settings.js';

/**
 * The stream config materializer.
 *
 * Icecast and Liquidsoap run as sibling containers that cannot read Postgres,
 * so the app (which can) renders their config from the current settings onto a
 * volume both of them mount. Two artifacts are written:
 *
 * - `icecast.xml` — the full Icecast config, passwords and identity filled in
 * - `radio.env`   — a shell-sourced env file the Liquidsoap entrypoint loads
 *
 * Best-effort throughout: an unconfigured stream or an unwritable config dir
 * logs and skips rather than failing boot. Both containers fall back to their
 * committed static defaults in that case, so the mount still comes up.
 */

/** Repo root's `stream/` assets. `process.cwd()` is `apps/api` at runtime. */
export function defaultStreamAssetsDir(): string {
    return join(process.cwd(), '..', '..', 'stream');
}

/** The shared volume the stream containers read their rendered config from. */
export function defaultStreamConfigDir(): string {
    return join(process.cwd(), '..', '..', '.docvol', 'streamconfig');
}

/** Escape a value for XML text or attribute content. */
function xml(value: string): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Single-quote a value for a shell-sourced env file. */
function shell(value: string): string {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Hostname Icecast advertises: from the public URL, else the configured one, else localhost. */
function hostnameFrom(publicUrl: string, hostname: string): string {
    if (publicUrl) {
        try {
            return new URL(publicUrl).hostname;
        } catch {
            // A malformed public URL is a setting to fix, not a reason to skip the render.
        }
    }
    return hostname || 'localhost';
}

/**
 * The playout wiring for `radio.env`.
 *
 * Nothing here is per-source: every item reaches Liquidsoap the same way (the
 * app pushes, the queue fetches), so switching what fills the running order is
 * an app-side decision that needs no container restart.
 */
export interface StreamPlayoutConfig {
    /** App endpoint Liquidsoap reports the item that actually went on air to. */
    playoutAiredUrl: string;
    /**
     * The secret used in both directions: Liquidsoap presents it on the air
     * confirmation, and checks it on the app's pushes to `/control/*`.
     */
    playoutBridgeSecret: string;
    /**
     * Talk-over mode. `true` ducks the bed under the DJ voice; `false` lets the
     * voice preempt the bed so the DJ speaks between tracks in silence. Read by
     * radio.liq at startup, so a change needs a Liquidsoap restart.
     */
    talkOverTracks: boolean;
    /** How far the bed drops under the voice, in dB (negative). */
    duckGainDb: number;
    /** How long the duck ramp takes, in ms. */
    duckFadeMs: number;
    /**
     * How long one "deadair is driving" assertion holds the mount, in seconds.
     *
     * The dead-man switch: `radio.liq` airs nothing unless the app is renewing
     * this, so a crashed or restarted app takes the station off air instead of
     * leaving the local bed playing to an audience deadair is not choosing for.
     */
    controlTtlS: number;
    /**
     * How many requests Liquidsoap resolves ahead of the one on air.
     *
     * The same number the app uses for its own push lead, because a skip only
     * lands at once if the item behind it is already downloaded, and only
     * `prefetch` of the pushed items ever are.
     */
    playoutPrefetch: number;
}

export interface WriteStreamConfigArgs {
    settings: StreamSettings;
    playout: StreamPlayoutConfig;
    assetsDir?: string;
    configDir?: string;
    /** Where Liquidsoap finds the local music bed inside its container. */
    musicDir?: string;
    /** Harbor port, which must match the port published in docker-compose.yml. */
    harborPort?: string;
    adminEmail?: string;
    log?: (message: string) => void;
}

/**
 * Render `icecast.xml` and `radio.env` from the resolved settings.
 *
 * @returns true when both files were written.
 */
export function writeStreamConfig({
    settings,
    playout,
    assetsDir = defaultStreamAssetsDir(),
    configDir = defaultStreamConfigDir(),
    musicDir = '/music',
    harborPort = '8005',
    adminEmail = 'admin@localhost',
    log = () => {},
}: WriteStreamConfigArgs): boolean {
    const { sourcePassword, adminPassword } = settings;
    if (!sourcePassword || !adminPassword) {
        // Only reachable when the secrets were deliberately cleared: `ensureStreamSecrets`
        // seeds both on first boot.
        log('not configured (set stream.sourcePassword + stream.adminPassword); skipping config');
        return false;
    }

    const templatePath = join(assetsDir, 'icecast.xml.tmpl');
    let template: string;
    try {
        template = readFileSync(templatePath, 'utf8');
    } catch (error) {
        log(`icecast template missing at ${templatePath} (${errorText(error)}); skipping`);
        return false;
    }

    const tokens: Record<string, string> = {
        SOURCE_PASSWORD: xml(sourcePassword),
        RELAY_PASSWORD: xml(sourcePassword),
        ADMIN_PASSWORD: xml(adminPassword),
        ADMIN_EMAIL: xml(adminEmail),
        HOSTNAME: xml(hostnameFrom(settings.publicUrl, settings.hostname)),
        MOUNT: xml(settings.mount),
        STREAM_NAME: xml(settings.title),
        STREAM_DESCRIPTION: xml(settings.description),
        STREAM_GENRE: xml(settings.genre),
        STREAM_URL: xml(settings.publicUrl),
    };
    // An unknown token is left as written rather than blanked: a typo in the template
    // should be visible in the rendered file, not silently become an empty password.
    const icecastXml = template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => tokens[key] ?? whole);

    const radioEnv =
        [
            `ICECAST_HOST=${shell(settings.icecastHost)}`,
            `ICECAST_PORT=${shell(settings.icecastPort)}`,
            `ICECAST_SOURCE_PASSWORD=${shell(sourcePassword)}`,
            `STREAM_MOUNT=${shell(settings.mount)}`,
            `STREAM_BITRATE=${shell(settings.bitrate)}`,
            `STREAM_NAME=${shell(settings.title)}`,
            `STREAM_DESCRIPTION=${shell(settings.description)}`,
            `STREAM_GENRE=${shell(settings.genre)}`,
            `STREAM_URL=${shell(settings.publicUrl)}`,
            `MUSIC_DIR=${shell(musicDir)}`,
            // The harbor is the DJ voice input. Nothing pushes to it yet, but radio.liq
            // opens the mount regardless, so it gets the seeded password rather than the
            // committed dev default.
            `HARBOR_PORT=${shell(harborPort)}`,
            `HARBOR_PASSWORD=${shell(settings.harborPassword ?? '')}`,
            // Materialized here rather than set on the container so the track shim inherits
            // it from the entrypoint's `set -a; . radio.env`, and the app validates the
            // header against the same stored value. One source of truth, no compose env.
            `SPOTIFY_SHIM_SECRET=${shell(settings.spotifyShimSecret ?? '')}`,
            // The playout bridge. The app pushes items to /control/*, which is gated on this
            // secret; AIRED_URL is the other direction, since an item is pushed and
            // downloaded one item AHEAD of air and only Liquidsoap knows when it started.
            `PLAYOUT_AIRED_URL=${shell(playout.playoutAiredUrl)}`,
            `PLAYOUT_BRIDGE_SECRET=${shell(playout.playoutBridgeSecret)}`,
            // The dead-man switch. Liquidsoap airs nothing unless the app is renewing its
            // claim inside this window, so the two ends have to agree: this is written from
            // the same constant the pusher renews against.
            `CONTROL_TTL_S=${shell(String(playout.controlTtlS))}`,
            // How deep Liquidsoap fetches ahead. Written from the same constant as the
            // app's push lead: handing over more than the queue resolves leaves items
            // unfetched, which is the one state a skip cannot land in.
            `PLAYOUT_PREFETCH=${shell(String(playout.playoutPrefetch))}`,
            // The duck. Read at Liquidsoap startup, so changing these re-renders the file
            // and takes effect on the next restart.
            `TALK_OVER_TRACKS=${shell(playout.talkOverTracks ? 'true' : 'false')}`,
            `DUCK_GAIN_DB=${shell(String(playout.duckGainDb))}`,
            `DUCK_FADE_MS=${shell(String(playout.duckFadeMs))}`,
        ].join('\n') + '\n';

    try {
        mkdirSync(configDir, { recursive: true });
        // 0644: these hold secrets, but they live on a private volume shared with trusted
        // containers whose uids differ, so they have to be readable by them.
        writeFileSync(join(configDir, 'icecast.xml'), icecastXml, { mode: 0o644 });
        writeFileSync(join(configDir, 'radio.env'), radioEnv, { mode: 0o644 });
    } catch (error) {
        log(`could not write to ${configDir} (${errorText(error)}); skipping`);
        return false;
    }

    log(`wrote icecast.xml + radio.env to ${configDir} (mount ${settings.mount}, ${settings.bitrate}k)`);
    return true;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
