import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type StreamMount, type StreamSettings, bytesPerSecond, MOUNT_PATHS, streamMounts } from './stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';

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
 *
 * A render says what is ON DISK, not what was written, and that distinction is
 * load-bearing rather than tidy: both containers read their file once at
 * startup, so the only question anybody downstream asks is "is the process
 * older than the file it was configured from", and a render that rewrote
 * identical bytes on every boot would answer yes forever. See
 * {@link writeIfChanged} and `stream.staleness.ts`.
 */

/** Repo root's `stream/` assets. `process.cwd()` is `apps/api` at runtime. */
export function defaultStreamAssetsDir(): string {
    return join(process.cwd(), '..', '..', 'stream');
}

/** The shared volume the stream containers read their rendered config from. */
export function defaultStreamConfigDir(): string {
    return join(process.cwd(), '..', '..', '.docvol', 'streamconfig');
}

/**
 * Where Liquidsoap writes its HLS segments and playlists, as this app sees them.
 *
 * A volume Liquidsoap writes and both nginx and this app READ, which is the whole
 * arrangement: nginx serves the segments straight off it because they are the bytes,
 * and the app serves the playlists off it because a playlist request is the only
 * evidence there is that somebody is listening. See `hls.audience.ts`.
 */
export function defaultStreamHlsDir(): string {
    return join(process.cwd(), '..', '..', '.docvol', 'streamhls');
}

/** Escape a value for XML text or attribute content. */
function xml(value: string): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Single-quote a value for a shell-sourced env file. */
function shell(value: string): string {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * How much slow-client tolerance a mount gets, in seconds of its own audio.
 *
 * The number the old byte literal happened to be worth at 128 kbps was ~32s, which
 * was generous and never a complaint; 20 is the same order and rounder. What matters
 * is that it is stated in SECONDS somewhere, because the config field is bytes and
 * that is the whole trap.
 */
const QUEUE_SECONDS = 20;

/** How much audio a listener is handed on connect, in seconds. This is latency; see the template. */
const BURST_SECONDS = 0.5;

/**
 * The Icecast buffer sizes for a set of mounts, in the bytes Icecast wants.
 *
 * The queue takes the HIGHEST enabled bitrate because it is one global number and has
 * to be big enough for the hungriest mount. The burst takes the MP3 mount's alone
 * because it is backlog every listener pays for, and a mount that needs more says so
 * in its own block.
 *
 * Never smaller than what a 128 kbps station used to get, so switching a format on can
 * only ever make these roomier. A station that changes nothing renders the same
 * numbers it always did, which is also what keeps the config generation stable.
 */
export function bufferSizes(mounts: StreamMount[]): { queue: number; burst: number } {
    const hungriest = Math.max(...mounts.map(bytesPerSecond));
    const primary = bytesPerSecond(mounts[0] ?? { format: 'mp3', path: '', bitrateKbps: 128 });

    return {
        queue: Math.max(524_288, Math.ceil(hungriest * QUEUE_SECONDS)),
        burst: Math.max(8_192, Math.ceil(primary * BURST_SECONDS)),
    };
}

/**
 * The `<mount>` blocks for every format beside MP3, or an empty string when there are
 * none.
 *
 * Self-contained on purpose, credentials included: see the comment this renders under
 * in `icecast.xml.tmpl` for why inheriting them through `<mount type="default">` was
 * tried and rejected.
 *
 * A mount whose own bitrate makes the global burst too SHORT in time gets its own,
 * which in practice means FLAC: 8192 bytes is half a second at 128 kbps and seven
 * hundredths of one at 900, and below about a tenth of a second players start raggedly.
 */
function extraMountBlocks(mounts: StreamMount[], sourcePassword: string, globalBurst: number): string {
    return mounts
        .slice(1)
        .map(mount => {
            const own = Math.ceil(bytesPerSecond(mount) * BURST_SECONDS);
            const burst = own > globalBurst ? `\n    <burst-size>${own}</burst-size>` : '';

            return [
                `  <mount type="normal">`,
                `    <mount-name>${xml(mount.path)}</mount-name>`,
                `    <username>source</username>`,
                `    <password>${xml(sourcePassword)}</password>`,
                `    <public>0</public>${burst}`,
                `  </mount>`,
            ].join('\n');
        })
        .join('\n\n');
}

/**
 * Hostname Icecast advertises: the configured one, else the public URL's, else localhost.
 *
 * The explicit setting first, which is what both settings' help text has always promised. It was
 * the other way round, so an operator who filled in both got the public URL's hostname and a field
 * that was silently ignored.
 */
function hostnameFrom(publicUrl: string, hostname: string): string {
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
     * App endpoint Liquidsoap reports a queue that stopped producing to, and one
     * that started again.
     *
     * Empty means "do not report": the script simply skips the call, the same
     * way it handles an unset aired URL. So a stream pointed at an app too old to
     * serve the route degrades to the two-second reconcile rather than logging a
     * 404 per gap.
     */
    playoutStarveUrl: string;
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
     * Trim on the DJ voice, in dB, applied after the mic chain in `radio.liq`.
     *
     * Zero leaves the chain's own compressor and the renderer's level as they
     * are, which is not the neutral it sounds like: that chain has no makeup
     * gain, so zero airs a break at whatever the engine produced. It exists
     * because the speech engine is a plugin and a replacement is expected, so an
     * engine that runs consistently hot or quiet needs a correction that is not
     * a code change to the mixer. See `VOICE_GAIN_DB` in `stream.service.ts` for
     * what the bundled one measures and why the default is +10.
     */
    voiceGainDb: number;
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

/**
 * One rendered file, as it stands on the volume after a render.
 *
 * `changedAt` is the moment its CONTENT last changed, which is what a container's
 * start time has to be compared against. `stamp` identifies that content, and is
 * the thing Liquidsoap reports back so the comparison does not have to rest on
 * two clocks agreeing.
 */
export interface RenderedFile {
    path: string;
    /** Short content hash. See {@link stampOf}. */
    stamp: string;
    /** Unix epoch millis of the file's mtime, which is when the content last changed. */
    changedAt: number;
}

/** What a render put on the volume: one entry per file the containers read. */
export interface StreamConfigRender {
    icecast: RenderedFile;
    radio: RenderedFile;
}

/**
 * A short content hash, used as the config generation both halves are compared
 * on.
 *
 * Content rather than a timestamp or a counter, because the question it answers
 * is "is the running process configured from these bytes" and an app that
 * restarts twice an hour re-renders byte-identical files every time. A stamp
 * that moved on each render would report every app restart as container drift,
 * which is a warning an operator learns to ignore — and the one warning that
 * matters here is the one they have never seen before.
 *
 * Twelve hex characters. It is compared for equality by machines and read aloud
 * in log lines by people, and it is not defending against anyone choosing a
 * collision.
 */
export function stampOf(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Write a file only when its content differs, and never leave a partial one
 * behind.
 *
 * **The skip is the point, not an optimization.** `writeFileSync` moves the
 * mtime whether or not anything changed, and the mtime is the evidence that
 * `stream.staleness.ts` compares a container's start time against — so a render
 * that always wrote would make every boot look like a config change nobody had
 * adopted, and there would be no way left to see a real one.
 *
 * **The rename is the point too.** A plain write truncates and then fills, so
 * there is a window in which the file on the volume is short. Nothing in this
 * process reads it, but both containers do — and `set -a; . radio.env` on a
 * truncated file is silent: the shell takes the variables that made it and
 * simply does not define the rest, so Liquidsoap comes up with a source password
 * and no bridge secret and nothing anywhere says why. That window is reachable
 * at boot by a container starting into a render, and reachable on purpose by
 * anything watching this file for changes. Writing beside the file and renaming
 * over it closes it: a rename within one directory is atomic, so a reader sees
 * either the whole old file or the whole new one.
 *
 * The temporary carries the pid rather than a counter, because a second render
 * cannot interleave with this one inside a process — there is no `await` here,
 * and the runtime is single-threaded — while two app instances rendering onto
 * the same volume genuinely can. Reusing one name per process also means a crash
 * mid-write leaves one stale file rather than one per attempt.
 */
function writeIfChanged(path: string, content: string, mode: number, stamp = stampOf(content)): RenderedFile {
    let existing: string | undefined;
    try {
        existing = readFileSync(path, 'utf8');
    } catch {
        // Not there yet, or unreadable. Either way: write it.
    }

    if (existing !== content) {
        // Beside the target, so the rename stays within one filesystem. A temporary in
        // the OS temp dir would be a cross-device rename, which fails outright on some
        // hosts and degrades to a copy on others — putting back the window this closes.
        const temporary = `${path}.${process.pid}.tmp`;
        writeFileSync(temporary, content, { mode });
        renameSync(temporary, path);
    } else if ((statSync(path).mode & 0o777) !== mode) {
        // The content is what it should be and the permissions are not, which is what a
        // station moving between deployments looks like: nothing about the settings changed,
        // so the branch above will never run again and the old mode would stand for good.
        // `chmod` moves ctime and leaves mtime alone, so this cannot be mistaken for a render
        // by the staleness check that watches this file.
        chmodSync(path, mode);
    }

    return { path, stamp, changedAt: statSync(path).mtimeMs };
}

/**
 * A file mode written as octal, or `undefined` when it is not one.
 *
 * Octal because that is how anyone writing one thinks of it, and because `0640` read as
 * decimal is a mode nobody meant. Every layer of the config holds strings, so this arrives
 * as text however numeric it looks — and a value that is not a mode is answered as
 * `undefined` rather than as the default, so the caller can say so instead of quietly
 * leaving a file more readable than the operator asked for.
 */
export function parseFileMode(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (!/^0?[0-7]{3}$/.test(trimmed)) return undefined;

    return parseInt(trimmed, 8);
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
    /**
     * Where Liquidsoap writes HLS segments, as the STREAM CONTAINER sees it.
     *
     * Deliberately not `defaultStreamHlsDir()`, which is where this app reads them
     * from: they are the same volume at two mount points, and rendering the app's own
     * path into the container's config is the mistake this parameter exists to make
     * impossible.
     */
    hlsDir?: string;
    adminEmail?: string;
    /**
     * The mode the rendered files are left with. Defaults to `0o644`.
     *
     * They hold the stream's passwords, so the mode anyone would pick is the narrow one —
     * but who has to READ them is a property of the deployment rather than of the station.
     * Where the parts run as separate containers they share only the volume, and the uid
     * each one runs as is decided by an image this project does not build; where they run
     * as one, they are all the same user and nothing outside it needs the file at all. So
     * the default is the permissive one that works everywhere, and the deployment that can
     * prove it is narrower says so.
     */
    configMode?: number;
    log?: (message: string) => void;
}

/**
 * Render `icecast.xml` and `radio.env` from the resolved settings.
 *
 * @returns what stands on the volume afterwards, or `undefined` when the render
 * was skipped and whatever was there before still stands.
 */
export function writeStreamConfig({
    settings,
    playout,
    assetsDir = defaultStreamAssetsDir(),
    configDir = defaultStreamConfigDir(),
    musicDir = '/music',
    harborPort = '8005',
    hlsDir = '/streamhls',
    adminEmail = 'admin@localhost',
    configMode = 0o644,
    log = () => {},
}: WriteStreamConfigArgs): StreamConfigRender | undefined {
    const { sourcePassword, adminPassword } = settings;
    if (!sourcePassword || !adminPassword) {
        // Only reachable when a row was deleted by hand since boot: `ensureStreamSecrets` seeds
        // both at startup, and nothing the console offers can clear one.
        log('not configured (no stream.sourcePassword or stream.adminPassword stored; a restart seeds any that are missing); skipping config');
        return undefined;
    }

    const templatePath = join(assetsDir, 'icecast.xml.tmpl');
    let template: string;
    try {
        template = readFileSync(templatePath, 'utf8');
    } catch (error) {
        log(`icecast template missing at ${templatePath} (${errorText(error)}); skipping`);
        return undefined;
    }

    // Every mount the station publishes, MP3 first. Derived once and used for all three
    // of the things this function decides — the `<mount>` blocks, the buffer sizes and
    // the encoder switches in radio.env — so they cannot come to disagree about which
    // mounts exist.
    const mounts = streamMounts(settings);
    const { queue, burst } = bufferSizes(mounts);

    const tokens: Record<string, string> = {
        QUEUE_SIZE: String(queue),
        BURST_SIZE: String(burst),
        EXTRA_MOUNTS: extraMountBlocks(mounts, sourcePassword, burst),
        SOURCE_PASSWORD: xml(sourcePassword),
        RELAY_PASSWORD: xml(sourcePassword),
        ADMIN_PASSWORD: xml(adminPassword),
        ADMIN_EMAIL: xml(adminEmail),
        HOSTNAME: xml(hostnameFrom(settings.publicUrl, settings.hostname)),
        MOUNT: xml(MOUNT_PATHS.mp3),
        STREAM_NAME: xml(settings.title),
        STREAM_DESCRIPTION: xml(settings.description),
        STREAM_GENRE: xml(settings.genre),
        STREAM_URL: xml(settings.publicUrl),
        LOCATION: settings.location ? `  <location>${xml(settings.location)}</location>\n` : '',
    };
    // An unknown token is left as written rather than blanked: a typo in the template
    // should be visible in the rendered file, not silently become an empty password.
    const icecastXml = template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => tokens[key] ?? whole);

    const radioBody =
        [
            `ICECAST_HOST=${shell(settings.icecastHost)}`,
            `ICECAST_PORT=${shell(settings.icecastPort)}`,
            `ICECAST_SOURCE_PASSWORD=${shell(sourcePassword)}`,
            `STREAM_MOUNT=${shell(MOUNT_PATHS.mp3)}`,
            `STREAM_BITRATE=${shell(settings.bitrate)}`,
            // The optional format mounts, as a fixed pair each that radio.liq reads at startup.
            //
            // An EMPTY PATH is how "off" is spelled, rather than a separate enable flag beside
            // it. The two could disagree, and the one that would win is not the one an operator
            // reading this file would expect: a mount with no path is a mount that cannot be
            // published whatever a flag says.
            //
            // The path is written out rather than derived on the far side. The derivation is a
            // string operation on a setting, and doing it twice in two languages is how the app
            // comes to be counting listeners on a mount Liquidsoap called something else.
            //
            // All three pairs, in a fixed order, whether or not any is on. Two reasons and both
            // have bitten: a key that appears only when it is non-default is a key an operator
            // cannot find when they go looking for why their mount is not there, and a key ORDER
            // that moves with the settings changes the config stamp — which is the hash the
            // staleness check compares a running container against — for a station that turned
            // one format off and another on and is running exactly what it was.
            // The HLS output. `STREAM_HLS_DIR` is the path INSIDE the stream container, which
            // is not the one this app reads its playlists from: the two see the same volume at
            // different mount points, so this is a parameter rather than the app's own path.
            //
            // Off is spelled as an empty directory, on the same rule as an optional mount's
            // empty path: a writer with nowhere to write is not a writer, and a flag that
            // could disagree with the path would have the path win anyway.
            `STREAM_HLS_DIR=${shell(settings.hlsEnabled ? hlsDir : '')}`,
            `STREAM_HLS_SEGMENT_SECONDS=${shell(String(settings.hlsSegmentSeconds))}`,
            `STREAM_HLS_SEGMENT_COUNT=${shell(String(settings.hlsSegmentCount))}`,
            ...(['opus', 'aac', 'flac'] as const).flatMap(format => {
                const mount = mounts.find(candidate => candidate.format === format);
                const name = format.toUpperCase();
                return [`STREAM_MOUNT_${name}=${shell(mount?.path ?? '')}`, `STREAM_${name}_BITRATE=${shell(String(mount?.bitrateKbps ?? ''))}`];
            }),
            `STREAM_NAME=${shell(settings.title)}`,
            `STREAM_DESCRIPTION=${shell(settings.description)}`,
            `STREAM_GENRE=${shell(settings.genre)}`,
            `STREAM_URL=${shell(settings.publicUrl)}`,
            // Icecast learns the stream's language only from the Content-Language header
            // the source sends, so this reaches it through radio.liq rather than through
            // icecast.xml. Empty means the header is not sent at all.
            `STREAM_LANGUAGE=${shell(settings.language)}`,
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
            // The other push: a queue that stopped producing while the lease was held, which the
            // app cannot see for itself between reconciles.
            `PLAYOUT_STARVE_URL=${shell(playout.playoutStarveUrl)}`,
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
            // The voice trim, read at startup with the duck. Written unconditionally, even at
            // zero, because `radio.liq` tolerates an unset or empty value and a key that appears
            // only when it is non-default is a key an operator cannot find in the rendered file.
            `VOICE_GAIN_DB=${shell(String(playout.voiceGainDb))}`,
        ].join('\n') + '\n';

    // The generation of the file, carried IN the file, so the process that sourced it
    // can say which one it booted with. Appended after the hash rather than folded into
    // it for the obvious reason: a stamp over content that includes the stamp has no
    // fixed point. `radio.liq` reports it back on every `/control/*` reading and the
    // Spotify shim inherits it from the same `set -a`, so one value covers both
    // processes the entrypoint starts.
    const radioStamp = stampOf(radioBody);
    const radioEnv = `${radioBody}CONFIG_STAMP=${shell(radioStamp)}\n`;

    let render: StreamConfigRender;
    try {
        mkdirSync(configDir, { recursive: true });
        render = {
            icecast: writeIfChanged(join(configDir, 'icecast.xml'), icecastXml, configMode),
            // The body's stamp, not the file's: this is the value the file CARRIES and the
            // value Liquidsoap reports back, and the comparison is between those two. A
            // render whose recorded stamp was the hash of the whole file would never match
            // the running container, however fresh it was.
            radio: writeIfChanged(join(configDir, 'radio.env'), radioEnv, configMode, radioStamp),
        };
    } catch (error) {
        log(`could not write to ${configDir} (${errorText(error)}); skipping`);
        return undefined;
    }

    const served = mounts.map(mount => `${mount.path}${mount.bitrateKbps === undefined ? '' : ` ${mount.bitrateKbps}k`}`).join(', ');
    log(`rendered icecast.xml + radio.env to ${configDir} (${served}; queue ${queue}B, burst ${burst}B; generation ${render.radio.stamp})`);
    return render;
}
