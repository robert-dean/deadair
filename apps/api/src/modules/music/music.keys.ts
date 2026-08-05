/**
 * The fuzzy match keys the catalog schema declares — `artists.artist_key`,
 * `albums.name_key`, `tracks.title_key` — and the last rung of the resolution
 * ladder described at the top of `0004_music.sql`. Ingest reaches these only
 * after an mbid and (for tracks) an isrc have both failed to identify the item.
 *
 * The job is to make two spellings of the same name collide: "Beyoncé" and
 * "Beyonce", "Sigur Rós" and "Sigur Ros", "Don't Stop Me Now" and "Dont Stop Me
 * Now", "Sæglópur" and "Saeglopur", "Hawaiʻi" and "Hawaii".
 *
 * It is deliberately NOT a similarity metric. It normalizes spelling, nothing
 * more: "The Beatles" and "Beatles" are different keys, and so are a track and
 * its remaster. Merging those is a judgement call, which is what
 * `merged_into_id` exists to record — a key collision must stay something the
 * resolver can trust outright.
 *
 * **Every script is a first-class citizen here**, which is the constraint that
 * shapes the implementation below. An earlier version kept only `[a-z0-9]`, so
 * every name written outside the Latin alphabet — サカナクション, Мумий Тролль,
 * 방탄소년단 — normalized to the empty string. That is not a cosmetic loss:
 * `artists.artist_key` is `not null unique`, so an empty key is a single shared
 * row that every such artist would be forced into, and ingest could only avoid
 * the collision by refusing the music outright.
 *
 * The asymmetry to hold onto: failing to merge two spellings of one name costs
 * a duplicate row, which `merged_into_id` exists to repair. Wrongly merging two
 * different names binds one artist's tracks to another, and nothing detects it.
 * So where this has to guess, it guesses toward keeping things apart.
 */

/**
 * Latin letters with no decomposition, because they are letters in their own
 * right rather than a base plus an accent. Each maps to the sequence people
 * type when they cannot type the letter, which is the whole point: "Sæglópur"
 * and "Saeglopur" have to collide.
 *
 * Only Latin appears here, and deliberately so. Transliterating another script
 * into ASCII (romaji, pinyin, Cyrillic → Latin) is a lossy, ambiguous mapping
 * with several competing standards, and getting it wrong merges unrelated
 * artists. Those scripts are simply preserved as themselves instead.
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

/**
 * Every character used as an apostrophe, which are deleted rather than spaced.
 *
 * "Don't Stop Me Now" and "Dont Stop Me Now" are the same title, and providers
 * disagree about the apostrophe as freely as they disagree about accents.
 * Replacing it with a space instead — as punctuation generally is — yields
 * "don t stop me now", which matches neither spelling anyone actually types.
 *
 * The list is long because "apostrophe" is not one code point. Beyond the ASCII
 * `'` and the typographic `’` that word processors substitute for it, two of
 * these are letters as far as Unicode is concerned (`ʼ` and the Hawaiian ʻokina
 * `ʻ` are category Lm) and so survive the `\p{L}` filter below untouched, and
 * `´` decomposes under NFKD into a space plus a combining acute, which would
 * strand a floating accent mid-word. Removing them all up front, before any
 * decomposition, is what makes those three cases behave alike.
 *
 * This does fold Hawaiʻi into Hawaii. That is the intent: it is the same
 * character-level disagreement as é versus e, which this function exists to
 * settle.
 */
const APOSTROPHES = /['`´‘’‛ʹʻʼʽ′]/g;

/**
 * An accent sitting on a Latin base letter, which NFKD has just split off — the
 * acute in "é", the umlaut in "ö".
 *
 * Scoped to a Latin base on purpose, because "combining mark" means two
 * unrelated things depending on the script. On Latin it is an accent, and
 * dropping it is exactly what makes "Beyoncé" and "Beyonce" agree. Elsewhere
 * the same class of code point is a letter-forming part of the word:
 *
 * - Japanese: NFKD splits `が` into `か` + U+3099. Dropping that mark makes
 *   `が` and `か`, `だ` and `た`, the same key — distinct words merged.
 * - Cyrillic: NFKD splits `й` into `и` + U+0306, and U+0306 is in this very
 *   range. Dropping it conflates two distinct Russian letters.
 *
 * So the base character decides, and everything else is recomposed by the NFC
 * pass below rather than stripped.
 */
const LATIN_ACCENTS = /([a-z])[̀-ͯ]+/g;

/**
 * Everything that is not a letter, a number, a combining mark, or a space.
 *
 * Marks are kept because in most scripts they are not optional decoration: a
 * Thai or Devanagari vowel sign, or a Hebrew point, is part of the word, and
 * dropping it merges words that differ. It does mean an Arabic name written
 * once with harakat and once without produces two keys — the failure this
 * prefers, per the asymmetry above.
 */
const NON_KEY_CHARACTERS = /[^\p{L}\p{N}\p{M} ]/gu;

const WHITESPACE_RUN = /\s+/g;

/**
 * The comparison key for a name or title.
 *
 * Returns an empty string only for input with no letters or digits in any
 * script at all — whitespace, or punctuation like "!!!". Callers decide whether
 * that is usable; `CatalogResolverService` refuses to ingest an artist whose
 * key is empty, because `artist_key` is `not null unique` and would herd every
 * such artist into one row.
 *
 * @param value - Raw provider-supplied name or title.
 * @returns Lowercase, Latin accents folded, other scripts preserved,
 *   punctuation replaced by single spaces, trimmed.
 */
export const normalizeKey = (value: string): string => {
    // Apostrophes go first, before anything can decompose them into marks or
    // hide them among the letters. Deleted, not spaced: see APOSTROPHES.
    //
    // NFKD then folds compatibility forms, which is wanted: half-width katakana
    // becomes full-width, ﬁ becomes fi, ① becomes 1. Lowercasing first lets both
    // the accent rule and the transliteration table name only lowercase forms.
    let key = value.replace(APOSTROPHES, '').normalize('NFKD').toLowerCase().replace(LATIN_ACCENTS, '$1');

    // Recompose whatever was decomposed and not stripped, so a non-Latin letter
    // is one code point again and its mark cannot be mistaken for punctuation
    // and turned into a space mid-word.
    key = key.normalize('NFC');

    for (const [letter, replacement] of LATIN_LETTERS) key = key.replace(letter, replacement);

    return key.replace(NON_KEY_CHARACTERS, ' ').replace(WHITESPACE_RUN, ' ').trim();
};
