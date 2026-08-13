/**
 * Comparison forms for matching a title or artist name across two sources
 * that never spell either one the same way: a personal library's tags, a
 * provider's catalog, and MusicBrainz's own recording titles all disagree on
 * case, accents, punctuation, and which decorations belong on a title at all.
 *
 * Both `normalize` and `baseForm` were defined identically in more than one
 * plugin, because both feed match SCORING: a difference between the copies
 * would silently make two plugins match the same input differently.
 */

/** Everything that is decoration rather than identity once a string is lowercased. */
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

/** A parenthesised or bracketed suffix: `(2011 Remaster)`, `[Live]`. */
const PARENTHETICAL = /[([{][^)\]}]*[)\]}]/g;

/**
 * Comparison form: lowercased, unaccented, stripped of punctuation, with runs
 * of whitespace collapsed. `Beyoncé` and `Beyonce`, `Mr. Brightside` and
 * `Mr Brightside` are the same string here.
 */
export function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(PUNCTUATION, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * {@link normalize} with a parenthesised or dashed suffix removed, so
 * `Roads (2011 Remaster)` and `Roads - Live` compare equal to `Roads`.
 *
 * This is where re-issues are caught. A personal library and a provider's
 * catalog are both full of these: the tags on a rip say what the pressing
 * said, MusicBrainz holds the recording under its plain name, and the same
 * song ends up appearing three times under three decorations. An exact-only
 * comparison misses most of a real library.
 */
export function baseForm(value: string): string {
    return normalize(value.replace(PARENTHETICAL, ' ').split(/\s+[-–—]\s+/)[0] ?? value);
}
