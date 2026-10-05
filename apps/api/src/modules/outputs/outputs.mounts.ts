import type { AppConfig } from '@maroonedsoftware/appconfig';
import {
    HLS_PLAYLIST_PATH,
    STREAM_KEYS,
    resolveMountSettings,
    resolvePublicUrl,
    stationOrigin,
    streamMounts,
} from '#modules/stream/stream.settings.js';
import type { OutputMount } from './types/outputs.types.js';

type MountFormat = OutputMount['format'];

/**
 * What each mount is, as a content type a speaker can be asked about.
 *
 * Both Ogg mounts carry their codec as a parameter, because "plays Ogg" says nothing useful: a
 * speaker that takes Ogg Vorbis may take neither Opus nor FLAC in it. A speaker that lists the bare
 * `audio/ogg` is taken at its word for both (see {@link acceptsType}).
 */
export const MOUNT_CONTENT_TYPES: Readonly<Record<MountFormat, string>> = {
    mp3: 'audio/mpeg',
    aac: 'audio/aac',
    opus: 'audio/ogg; codecs=opus',
    flac: 'audio/ogg; codecs=flac',
    hls: 'application/vnd.apple.mpegurl',
};

/**
 * Every mount this station publishes right now, MP3 first, HLS last.
 *
 * Through `streamMounts` for the reason everything that lists mounts goes through it: it is the one
 * answer to which mounts exist. HLS is appended the way `/nowplaying` appends it, not being an
 * Icecast mount.
 */
export function stationMounts(config: AppConfig): OutputMount[] {
    const settings = resolveMountSettings(config);
    const mounts: OutputMount[] = streamMounts(settings).map(mount => ({ format: mount.format, path: mount.path }));
    if (settings.hlsEnabled) mounts.push({ format: 'hls', path: HLS_PLAYLIST_PATH });
    return mounts;
}

/**
 * Whether a speaker that says it takes `accepted` can play `contentType`: the same type, or a bare
 * type with no parameters that matches the mount's own before its parameters.
 */
export function acceptsType(accepted: readonly string[], contentType: string): boolean {
    const base = contentType.split(';')[0]!.trim().toLowerCase();
    return accepted.some(entry => {
        const wanted = entry.trim().toLowerCase();
        return wanted === contentType.toLowerCase() || (!wanted.includes(';') && wanted === base);
    });
}

/** The station's mounts a speaker can play, in the station's order: MP3 first wherever it takes MP3. */
export function mountsFor(accepted: readonly string[], mounts: readonly OutputMount[]): OutputMount[] {
    return mounts.filter(mount => acceptsType(accepted, MOUNT_CONTENT_TYPES[mount.format]));
}

/**
 * The absolute URL a speaker is handed for a mount, or `undefined` when the station has no address
 * a speaker could reach.
 *
 * `stream.speakerUrl` when the operator set one, else the station's PUBLIC address, and never the
 * stream server's own: a speaker is somewhere else on the network, and `localhost` there is the
 * speaker. An empty address, and a loopback one, both answer `undefined` rather than a URL that
 * would leave the speaker silent with nothing to say why. A loopback speaker address does not fall
 * back to the public one: the operator named an address, and quietly using another is how a speaker
 * ends up on the wrong one with nothing in the console saying so.
 */
export function mountUrl(config: AppConfig, path: string): string | undefined {
    const speaker = stationOrigin(config.get(STREAM_KEYS.speakerUrl, ''));
    const origin = speaker === '' ? resolvePublicUrl(config) : speaker;
    if (origin === '') return undefined;

    let hostname: string;
    try {
        hostname = new URL(origin).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    if (isLoopback(hostname)) return undefined;

    return `${origin}${path}`;
}

function isLoopback(hostname: string): boolean {
    return (
        hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.startsWith('127.') || hostname === '[::1]' || hostname === '0.0.0.0'
    );
}
