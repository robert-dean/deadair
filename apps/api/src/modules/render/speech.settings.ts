/**
 * Which plugin the station speaks with.
 *
 * Unlike enrichment, which fans out to everything that answers and merges the results, speech has
 * exactly one speaker: two voices rendering the same break is not a merge, it is two breaks. So
 * choosing between several is a setting rather than an ordering, and there is no priority anywhere
 * in the speech path.
 *
 * A runtime knob, so it lives in `deadair.settings` rather than the environment: env is for what
 * the app needs before a database exists, and this is a decision an operator changes from the
 * console. Per install, like `playout.airMode` beside it, and it moves onto the station row if the
 * deferred multi-station work lands.
 */

import type { SpeechPlugin } from '#modules/plugins/plugin.capabilities.js';
import { selectSolePlugin } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const SPEECH_PLUGIN_KEY = 'render.speechPluginId';

/**
 * The plugin to speak with, out of the ones that currently can.
 *
 * `selectSolePlugin`'s rule, and what it means here: one TTS plugin installed needs no choosing,
 * several with none chosen picks nothing rather than airing the wrong voice as if on purpose, and a
 * named plugin that is disabled does not silently become a different voice. The caller reports the
 * reason — see `SpeechService.speaker`.
 */
export function selectSpeechPlugin(candidates: readonly SpeechPlugin[], configured: string | undefined): SpeechPlugin | undefined {
    return selectSolePlugin(candidates, configured);
}

/**
 * Why there is nobody to speak, in a sentence an operator can act on.
 *
 * Separate from {@link selectSpeechPlugin} because the selection has three distinct failure modes
 * and one `undefined`: nothing installed, several installed and none chosen, and a chosen one that
 * is not running. Told apart here so a job can log which, and a route can say which.
 */
export function explainNoSpeaker(candidates: readonly SpeechPlugin[], configured: string | undefined): string {
    const wanted = configured?.trim();
    if (wanted !== undefined && wanted.length > 0) {
        return `${SPEECH_PLUGIN_KEY} names "${wanted}", which is not an active plugin that can speak`;
    }
    if (candidates.length === 0) return 'no active plugin can speak; install and enable a TTS plugin';

    const ids = candidates.map(candidate => candidate.record.id).join(', ');
    return `several plugins can speak (${ids}); set ${SPEECH_PLUGIN_KEY} to choose one`;
}
