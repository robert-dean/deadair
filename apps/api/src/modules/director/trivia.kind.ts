/**
 * The kind of break that passes on a piece of trivia about the station's own music.
 *
 * The same string as `segments.kind` and what a band on the format clock names.
 *
 * ## Here rather than in a module of its own
 *
 * `ALMANAC_KIND` and `WEATHER_KIND` live in the module that owns their substrate, because that module
 * is built before the director and the director would otherwise be what everything imports. The
 * substrate here is the fact store, which `enrichment` owns and which has no business knowing about a
 * kind of break: what a trivia break IS is a decision about air, so the constant sits with the source
 * and the writers that decide it.
 *
 * ## `trivia` rather than `facts`
 *
 * It is the word an operator reaches for and the word a listener would use. A kind called `facts`
 * would read as the notes every talk break is already handed.
 */
export const TRIVIA_KIND = 'trivia';
