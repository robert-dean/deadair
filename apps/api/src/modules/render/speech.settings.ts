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
import { explainDefaultPick, explainNoPlugin, selectPlugin, type CapabilityWording } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const SPEECH_PLUGIN_KEY = 'render.speechPluginId';

/** What this capability is called in the sentences the operator reads. */
const SPEECH_WORDING: CapabilityWording = {
    key: SPEECH_PLUGIN_KEY,
    can: 'speak',
    remedy: 'install and enable a TTS plugin',
};

/**
 * The plugin to speak with, out of the ones that currently can.
 *
 * `selectPlugin`'s rule, and what it means here: an unset key takes the first TTS plugin in id
 * order, so installing a second one never takes the station off the air, and a named plugin that is
 * disabled does not silently become a different voice. An unchosen pick is reported rather than
 * hidden — see `SpeechService.speaker`, which is also where the reason for `undefined` is logged.
 */
export function selectSpeechPlugin(candidates: readonly SpeechPlugin[], configured: string | undefined): SpeechPlugin | undefined {
    return selectPlugin(candidates, configured);
}

/**
 * Why there is nobody to speak, in a sentence an operator can act on.
 *
 * Separate from {@link selectSpeechPlugin} because the selection has two distinct failure modes and
 * one `undefined`: nothing installed, and a chosen one that is not running. Told apart here so a job
 * can log which, and a route can say which.
 */
export function explainNoSpeaker(candidates: readonly SpeechPlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, SPEECH_WORDING);
}

/**
 * That the station chose its own voice, and which others it could have used.
 *
 * `quarantined` names installed, enabled TTS plugins that are currently `failed`, so the sentence
 * can say why they are not among the alternatives listed.
 */
export function explainDefaultSpeaker(chosen: SpeechPlugin, candidates: readonly SpeechPlugin[], quarantined: readonly string[] = []): string {
    return explainDefaultPick(chosen, candidates, SPEECH_WORDING, quarantined);
}
