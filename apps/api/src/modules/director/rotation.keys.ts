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
