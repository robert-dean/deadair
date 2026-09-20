import { parseRows } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';

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
 */
export const SIMILARITY_ORDER_KEY = 'rotation.similarityOrder';

/** The column a plugin id lives in. One column, because a row here IS a source. */
const SOURCE_COLUMN = 'source';

/**
 * The operator's order as plugin ids, or empty for the alphabetical fallback.
 *
 * Tolerant in the same way {@link feedRoster} is, and for the same reason: a
 * setting somebody has broken by hand answers "no order", which is the
 * station's old behaviour, rather than an error on a path whose whole job is to
 * be optional. Duplicates drop keeping the FIRST, since an id written twice is
 * one the operator wanted early and then wrote again.
 */
export function similarityOrder(config: AppConfig): string[] {
    const listed: string[] = [];

    for (const row of parseRows(config.get(SIMILARITY_ORDER_KEY, ''))) {
        const id = (row[SOURCE_COLUMN] ?? '').trim();
        if (id.length === 0 || listed.includes(id)) continue;

        listed.push(id);
    }

    return listed;
}

/**
 * Compares two plugin ids by the operator's order: everything listed first, in
 * the order given, then everything else alphabetically.
 *
 * Alphabetical for the remainder rather than "registration order", because that
 * is what this replaced and an unlisted source should keep the position it has
 * always had relative to the other unlisted ones.
 */
export function byOrderThen(order: string[]): (left: OrderablePlugin, right: OrderablePlugin) => number {
    const rank = (id: string): number => {
        const at = order.indexOf(id);
        return at === -1 ? order.length : at;
    };

    return (left, right) => rank(left.record.id) - rank(right.record.id) || left.record.id.localeCompare(right.record.id);
}

/** The shape this orders by, which is `byPluginId`'s so the two are interchangeable. */
interface OrderablePlugin {
    record: { id: string };
}
