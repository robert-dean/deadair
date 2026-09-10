/**
 * Which plugin the station joins audio with.
 *
 * `speech.settings.ts`'s shape beside it, and for the same reason: two mixers handed the same parts
 * do not produce something to merge, they produce two pieces of audio, so choosing between several
 * is a setting rather than an ordering and there is no priority anywhere in this path.
 *
 * **Why it is not `analysis.pluginId`.** Joining was reached through the analysis pick for one
 * commit, on the argument that both halves need decoded PCM and the bundled adapter serves both off
 * one sidecar. That is an argument about the adapter, and it is still true — one sidecar, one
 * plugin, one address. It is not an argument about the KEY: reached that way, the station's joiner
 * is whichever plugin the operator chose to MEASURE with, so a second analyzer that measures better
 * and cannot join takes joining away and the only remedy is to select a worse analyzer.
 *
 * A runtime knob, so it lives in `deadair.settings`, and in the `render` group because every use of
 * it is render-path work: a production's beats today, and whatever else is made out of station audio
 * later.
 */

import type { MixerPlugin } from '#modules/plugins/plugin.capabilities.js';
import { explainDefaultPick, explainNoPlugin, selectPlugin, type CapabilityWording } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const MIXER_PLUGIN_KEY = 'render.mixerPluginId';

/** What this capability is called in the sentences the operator reads. */
const MIXER_WORDING: CapabilityWording = {
    key: MIXER_PLUGIN_KEY,
    can: 'join audio',
    remedy: 'install and enable a mixer plugin',
};

/**
 * The plugin to join with, out of the ones that currently can.
 *
 * `selectPlugin`'s rule, and what it means here: an unset key takes the first mixer in id order, so
 * installing a second one never stops productions being joined, and a named plugin that is disabled
 * does not silently become a different one. An unchosen pick is reported rather than hidden — see
 * `MixerService.mixer`, which is also where the reason for `undefined` is logged.
 */
export function selectMixerPlugin(candidates: readonly MixerPlugin[], configured: string | undefined): MixerPlugin | undefined {
    return selectPlugin(candidates, configured);
}

/**
 * Why there is nothing to join with, in a sentence an operator can act on.
 *
 * Separate from {@link selectMixerPlugin} for `explainNoSpeaker`'s reason: the selection has two
 * distinct failure modes and one `undefined` — nothing installed, and a chosen one that is not
 * running — and only told apart here can a job log which.
 */
export function explainNoMixer(candidates: readonly MixerPlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, MIXER_WORDING);
}

/**
 * That the station chose its own mixer, and which others it could have used.
 *
 * `quarantined` names installed, enabled mixer plugins that are currently `failed`, so the sentence
 * can say why they are not among the alternatives listed.
 */
export function explainDefaultMixer(chosen: MixerPlugin, candidates: readonly MixerPlugin[], quarantined: readonly string[] = []): string {
    return explainDefaultPick(chosen, candidates, MIXER_WORDING, quarantined);
}
