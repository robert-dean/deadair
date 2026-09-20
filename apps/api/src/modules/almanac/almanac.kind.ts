/**
 * The kind of break that is about the date.
 *
 * The same string as `segments.kind` and what a band on the format clock names.
 *
 * ## Why this is here and not in its writer
 *
 * `weather.kind.ts`'s reason exactly: the module that owns the substrate —
 * `AlmanacModule`, registered long before the director — is built first, and
 * putting the constant in the writer would make everything that needs the
 * string import from the director. `NEWS_KIND` lives in its writer only because
 * it arrived before there was anywhere else to put it.
 *
 * ## `almanac` rather than `thisday` or `history`
 *
 * It is the trade's own word for a book of dates, and it is the one that covers
 * what actually arrives: a day of history, and a day that recurs with no history
 * in it at all. A kind called `history` would make an operator wonder why their
 * station announced a saint's day.
 */
export const ALMANAC_KIND = 'almanac';
