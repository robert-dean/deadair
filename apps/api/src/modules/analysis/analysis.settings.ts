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
import { explainDefaultPick, explainNoPlugin, selectPlugin, type CapabilityWording } from '#modules/plugins/plugin.selection.js';

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

/** What this capability is called in the sentences the operator reads. */
const ANALYSIS_WORDING: CapabilityWording = {
    key: ANALYSIS_PLUGIN_KEY,
    can: 'measure audio',
    remedy: 'install and enable an analyzer plugin',
};

/**
 * The plugin to measure with, out of the ones that currently can.
 *
 * `selectPlugin`'s rule, and what it means here: an unset key takes the first
 * analyzer in id order, and a named plugin that is disabled does not silently
 * become a different analyzer.
 *
 * That second rule matters more here than for speech, because the failure is
 * invisible rather than audible. A station that speaks in the wrong voice is
 * obvious in one break; a station whose records were measured by an analyzer
 * nobody chose looks exactly like one measured by the right one, until the
 * transitions are wrong and there is nothing to attribute it to.
 * `analyzer_plugin_id` is stored on every row for the same reason — and it is
 * also what makes a DEFAULT pick recoverable here rather than merely reported,
 * since the rows say who measured them and a re-measure is cheap and unattended.
 */
export function selectAnalysisPlugin(candidates: readonly AnalysisPlugin[], configured: string | undefined): AnalysisPlugin | undefined {
    return selectPlugin(candidates, configured);
}

/**
 * Why there is nobody to measure with, in a sentence an operator can act on.
 *
 * Separate from {@link selectAnalysisPlugin} because the selection has two
 * distinct failure modes and one `undefined`. Told apart here so the job can log
 * which one, which is the only way an operator finds out at all: unlike speech,
 * nothing about a station with no analyzer looks wrong from the outside.
 */
export function explainNoAnalyzer(candidates: readonly AnalysisPlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, ANALYSIS_WORDING);
}

/** That the station chose its own analyzer, and which others it could have used. */
export function explainDefaultAnalyzer(chosen: AnalysisPlugin, candidates: readonly AnalysisPlugin[]): string {
    return explainDefaultPick(chosen, candidates, ANALYSIS_WORDING);
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

/**
 * How long the walk waits after a track it reached a PROVIDER to measure.
 *
 * A full audio download through the credential the station plays on, so this is the same protection
 * `CACHE_AHEAD` and `MAX_HAND_OVERS` exist for: a provider's limiter counts requests per interval, and a
 * burst of them exhausted a provider's audio-key quota once and took the station off air. Sixty seconds
 * until an operator says otherwise, which is deliberately cautious rather than tuned.
 */
export const ANALYSIS_PROVIDER_PACE_KEY = 'analysis.providerPaceMs';
export const DEFAULT_ANALYSIS_PROVIDER_PACE_MS = 60_000;

/**
 * How long the walk waits after a track it did NOT need a provider for.
 *
 * A copy `TrackAudioService` has already kept costs the station's own disk and the analyzer's own
 * decode, not a rate-limited credential, so this is free to be much shorter than the provider pace —
 * but it is not zero by default. Analysis is background work an operator did not necessarily ask to
 * run flat out, and a local library measured at full tilt is still real CPU on whatever machine is
 * running Postgres, the app and the analyzer, possibly all three the same box. Five seconds is a
 * courtesy default; an operator who wants the local half of a library measured by morning can lower
 * it to zero, which is exactly as much consent as raising `analysis.concurrency` already asks for.
 */
export const ANALYSIS_LOCAL_PACE_KEY = 'analysis.localPaceMs';
export const DEFAULT_ANALYSIS_LOCAL_PACE_MS = 5_000;

/**
 * The ceiling either pace may be set to, so a typo cannot park the walk for a day between tracks.
 *
 * Ten minutes, which is already an operator asking for something unusually gentle; nothing here
 * argues for slower than that.
 */
export const MAX_ANALYSIS_PACE_MS = 10 * 60_000;

/**
 * Read a stored pace, or the default for whichever one it is.
 *
 * Clamped rather than validated-and-rejected, matching {@link resolveAnalysisConcurrency}: a setting
 * that refuses to load should not stop the walk, and zero is a legal answer — an operator's explicit
 * consent to run without a gap, which the floor of `Math.max(0, …)` does not stand in the way of.
 */
export function resolveAnalysisPaceMs(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;

    return Math.min(MAX_ANALYSIS_PACE_MS, Math.max(0, Math.floor(parsed)));
}
