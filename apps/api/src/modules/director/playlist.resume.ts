/**
 * Where a slot that resumes its playlist picks it up.
 *
 * A playlist slot airs its playlist in the playlist's own order, and the whole of it is read each time
 * the block opens. Without this, a long playlist on a short recurring slot airs its first hour every
 * night and never the rest, and an operator's takeover ending inside the block opens it a second time
 * and starts it over. A slot that resumes keeps one fact beside it (migration 0102): the song key of the
 * last record from its playlist that aired. Its next opening starts with the record after that one.
 *
 * Pure, so the opening and the console's preview of it cannot disagree about which record is next.
 */

import { songKey } from './rotation.keys.js';

/**
 * The key a record from a slot's playlist is remembered by.
 *
 * The song key play history writes for the same record (`PlayHistoryRepository.record`), title and lead
 * artist, so the key written on the aired edge and the one looked for at the next opening are the same
 * string for the same record. A key rather than a position, because a provider's playlist has no
 * stable row position: a record added near the top moves every position after it.
 */
export const playlistKeyOf = (track: { title: string; artist: string }): string => songKey(track.title, [track.artist]);

/**
 * Where in `tracks` a slot resuming after `lastKey` starts: the index just after that record.
 *
 * `0`, the top, when nothing has aired yet, when the record is no longer on the playlist (it was
 * removed, or the station's rules now pass it over), and when it was the last record, since a playlist
 * that has aired to its end starts again.
 */
export function resumeIndex(tracks: readonly { title: string; artist: string }[], lastKey: string | undefined): number {
    if (lastKey === undefined) return 0;

    const at = tracks.findIndex(track => playlistKeyOf(track) === lastKey);
    return at < 0 ? 0 : (at + 1) % tracks.length;
}

/**
 * The playlist turned round so it starts after `lastKey`, with what came before it moved to the end.
 *
 * Rotated rather than cut, so a block long enough to reach the end of the playlist carries on into its
 * beginning exactly as it did before anything resumed, and every record still airs once per pass.
 */
export function resumeAfter<T extends { title: string; artist: string }>(tracks: readonly T[], lastKey: string | undefined): T[] {
    const from = resumeIndex(tracks, lastKey);
    return [...tracks.slice(from), ...tracks.slice(0, from)];
}
