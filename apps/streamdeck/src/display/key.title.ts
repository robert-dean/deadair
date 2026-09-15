import type { PlayoutItem } from '@deadair/sdk';

/**
 * About how many characters of the Stream Deck's own title font fit across a key at the size the
 * manifest asks for. Measured by eye, not by metrics: the font is the app's, not ours.
 */
export const LINE_CHARACTERS = 11;

/**
 * One line of a key's title: the text if it fits, or as much as fits and an ellipsis.
 *
 * Counted in code points rather than UTF-16 units, so a title that starts with an emoji or is written
 * in a script outside the Basic Multilingual Plane is cut between characters rather than through one.
 */
export function fitLine(text: string, width = LINE_CHARACTERS): string {
    const characters = [...text.trim().replace(/\s+/g, ' ')];
    if (characters.length <= width) return characters.join('');
    return `${characters
        .slice(0, width - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * What the Now Playing key says under its cover: the title, then who it is by.
 *
 * Two lines, because a third covers most of the cover on a key this size, and the time left is the
 * bar's job rather than the title's. A break has no artist, so it has one line.
 */
export function nowPlayingTitle(item: PlayoutItem): string {
    const artists = item.artists.join(', ');
    return artists === '' ? fitLine(item.title) : `${fitLine(item.title)}\n${fitLine(artists)}`;
}
