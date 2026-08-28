import { join } from 'node:path';

/**
 * Turning a requested playlist name into a path, or refusing to.
 *
 * `GET /hls/{name}` is anonymous — an HLS player carries no session and this is the
 * station's public output — and it reads a file from a directory by the name it was
 * given. That combination is worth one small function with its own tests rather than
 * three lines inside a service method.
 *
 * **The name is validated, never sanitised.** A rejected name is refused outright
 * instead of having its separators stripped or being normalised into the directory,
 * because sanitising is a guess about what the caller meant and every interesting bug
 * in this shape of code is a guess that was wrong. Nothing here has to interpret a
 * name: Liquidsoap writes flat filenames into one directory, so a name that is not a
 * flat filename is not a playlist this station has.
 */

/**
 * What counts as a playlist name.
 *
 * A bare `*.m3u8`, anchored at both ends, with no separator in the character class and
 * no dot permitted as the first character. So `..`, `../x.m3u8`, `/etc/x.m3u8`,
 * `a/b.m3u8` and a bare `.m3u8` are all refused before anything is joined to a
 * directory, rather than joined first and normalised afterwards.
 */
export const HLS_PLAYLIST_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.m3u8$/;

/**
 * The file this name refers to, or `undefined` when it does not refer to one.
 *
 * `undefined` rather than a thrown error, so the caller answers the same 404 it
 * answers for a playlist that simply is not there. A caller trying it on learns
 * nothing from being told they were caught, and a player asking for something absent
 * wants the same answer either way.
 */
export function hlsPlaylistPath(dir: string, name: string): string | undefined {
    return HLS_PLAYLIST_NAME.test(name) ? join(dir, name) : undefined;
}
