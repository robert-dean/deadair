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
 * Two rules, and each one is a decision rather than a fallback:
 *
 * 1. **An unset key takes the FIRST candidate**, which needs no choosing at all
 *    when there is one and is a default when there are several. Callers pass
 *    candidates in {@link byPluginId} order, so "first" is a stable answer rather
 *    than whatever the disk scan happened to find.
 * 2. **A named plugin that is not a candidate answers `undefined`, without
 *    falling back.** The setting names what the station is supposed to use;
 *    quietly using a different one because that one is disabled is how a station
 *    ends up wrong with nothing in the log to explain it. Rule 1 is a default and
 *    this is an instruction, which is the whole difference between them.
 *
 * ## Why rule 1 is not "several and no choice answers nothing"
 *
 * It was, on the argument that picking for an operator who installed two is worse
 * than saying nothing because whatever was picked then looks deliberate. That
 * argument weighs a wrong-looking choice against silence, and for speech silence
 * is what it actually costs: installing a second TTS plugin took the station off
 * the air until somebody visited a settings page. Everywhere else the station has
 * this choice it goes the other way — the writer registry falls through, the set
 * chain tops up, the floor cannot fail — and the objection is answered by SAYING
 * SO rather than by refusing: the caller logs which plugin it picked and which it
 * passed over, so an unchosen default is visible instead of looking deliberate.
 *
 * The caller reports the reason it got nothing, through {@link explainNoPlugin}.
 */
export function selectPlugin<TPlugin extends SelectablePlugin>(candidates: readonly TPlugin[], configured: string | undefined): TPlugin | undefined {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) return candidates.find(candidate => candidate.record.id === wanted);

    return candidates[0];
}

/**
 * Whether this answer was a default rather than the operator's choice, so a
 * caller can say so once.
 *
 * Separate from {@link selectPlugin} because it is about REPORTING and the
 * selection is about choosing: folding it in would make every caller destructure
 * a pair to ask a question only one of them needs. True only when the station has
 * more than one candidate and named none of them — a single installed plugin is
 * not a decision anybody needs telling about.
 */
export function pickedByDefault(candidates: readonly SelectablePlugin[], configured: string | undefined): boolean {
    const wanted = configured?.trim();
    return (wanted === undefined || wanted.length === 0) && candidates.length > 1;
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
 * Why {@link selectPlugin} answered `undefined`, in a sentence an operator can
 * act on.
 *
 * Separate from the selection because there are two distinct failure modes and
 * only one `undefined`: nothing installed, and a chosen one that is not running.
 * Which of the two it was decides what the operator does next, so it cannot be
 * left as "no plugin".
 *
 * Three capabilities wrote this out identically. Only the wording differs, and
 * only in the three places {@link CapabilityWording} names — the branches, their
 * order, and the id list are the same argument every time.
 *
 * Note neither sentence is a fault in any of them. A station with no model plugin
 * writes its breaks deterministically and a station with no analyzer still plays
 * records, so "nothing installed" is an ordinary state that happens to be worth
 * explaining.
 *
 * There used to be a third branch, for several candidates with none chosen. That
 * is no longer a refusal — {@link selectPlugin} takes the first and the caller
 * says which — so the sentence for it moved to {@link explainDefaultPick}, where
 * it reads as a note rather than as something to go and fix.
 */
export function explainNoPlugin(candidates: readonly SelectablePlugin[], configured: string | undefined, wording: CapabilityWording): string {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) {
        return `${wording.key} names "${wanted}", which is not an active plugin that can ${wording.can}`;
    }
    return `no active plugin can ${wording.can}; ${wording.remedy}`;
}

/**
 * That the station chose for itself, and what it passed over.
 *
 * The other half of the bargain {@link selectPlugin} strikes: taking the first
 * candidate is only better than refusing if the choice is visible, or it is
 * exactly the "whatever was picked looks deliberate" failure the refusal was
 * guarding against. Written for a log line and for the console beside the engine
 * it is actually using, which is why it names the alternatives — the operator's
 * next move is to set the key, and they need to know what to set it to.
 */
export function explainDefaultPick(chosen: SelectablePlugin, candidates: readonly SelectablePlugin[], wording: CapabilityWording): string {
    const others = candidates.filter(candidate => candidate.record.id !== chosen.record.id).map(candidate => candidate.record.id);
    return `${wording.key} is unset, so "${chosen.record.id}" was chosen to ${wording.can}; ${others.join(', ')} could too`;
}

/**
 * What each capability has already been told about its own default pick.
 *
 * Module state, and deliberately: the three services that ask are all SCOPED, so an instance field
 * would hold nothing between two calls and every one of them would report again. `speaker()` runs on
 * every commit pass, which is a line every track boundary for as long as the operator leaves the key
 * unset.
 *
 * In memory rather than anywhere durable, on `ReadLog`'s argument: this holds "have I said this
 * yet", a question whose whole lifetime is this process, and a restart costs one repeated log line
 * rather than a migration. Keyed by the SETTING, since that is what identifies the capability, and
 * valued by the answer — so an install, an uninstall, or the operator finally choosing all report
 * again, and a steady state says nothing.
 */
const reportedDefaults = new Map<string, string>();

/**
 * Whether this default pick is news, marking it reported if so.
 *
 * The edge, so a caller is one `if` rather than its own memory. Answers false for a station whose
 * key is set or which has only one candidate, because neither is a decision anybody needs telling
 * about — which is {@link pickedByDefault}, asked here rather than restated.
 *
 * It took the setting's NAME and not its VALUE for as long as it existed, so it could not ask the
 * first of those questions and did not: a station that had named its plugin, with a second one
 * installed, was told once per process that `render.speechPluginId is unset, so "…" was chosen`,
 * naming the operator's own explicit choice as a fallback. Both clauses of that sentence were false.
 * `pickedByDefault` carried the missing check the whole time and had no caller.
 */
export function defaultPickIsNews(
    chosen: SelectablePlugin,
    candidates: readonly SelectablePlugin[],
    settingKey: string,
    configured: string | undefined,
): boolean {
    if (!pickedByDefault(candidates, configured)) return false;

    const answer = `${chosen.record.id}\n${candidates.map(candidate => candidate.record.id).join(',')}`;
    if (reportedDefaults.get(settingKey) === answer) return false;

    reportedDefaults.set(settingKey, answer);
    return true;
}

/** Forget what has been reported. For tests, which must not inherit another test's edge. */
export function resetDefaultPickReports(): void {
    reportedDefaults.clear();
}
