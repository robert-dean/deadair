/**
 * The kind of break that is about a place.
 *
 * The same string as `segments.kind`, what a band on the format clock names, and
 * what the topic chassis keys the station's locations by.
 *
 * ## Why this is here and `NEWS_KIND` is in its writer
 *
 * `NEWS_KIND` lives in `director/news.break.writer.ts` because the writer arrived
 * first and everything that needed the string could reach it there. Weather is
 * the other way round: the module that owns the SUBJECT — `WeatherModule`, which
 * registers the location topics — is built and registered before the writer that
 * reads one back, and `modules.ts` puts it there deliberately. Putting the
 * constant in the writer would make the topic kind import from the director, and
 * the topic chassis is meant to be reachable by a module that has no writer yet.
 */
export const WEATHER_KIND = 'weather';
