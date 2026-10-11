import { normalizeKey } from '#modules/catalog/catalog.keys.js';

/**
 * How the rotation decides that two things are "the same song" or "the same
 * artist".
 *
 * Built on the catalog's own {@link normalizeKey}, so a repeat window and the
 * catalog agree about what "Beyoncé" and "Beyonce" are. Kept here rather than
 * inline at the call sites because the writer of play history and the reader of
 * it must produce byte-identical keys — a rotation rule that silently never
 * matches is invisible, and its only symptom is a station that repeats itself.
 */

/**
 * The artist a track counts against for the cooldown: the LEAD one, not the
 * whole credit.
 *
 * "Aphex Twin" and "Aphex Twin feat. Someone" have to be the same artist here,
 * or a cooldown is dodged by any track with a guest on it — which is the common
 * case in exactly the genres where an artist has a deep catalogue to work
 * through. The full credit stays on the history row for display; it is just not
 * what identity is taken from.
 *
 * An empty list answers with the empty string, which no history row can match,
 * so a track credited to nobody is never suppressed by an artist rule. That is
 * the right way round: the alternative herds every uncredited track under one
 * key and cools them all down together.
 */
export const artistKey = (artists: readonly string[]): string => normalizeKey(artists[0] ?? '');

/**
 * The song a track counts against for the repeat window: its title, under its
 * lead artist.
 *
 * Scoped by artist rather than title alone, because two different acts sharing a
 * title is ordinary ("Crazy", "Hurt") and suppressing one because the other
 * aired would be wrong. Deliberately NOT scoped by album: a track and its
 * remaster, or the single and the album cut, are the same song to a listener,
 * and a repeat window that let both through in an hour is the exact complaint
 * this rule exists to answer.
 */
export const songKey = (title: string, artists: readonly string[]): string => `${artistKey(artists)}:${normalizeKey(title)}`;

/**
 * The release a track counts against for the per-batch album cap: its album, under its lead artist.
 *
 * Scoped by artist for the same reason {@link songKey} is: two different acts can share an album
 * title, and capping one release because another of the same name filled its quota would be wrong.
 * Nothing computes this for a candidate with no album (a track outside the catalog's own draw, or
 * one whose release is unknown), so the cap simply has nothing to apply to it.
 */
export const albumKey = (artists: readonly string[], album: string): string => `${artistKey(artists)}:${normalizeKey(album)}`;

/**
 * How the acts in one credit are joined back together in a {@link creditKey}. A spaced slash, which
 * {@link normalizeKey} never emits (it turns every slash into a space), so a credit key with this in
 * it is always a joined credit and a plain artist key never is.
 */
const ACT_SEPARATOR = ' / ';

/** A run of characters that are not part of any word, in any script. */
const NON_WORD_RUN = /[^\p{L}\p{N}\p{M}]+/gu;

/** Punctuation and symbols that can stand between two acts: a slash, a comma, an ampersand, a bullet, a dash, a plus. */
const JOINER = /[\p{Pd}\p{Po}\p{Sm}\p{So}]/u;

/**
 * The punctuation that never joins two acts even with a space beside it: a full stop, which ends an
 * abbreviation ("Mr. Big", "St. Vincent"), an exclamation or question mark, and any quote or
 * apostrophe ("Guns N' Roses"). Brackets never get this far: they are not in {@link JOINER}.
 */
const NOT_A_JOINER = /[\p{Sentence_Terminal}\p{Quotation_Mark}]/u;

const WHITESPACE = /\s/u;

/**
 * Whether a run of non-word characters separates two acts: it has a space in it AND a joining mark.
 *
 * Both, and that is the whole guard. A mark with no space is part of a name ("Jay-Z", "AC/DC",
 * "will.i.am"), and a space with no mark is just the space between two words of one name ("Air
 * Supply"). Judged by character class rather than a list of separators because the separators are
 * whatever a provider or a tagger chose: " / ", " • ", " & ", ", ", " + ", " × " all turn up.
 */
const separatesActs = (run: string): boolean => WHITESPACE.test(run) && [...run].some(char => JOINER.test(char) && !NOT_A_JOINER.test(char));

/**
 * The acts one credit names, each as a {@link normalizeKey}, in the order written. "Yusuf / Cat
 * Stevens" is `['yusuf', 'cat stevens']`; "Air Supply" and "Jay-Z" are one act each. Empty for a
 * credit with no letters or digits at all.
 */
export const artistActs = (credit: string): string[] => {
    const acts: string[] = [];
    let from = 0;
    for (const match of credit.matchAll(NON_WORD_RUN)) {
        if (!separatesActs(match[0])) continue;
        acts.push(credit.slice(from, match.index));
        from = match.index + match[0].length;
    }
    acts.push(credit.slice(from));
    return acts.map(normalizeKey).filter(act => act.length > 0);
};

/**
 * A lead credit with the joins between its acts kept, for the spacing rules to compare by
 * {@link artistCreditsOverlap}. For a credit naming one act this IS its {@link artistKey}, byte for
 * byte; for "Yusuf / Cat Stevens" it is `yusuf / cat stevens` where the key is `yusuf cat stevens`.
 * Feeding it back in answers itself, so a caller holding either form can pass it on.
 *
 * Never identity. The key is still what `play_history`, the repeat window and a dislike match on.
 */
export const creditKey = (credit: string): string => artistActs(credit).join(ACT_SEPARATOR);

/**
 * Whether two credits name the same act for the purpose of SPACING: one of them, whole, is a run of
 * whole acts inside the other. "Cat Stevens" and "Yusuf / Cat Stevens" do, and so do "Pixies" and
 * "Pixies • Black Francis"; "Air" and "Air Supply" do not (no join between the words), nor "Jay" and
 * "Jay-Z" (no space at the join), nor "Sly & Robbie" and "Sly & the Family Stone" (neither is inside
 * the other, though they share a first act).
 *
 * For the cooldown, the queued-artist hold and keeping one act off its own heels, and for nothing
 * else: a dislike, a veto or a never-play rule stays on the exact key, because a refusal must not
 * reach further than what the operator named. A rare false match ("Earth" inside "Earth, Wind &
 * Fire") costs a record held a little longer, and every spacing rule gives way rather than starving
 * a batch. Takes a raw credit or a {@link creditKey}; an empty credit overlaps nothing, as an empty
 * {@link artistKey} matches nothing.
 */
export const artistCreditsOverlap = (a: string, b: string): boolean => {
    const left = artistActs(a);
    const right = artistActs(b);
    if (left.length === 0 || right.length === 0) return false;

    const [inner, outer] = left.length <= right.length ? [left, right] : [right, left];
    for (let start = 0; start + inner.length <= outer.length; start++) {
        if (inner.every((act, offset) => outer[start + offset] === act)) return true;
    }
    return false;
};

/**
 * What a spacing set holds for one lead credit: its {@link artistKey} and, when the credit joins
 * several acts, its {@link creditKey} too. The key keeps an exact match exactly as cheap as it was;
 * the credit key is what lets {@link isArtistHeld} see "Cat Stevens" inside it.
 */
export const spacingKeys = (artist: string): string[] => {
    const key = artistKey([artist]);
    const credit = creditKey(artist);
    return credit === key || credit.length === 0 ? [key] : [key, credit];
};

/**
 * Whether an artist is held by a spacing set built from {@link spacingKeys}: the same key, or a
 * credit that overlaps it ({@link artistCreditsOverlap}).
 *
 * The exact key is asked first and settles the common case. Otherwise only joined credits can
 * overlap something they are not equal to, so the set is scanned in full only for a joined
 * candidate and otherwise only its joined entries are compared. The sets are a cooldown's worth of
 * artists, a few dozen at most, which is why this is a scan in memory rather than a query.
 *
 * @param credit - The candidate's {@link creditKey} or raw lead credit. Absent, the key stands for it.
 */
export const isArtistHeld = (held: ReadonlySet<string>, key: string, credit: string = key): boolean => {
    if (held.has(key)) return true;
    if (key.length === 0) return false;

    const joined = credit.includes(ACT_SEPARATOR) || artistActs(credit).length > 1;
    for (const entry of held) {
        if ((joined || entry.includes(ACT_SEPARATOR)) && artistCreditsOverlap(entry, credit)) return true;
    }
    return false;
};

/** Whether two candidates count as one act for spacing: the same key, or overlapping credits. */
export const sameAct = (a: { artistKey: string; creditKey?: string }, b: { artistKey: string; creditKey?: string }): boolean =>
    a.artistKey === b.artistKey || artistCreditsOverlap(a.creditKey ?? a.artistKey, b.creditKey ?? b.artistKey);
