/**
 * Choosing the ONE plugin for a job, out of the ones that could do it.
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
 * The caller reports the reason. See the `explainNo*` beside each setting.
 */
export function selectSolePlugin<TPlugin extends SelectablePlugin>(
    candidates: readonly TPlugin[],
    configured: string | undefined,
): TPlugin | undefined {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) return candidates.find(candidate => candidate.record.id === wanted);

    return candidates.length === 1 ? candidates[0] : undefined;
}
