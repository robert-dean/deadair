/**
 * Which plugin measures the station's records, and how many at a time.
 *
 * Runtime knobs, so they live in `deadair.settings` rather than the environment:
 * env is for what the app needs before a database exists, and both of these are
 * decisions an operator changes from the console. Per install, like
 * `playout.airMode` beside them, and they move onto the station row if the
 * deferred multi-station work lands.
 */

import type { AnalysisPlugin } from '#modules/plugins/plugin.capabilities.js';
import { explainNoPlugin, selectSolePlugin } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const ANALYSIS_PLUGIN_KEY = 'analysis.pluginId';

/** How many tracks the walk measures at once. */
export const ANALYSIS_CONCURRENCY_KEY = 'analysis.concurrency';

/**
 * One at a time until an operator says otherwise.
 *
 * Analysis is a background walk over a whole library, and the cost of it running
 * too wide is not a slow walk — it is the machine the station is playing from
 * becoming unresponsive while nobody asked for that. An operator who wants the
 * library measured by morning can raise it; nobody should have their evening
 * taken over by a default.
 */
export const DEFAULT_ANALYSIS_CONCURRENCY = 1;

/**
 * The ceiling, so a typo in a text field cannot ask for four hundred decodes.
 *
 * Not derived from the host's core count deliberately: the analyzer may not be
 * on this machine at all. See {@link resolveAnalysisConcurrency}.
 */
export const MAX_ANALYSIS_CONCURRENCY = 32;

/**
 * The plugin to measure with, out of the ones that currently can.
 *
 * `selectSolePlugin`'s rule, and what it means here: one analyzer installed
 * needs no choosing, several with none chosen picks nothing rather than
 * measuring with whichever loaded first, and a named plugin that is disabled
 * does not silently become a different analyzer.
 *
 * That last rule matters more here than for speech, because the failure is
 * invisible rather than audible. A station that speaks in the wrong voice is
 * obvious in one break; a station whose records were measured by an analyzer
 * nobody chose looks exactly like one measured by the right one, until the
 * transitions are wrong and there is nothing to attribute it to. `analyzer_plugin_id`
 * is stored on every row for the same reason.
 */
export function selectAnalysisPlugin(candidates: readonly AnalysisPlugin[], configured: string | undefined): AnalysisPlugin | undefined {
    return selectSolePlugin(candidates, configured);
}

/**
 * Why there is nobody to measure with, in a sentence an operator can act on.
 *
 * Separate from {@link selectAnalysisPlugin} because the selection has three
 * distinct failure modes and one `undefined`. Told apart here so the job can log
 * which one, which is the only way an operator finds out at all: unlike speech,
 * nothing about a station with no analyzer looks wrong from the outside.
 */
export function explainNoAnalyzer(candidates: readonly AnalysisPlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, {
        key: ANALYSIS_PLUGIN_KEY,
        can: 'measure audio',
        remedy: 'install and enable an analyzer plugin',
    });
}

/**
 * How many measurements to keep in flight, from whatever the setting says.
 *
 * **This is only half of a pair, and the other half is not here.** The analyzer
 * sizes its own worker pool from its own environment, because it owns the CPU;
 * this decides how many requests the walk opens, because the walk is ours.
 * Neither can compute the other: doing so would need the app to know the
 * analyzer's hardware, and `baseUrl` may name a machine with thirty-two cores
 * and a GPU or a Raspberry Pi. Raising this above the analyzer's pool only
 * queues requests there; leaving it below leaves cores idle. They are tuned
 * together or not at all.
 *
 * Clamped rather than validated-and-rejected, because a setting that refuses to
 * load stops the walk entirely, and the walk falling back to something sane is
 * strictly better than a station that quietly measures nothing.
 */
export function resolveAnalysisConcurrency(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_CONCURRENCY;

    return Math.min(MAX_ANALYSIS_CONCURRENCY, Math.max(1, Math.floor(parsed)));
}
