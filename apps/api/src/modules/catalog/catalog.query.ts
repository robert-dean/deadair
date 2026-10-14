import type { OrderByModifiers } from 'kysely';
import { RepositoryPagination } from '../data/repository.types.js';

/**
 * A page of a catalog list: the shared pagination, plus the console's search box.
 *
 * The search is deliberately server-side. Filtering a page client-side would leave `meta.total`
 * describing the unfiltered set, so the pager would offer pages that render empty.
 */
export type CatalogListQuery = RepositoryPagination & {
    search?: string;
    sortBy?: string;
};

/**
 * Which column a sort key names, for one list.
 *
 * The map is per list rather than shared, because the same word means a different column on each
 * one and several words mean nothing at all: `year` is a column on an album and on a track and is
 * not a fact about an artist. What every map has in common is the FALLBACK — a key this list cannot
 * answer falls to its own default rather than throwing, because an ordering nobody can serve should
 * be a list that opens in the ordinary order rather than a page that will not open.
 *
 * The keys are the contract's own enums (`CatalogSort`, `TrackSort`), and are spelled here as plain
 * strings deliberately: a repository that imported a generated wire type would be reading the shape
 * of an HTTP request to decide a column name.
 *
 * Two orderings are deliberately absent and are not oversights. **Last played** has no column: it
 * would be a `max(aired_at)` correlated subquery over `deadair.play_history` joined on a nullable
 * `track_id`, plus a decision about where records that have never aired sort, which is a question
 * about programming rather than about a table. **A track's state** is three independent booleans,
 * so there is no order of it an operator would agree with.
 */
export function columnFor<T extends string>(sortBy: string | undefined, columns: Record<string, T>, fallback: T): T {
    if (sortBy === undefined) return fallback;

    // `Object.hasOwn` rather than a lookup and a nullish check: every object answers `constructor`
    // and `toString`, so the plain form puts a function where a column name goes for a caller who
    // asked to sort by either word. The enum should refuse both long before here, and a map
    // consulted as data rather than as an object is what makes that a second lock instead of the
    // only one.
    const column = Object.hasOwn(columns, sortBy) ? columns[sortBy] : undefined;
    return column ?? fallback;
}

/**
 * The direction, with what the station does not know pushed to the end of it.
 *
 * Postgres sorts nulls LAST ascending and FIRST descending, which is consistent and is the wrong
 * half of the deal for a table an operator clicks: several of these columns are null across most of
 * a library that nothing has enriched, so "longest first" opened on a screenful of records with no
 * duration at all, and the one row that actually answered the question was below them. Unknown
 * belongs at the end whichever way the list is pointed, because it is not an answer in either
 * direction.
 *
 * Applied to every sort rather than only the nullable ones. A column that is `not null` today is one
 * migration away from not being, and a rule that holds everywhere is one nobody has to re-derive.
 */
export function directionFor(sort: 'asc' | 'desc'): OrderByModifiers {
    return builder => (sort === 'asc' ? builder.asc().nullsLast() : builder.desc().nullsLast());
}

/**
 * Wraps a user's search term as a `LIKE` containment pattern, with the wildcards escaped.
 *
 * `%` and `_` are wildcards to SQL and ordinary characters in a title — "50%" and "Chapter_1" are
 * real names, and unescaped they would match far more than the operator typed. The backslash is
 * escaped first so it cannot arrive already doubled; it is Postgres's default `LIKE` escape
 * character, so no `ESCAPE` clause is needed.
 */
export function likeContains(search: string): string {
    return `%${search.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

/**
 * A user's search term as a `LIKE` pattern that matches the whole value and nothing longer.
 *
 * {@link likeContains} without the wildcards around it, so under `ilike` it is equality that ignores
 * case. It exists for ranking rather than for filtering: a search that matches by containment can
 * still ask which of its rows ARE the term, and the two patterns have to escape identically or the
 * ranking and the filter disagree about a name with a `%` in it.
 */
export function likeExactly(search: string): string {
    return search.trim().replace(/[\\%_]/g, character => `\\${character}`);
}

/**
 * A search term as a case-insensitive regular expression (`~*`) that matches it as whole words.
 *
 * Containment is the wrong question for a name, and the live station measured it: asked for heavy
 * metal, a refill searched `Dio`, and `ilike '%Dio%'` answered with "Radio Edit", "Audio Remix",
 * "Diopter" and "Dior" alongside Dio's own records. Whole words keep what containment was for (`metal`
 * still finds `heavy metal`, `rock` still finds `pop/rock`) and lose the fragments of other words.
 *
 * A word boundary here is a letter or digit on one side and anything else, or the end of the text, on
 * the other. Spelled with `[[:alnum:]]` rather than `\m`/`\M`, because those demand a word character
 * at the term's own edge and so could never match a name that starts or ends in punctuation
 * ("Sunn O)))"). Runs of whitespace in the term match any run of whitespace in the text. Every
 * regular-expression character in the term is escaped, so "AC/DC" and "Sunn O)))" are literals.
 *
 * {@link hasWholeWords} is the same rule in TypeScript, for rows that never pass through SQL.
 */
export function regexWholeWords(search: string): string {
    return `(^|[^[:alnum:]])${wordsOf(search)}([^[:alnum:]]|$)`;
}

/**
 * Whether `text` holds `search` as whole words. {@link regexWholeWords}, for text already in hand.
 *
 * `\p{L}\p{N}` is the Unicode spelling of `[[:alnum:]]`. Postgres reads that class through the
 * database's locale, so the two can disagree about an accented letter beside a match, which is a
 * difference of one record in an edge nobody searches for.
 *
 * `caseSensitive` is for finding NAMES in prose, where capitals are the only thing telling an artist
 * called "Loud" from the word "loud" in a brief.
 */
export function hasWholeWords(text: string, search: string, options: { caseSensitive?: boolean } = {}): boolean {
    const words = wordsOf(search);
    if (words.length === 0) return true;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${words}([^\\p{L}\\p{N}]|$)`, options.caseSensitive === true ? 'u' : 'iu').test(text);
}

/**
 * Whether `text` names `name` as an act of its own, rather than as part of a longer name around it.
 *
 * {@link hasWholeWords}, case-sensitive, and then one more test: an occurrence glued by nothing but
 * whitespace to a capitalised word on either side is a piece of a longer name, not this one. Measured
 * on the live station, 2026-10-14: a brief naming "Dirty Honey" and "The Darkness" found the library's
 * "Honey", a Polish pop group, and "Darkness", a Spanish metal band, both as whole words. Each got a
 * record, and "Honey" seeded the similarity walk, which put five Polish pop records into a rock show.
 *
 * A name passes when ANY of its occurrences stands alone, so a brief that names "Heart" in a list and
 * also says "Heart Of Glass" still names it. What this cannot tell apart is a capitalised ordinary
 * word directly before an act ("Mostly Queen"), which loses that act as a lead. Leads are all these
 * are, and losing one costs the brief nothing the model will not read for itself; inventing one put
 * the wrong genre on air.
 */
export function namesAsAnAct(text: string, name: string): boolean {
    const words = wordsOf(name);
    if (words.length === 0) return false;

    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'gu');
    for (const match of text.matchAll(pattern)) {
        const before = text.slice(0, match.index);
        const after = text.slice(match.index + match[0].length);
        if (CAPITALISED_WORD_BEFORE.test(before) || CAPITALISED_WORD_AFTER.test(after)) continue;
        return true;
    }
    return false;
}

/** A capitalised word ending the text, then only whitespace: "Dirty " before "Honey", "N' " before "Roses". */
const CAPITALISED_WORD_BEFORE = /\p{Lu}[\p{L}\p{N}'’.&-]*\s+$/u;

/** Only whitespace, then a capitalised word: " Station" after "Union". */
const CAPITALISED_WORD_AFTER = /^\s+\p{Lu}/u;

/** The term's words, each escaped, joined by "any run of whitespace". Shared so the two dialects cannot drift. */
function wordsOf(search: string): string {
    return search
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0)
        .map(word => word.replace(/[\\^$.|?*+()[\]{}]/g, character => `\\${character}`))
        .join('\\s+');
}
