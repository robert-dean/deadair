import { parseRows } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { byPluginId } from './plugin.selection.js';

/**
 * Ordering the plugins that ALL do a job, where {@link selectPlugin} chooses the
 * one that will.
 *
 * The two are siblings and deliberately separate files. A capability with one
 * answer needs a plugin named; a capability that fans out needs them sequenced,
 * and the sequence matters for a reason that differs per capability: whose
 * answer airs (similarity), who is asked before the station stops asking
 * (weather), who wins a conflicting fact (enrichment). What they share is the
 * shape of the ANSWER, which is this file, so a second capability wanting an
 * order does not arrive with a second dialect of "listed first, then the rest".
 *
 * ## Empty is not "no order"
 *
 * An unset setting keeps whatever order the capability had before anybody asked
 * for one, exactly, which is what lets this be added to a capability without
 * changing a single station that never opens the page. That fallback is the
 * comparator passed in — {@link byPluginId} for most, enrichment's declared
 * `priority` for the one that already had a precedence of its own.
 *
 * ## It orders and never gates
 *
 * A listed id that is not installed, not enabled or quarantined is simply
 * absent: the candidates were narrowed before the sort ever runs. A setting that
 * could silently switch off the only plugin answering a capability is a setting
 * that turns a typo into a station with no similarity, no weather and no facts.
 * Leaving a plugin OUT of the list does not disable it either; it is asked after
 * the ones named.
 */

/** The shape this orders by, which is `byPluginId`'s so the two are interchangeable. */
interface OrderablePlugin {
    record: { id: string };
}

/**
 * The column a plugin id lives in, in every provider-order setting.
 *
 * One column, because a row here IS a plugin. Shared rather than spelled per
 * capability so the console writes one shape and every reader parses one shape.
 */
export const ORDER_SOURCE_COLUMN = 'source';

/**
 * The operator's order as plugin ids, or empty for the capability's own fallback.
 *
 * Tolerant in the same way `feedRoster` is, and for the same stakes: a setting
 * somebody has broken by hand answers "no order", which is the station's old
 * behaviour, rather than an error on a path whose whole job is to be optional.
 * Duplicates drop keeping the FIRST, since an id written twice is one the
 * operator wanted early and then wrote again.
 *
 * @param config - Live station config. The value is read per call; see
 *   `SimilarityService.plugins` for why that is not a cache miss worth fixing.
 * @param key - The `deadair.settings` key holding this capability's order.
 */
export function pluginOrder(config: AppConfig, key: string): string[] {
    const listed: string[] = [];

    for (const row of parseRows(config.get(key, ''))) {
        const id = (row[ORDER_SOURCE_COLUMN] ?? '').trim();
        if (id.length === 0 || listed.includes(id)) continue;

        listed.push(id);
    }

    return listed;
}

/**
 * Compares two plugins by the operator's order: everything listed first, in the
 * order given, then everything else by the capability's own fallback.
 *
 * The fallback runs for two unlisted plugins AND for two listed at the same
 * rank, which cannot happen since {@link pluginOrder} dedupes — so in practice
 * it is what orders the remainder. `byPluginId` by default because alphabetical
 * is what every capability but enrichment sorted by before a setting existed,
 * and an unlisted plugin should keep the position it has always had relative to
 * the other unlisted ones.
 *
 * Ties in the fallback break on id, so the answer is total: a comparator that
 * can answer 0 for two different plugins is a station that answers differently
 * on two runs of the same rotation.
 */
export function byOrderThen<TPlugin extends OrderablePlugin>(
    order: readonly string[],
    fallback: (left: TPlugin, right: TPlugin) => number = byPluginId,
): (left: TPlugin, right: TPlugin) => number {
    const rank = (id: string): number => {
        const at = order.indexOf(id);
        return at === -1 ? order.length : at;
    };

    return (left, right) => rank(left.record.id) - rank(right.record.id) || fallback(left, right) || byPluginId(left, right);
}
