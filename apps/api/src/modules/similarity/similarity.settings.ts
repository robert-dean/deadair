/**
 * Which similarity source the station asks first.
 *
 * ## What this actually changes, which is narrower than it sounds
 *
 * `SimilarityService` asks its three questions differently. `similarTo` asks
 * EVERY source and merges the answers without ranking them, so the order
 * changes almost nothing there — only which source's ids survive when two of
 * them name the same artist. `topTracks` and `similarTracks` take the FIRST
 * usable answer and stop, so for those the order decides which source names
 * the records that air.
 *
 * Before this setting that order was `record.id.localeCompare`, which is to
 * say alphabetical: `deadair.deezer` before `deadair.lastfm` before
 * `deadair.musicbrainz`. An accident of spelling deciding whose judgement the
 * station plays is not a decision anybody made, and an operator who trusted
 * one source over another had no way to say so short of disabling the others.
 *
 * ## Empty is not "no order"
 *
 * An unset setting keeps the alphabetical fallback exactly, so every station
 * that never opens this behaves as it did. A listed id that is not installed
 * or not enabled is simply absent: this orders sources and never requires or
 * disables one, because a setting that could silently switch off the only
 * similarity plugin is a setting that turns a typo into a station with no
 * discovery.
 *
 * The parsing and the comparator live in `plugins/plugin.order.ts` and the
 * pairing of this key with the capability is one row of
 * `plugins/plugin.providers.ts`, because similarity was the first capability to
 * want an order and is no longer the only one. What stays here is the key and
 * the paragraphs above, which are about what the order MEANS for these three
 * questions and are not shared by anything.
 */
export const SIMILARITY_ORDER_KEY = 'rotation.similarityOrder';
