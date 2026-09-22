import { HLS_PLAYLIST_PATH, type StreamMount } from './stream.settings.js';

/**
 * The station's streams as a playlist FILE, for the players that take one rather than an address.
 *
 * A hardware radio, a car receiver and most desktop players are pointed at a `.pls` or an `.m3u`,
 * not at a stream URL, and nobody types a stream URL into a car. These answer `/listen.pls` and
 * `/listen.m3u` at the station's public address.
 *
 * ## The public address, and never the internal one
 *
 * Every entry is absolute and built from the station's PUBLIC origin (`resolvePublicUrl`), because a
 * relative path means nothing to a file saved onto a device, and the other address the station knows,
 * `stream.icecastHost`, is the compose service name: right for Liquidsoap and unreachable for anybody
 * else. A station with no public address gets no file at all, which is the caller's 404.
 *
 * ## What each lists
 *
 * Every Icecast mount the station publishes, MP3 first because it is the one every player takes.
 * The `.m3u` also lists the HLS stream when it is on, since an M3U-reading player is often one that
 * can follow it; the `.pls` does not, because the players that read PLS are the ones that cannot.
 *
 * Pure, so the two formats are tested as text rather than through a route.
 */

/** What a player shows for one entry: the station's name and the format. */
const titleFor = (station: string, label: string): string => `${station} (${label})`;

/** How a mount is described in a playlist a person will pick from. */
const labelFor = (mount: StreamMount): string => {
    const format = mount.format.toUpperCase();
    return mount.bitrateKbps === undefined ? format : `${format} ${mount.bitrateKbps} kbps`;
};

/** A title with no line breaks, which both formats would read as the end of an entry. */
const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();

/**
 * The PLS file. Version 2, with `Length` -1 for a stream that never ends, as the format asks.
 *
 * @param origin - The public origin with no trailing slash, already checked to be non-empty.
 */
export function tuneInPls(origin: string, station: string, mounts: readonly StreamMount[]): string {
    const lines = ['[playlist]'];
    mounts.forEach((mount, index) => {
        const n = index + 1;
        lines.push(`File${n}=${origin}${mount.path}`, `Title${n}=${oneLine(titleFor(station, labelFor(mount)))}`, `Length${n}=-1`);
    });
    lines.push(`NumberOfEntries=${mounts.length}`, 'Version=2');

    return `${lines.join('\n')}\n`;
}

/**
 * The extended M3U file, with the HLS stream after the mounts when it is on.
 *
 * @param origin - The public origin with no trailing slash, already checked to be non-empty.
 */
export function tuneInM3u(origin: string, station: string, mounts: readonly StreamMount[], hls: boolean): string {
    const entries = mounts.map(mount => ({ title: titleFor(station, labelFor(mount)), url: `${origin}${mount.path}` }));
    if (hls) entries.push({ title: titleFor(station, 'HLS'), url: `${origin}${HLS_PLAYLIST_PATH}` });

    return `${['#EXTM3U', ...entries.flatMap(entry => [`#EXTINF:-1,${oneLine(entry.title)}`, entry.url])].join('\n')}\n`;
}
