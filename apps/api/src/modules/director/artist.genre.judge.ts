import { createHash } from 'node:crypto';
import type { LlmMessage } from '@deadair/plugin-sdk';
import { firstJsonObject } from '#modules/shared/json.objects.js';

/**
 * A band's main genre, as the station's model names it for a band its enrichment gives none.
 *
 * Pure: the prompt, the parse and the version. The walk that runs it is `ArtistGenreService`.
 *
 * Asked for ONE genre, the one most listeners would file the band under, because that is what a mix
 * flow reads: the first genre a provider lists. Lower case and a few words, since `refinesGenre` matches
 * by words and "Norwegian black metal" is black metal to it.
 */

const SYSTEM = [
    'You name the main genre of a band or artist, the way a record shop or Last.fm would file them.',
    'Answer with ONE genre in lower case, a few words at most, such as "black metal", "synth-pop" or "gospel".',
    'Use the genre most listeners would give them, not a rare sub-style and not a whole family like "music".',
    'If you do not know who they are, say so rather than guessing.',
    '',
    'Answer with a JSON object and nothing else: {"genre": "..."} or {"unknown": true}.',
].join('\n');

/** Changes when the instructions do, so every band is asked again under the new ones. */
export const ARTIST_GENRE_VERSION = createHash('sha256').update(SYSTEM).digest('hex').slice(0, 12);

export interface GenreSubject {
    artist: string;
    /** A few of the band's record titles the library holds, to tell two acts of one name apart. */
    titles: readonly string[];
}

export function artistGenrePrompt(subject: GenreSubject, canSearch: boolean): LlmMessage[] {
    const lines = [`The artist is ${subject.artist}.`];
    if (subject.titles.length > 0) lines.push(`Records of theirs: ${subject.titles.map(title => `"${title}"`).join(', ')}.`);
    if (canSearch) lines.push('', 'You can search the web for who they are before you answer.');
    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: lines.join('\n') },
    ];
}

/** The genre, `unknown` for a band the model could not place, or `undefined` for an answer that is neither. */
export function readArtistGenre(answer: string): string | 'unknown' | undefined {
    const parsed = firstJsonObject(answer);
    if (parsed === undefined) return undefined;
    if (parsed.unknown === true) return 'unknown';
    if (typeof parsed.genre !== 'string') return undefined;
    const genre = parsed.genre.trim().toLowerCase().replace(/\s+/g, ' ');
    return genre.length === 0 || genre.length > 100 ? undefined : genre;
}
