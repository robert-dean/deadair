import type { PluginRecord } from './types/plugin.record.js';

/**
 * Finding the plugins that could do a job, and choosing the ONE that will.
 *
 * Some capabilities fan out and merge (enrichment asks everything and reconciles
 * the answers). Others have exactly one answer, and asking two is not a merge:
 * two voices rendering the same break is two breaks, and two models writing the
 * same line is one wasted generation.
 *
 * The rule for those is here, once, because it is subtle in three places and the
 * failure when two capabilities disagree about it is a station that behaves
 * differently depending on which subsystem is asking. The prose explaining the
 * choice to an operator stays with each capability, because that part is wording
 * rather than logic and there is nothing there to drift.
 */

/** The shape of a capability-narrowed plugin. Every `as*Plugin` view satisfies it. */
interface SelectablePlugin {
    record: { id: string };
}

/**
 * The plugins that can do a thing, out of the ones installed.
 *
 * Every capability has an `as*Plugin` view in `plugin.capabilities.ts` that
 * answers `undefined` for a record that cannot do the job — not enabled, not
 * loaded, or simply a plugin for something else. Collecting the ones that can
 * was then written out six times, each a `for` loop over the registry pushing
 * into an array declared a line above it.
 *
 * Records rather than the registry itself, so a caller can narrow first: a sync
 * asked to run one plugin passes `[registry.get(id)]`, and the `undefined` that
 * comes back for an unknown id is skipped here rather than guarded there.
 *
 * ```ts
 * pluginsWith(this.registry.list(), asSpeechPlugin).sort(byPluginId);
 * ```
 *
 * @param records - Installed plugin records. `undefined` entries are skipped.
 * @param as - The capability view. Anything it declines is left out.
 */
export function pluginsWith<TPlugin>(records: Iterable<PluginRecord | undefined>, as: (record: PluginRecord) => TPlugin | undefined): TPlugin[] {
    const found: TPlugin[] = [];
    for (const record of records) {
        if (!record) continue;
        const plugin = as(record);
        if (plugin) found.push(plugin);
    }
    return found;
}

/**
 * A stable order for a list of plugins, so the same station answers the same way
 * twice.
 *
 * Installation order is whatever the disk scan found, which is not a thing an
 * operator chose and not a thing that stays put. Where a capability has its own
 * precedence — enrichment's `priority` — this is the tiebreak under it rather
 * than the whole comparator.
 */
export const byPluginId = (left: SelectablePlugin, right: SelectablePlugin): number => left.record.id.localeCompare(right.record.id);

/**
 * The plugin to use, out of the ones that currently can.
 *
 * Three rules, and each one is a decision rather than a fallback:
 *
 * 1. **An unset key picks the only candidate when there is exactly one.** That is
 *    what every station with a single plugin installed looks like, and it means
 *    nobody has to choose before the thing will work.
 * 2. **Several candidates and no choice answers `undefined`.** Picking for an
 *    operator who installed two is worse than saying nothing, because whatever
 *    was picked then looks deliberate.
 * 3. **A named plugin that is not a candidate answers `undefined`, without
 *    falling back.** The setting names what the station is supposed to use;
 *    quietly using a different one because that one is disabled is how a station
 *    ends up wrong with nothing in the log to explain it.
 *
 * The caller reports the reason, through {@link explainNoPlugin}.
 */
export function selectSolePlugin<TPlugin extends SelectablePlugin>(
    candidates: readonly TPlugin[],
    configured: string | undefined,
): TPlugin | undefined {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) return candidates.find(candidate => candidate.record.id === wanted);

    return candidates.length === 1 ? candidates[0] : undefined;
}

/** The words that make a refusal specific to one capability. */
export interface CapabilityWording {
    /** The `deadair.settings` key that names the plugin, quoted back at the operator. */
    key: string;
    /** What the plugin would do, as a verb phrase: `measure audio`, `produce words`, `speak`. */
    can: string;
    /** What to do about having none. Follows "no active plugin can &lt;can&gt;; ". */
    remedy: string;
}

/**
 * Why {@link selectSolePlugin} answered `undefined`, in a sentence an operator
 * can act on.
 *
 * Separate from the selection because there are three distinct failure modes and
 * only one `undefined`: nothing installed, several installed with none chosen,
 * and a chosen one that is not running. Which of the three it was decides what
 * the operator does next, so it cannot be left as "no plugin".
 *
 * Three capabilities wrote this out identically. Only the wording differs, and
 * only in the three places {@link CapabilityWording} names — the branches, their
 * order, and the id list are the same argument every time.
 *
 * Note the middle sentence is deliberately not a fault in any of them. A station
 * with no model plugin writes its breaks deterministically and a station with no
 * analyzer still plays records, so "nothing installed" is an ordinary state that
 * happens to be worth explaining.
 */
export function explainNoPlugin(candidates: readonly SelectablePlugin[], configured: string | undefined, wording: CapabilityWording): string {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) {
        return `${wording.key} names "${wanted}", which is not an active plugin that can ${wording.can}`;
    }
    if (candidates.length === 0) return `no active plugin can ${wording.can}; ${wording.remedy}`;

    const ids = candidates.map(candidate => candidate.record.id).join(', ');
    return `several plugins can ${wording.can} (${ids}); set ${wording.key} to choose one`;
}
