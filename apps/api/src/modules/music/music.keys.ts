/**
 * The fuzzy match keys the catalog schema declares — `artists.artist_key`,
 * `albums.name_key`, `tracks.title_key` — and the last rung of the resolution
 * ladder described at the top of `0004_music.sql`. Ingest reaches these only
 * after an mbid and (for tracks) an isrc have both failed to identify the item.
 *
 * The job is to make two spellings of the same name collide: "Beyoncé" and
 * "Beyonce", "Sigur Rós" and "Sigur Ros", "Don't Stop Me Now" and "Dont Stop Me
 * Now". Decomposing to NFKD and dropping the combining marks handles accents;
 * dropping every remaining non-alphanumeric handles punctuation and the
 * typographic apostrophes providers mix freely with ASCII ones.
 *
 * It is deliberately NOT a similarity metric. It normalizes spelling, nothing
 * more: "The Beatles" and "Beatles" are different keys, and so are a track and
 * its remaster. Merging those is a judgement call, which is what
 * `merged_into_id` exists to record — a key collision must stay something the
 * resolver can trust outright.
 */

/**
 * Latin letters NFKD leaves alone, because they are letters in their own right
 * rather than a base plus an accent. Unhandled, each would be dropped as
 * non-alphanumeric and *split its word in two* — "Sæglópur" keying as
 * "s glopur", which no spelling of it ever reaches again.
 *
 * Each maps to the sequence people actually type when they cannot type the
 * letter, which is the whole point: "Sæglópur" and "Saeglopur" have to collide,
 * as do "Sigur Rós"/"Sigur Ros" (that pair NFKD already handles).
 */
const LATIN_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
    [/æ/g, 'ae'],
    [/œ/g, 'oe'],
    [/ø/g, 'o'],
    [/ß/g, 'ss'],
    [/đ|ð/g, 'd'],
    [/ł/g, 'l'],
    [/þ/g, 'th'],
    [/ı/g, 'i'],
];

/** Combining marks left behind by NFKD, i.e. the accents themselves. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Everything that is not a lowercase letter, a digit, or a space. */
const NON_ALPHANUMERIC = /[^a-z0-9 ]/g;

const WHITESPACE_RUN = /\s+/g;

/**
 * The comparison key for a name or title. Returns an empty string for input
 * that normalizes to nothing (whitespace, punctuation, or a title written
 * entirely in a script this drops); callers decide whether that is usable —
 * `artist_key` is `not null unique`, so an empty key would collide every
 * unnameable artist into one row.
 *
 * @param value - Raw provider-supplied name or title.
 * @returns Lowercase, unaccented, alphanumeric-and-single-spaces, trimmed.
 */
export const normalizeKey = (value: string): string => {
    let key = value.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
    // After lowercasing, so both the table and the class below only have to
    // name lowercase forms.
    for (const [letter, replacement] of LATIN_LETTERS) key = key.replace(letter, replacement);
    return key.replace(NON_ALPHANUMERIC, ' ').replace(WHITESPACE_RUN, ' ').trim();
};
