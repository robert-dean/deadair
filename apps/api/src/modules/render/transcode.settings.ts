/**
 * Which plugin the station makes shareable copies of its audio with.
 *
 * `mixer.settings.ts`'s shape beside it, for its reason: two encoders handed the same audio produce
 * two copies and nothing to merge, so choosing between several is a setting rather than an ordering.
 *
 * **Why it is not `render.mixerPluginId`.** The bundled analyzer joins and encodes off one sidecar,
 * which is an argument about the adapter. Reached through the mixer's key, the station's encoder
 * would be whichever plugin the operator chose to JOIN with, so a better joiner that cannot encode
 * would take sharing away.
 *
 * A runtime knob in `deadair.settings`, in the `render` group, because a copy to share is made out of
 * a rendered segment.
 */

import type { TranscodePlugin } from '#modules/plugins/plugin.capabilities.js';
import { explainDefaultPick, explainNoPlugin, selectPlugin, type CapabilityWording } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const TRANSCODE_PLUGIN_KEY = 'render.transcodePluginId';

/** What this capability is called in the sentences the operator reads. */
const TRANSCODE_WORDING: CapabilityWording = {
    key: TRANSCODE_PLUGIN_KEY,
    can: 'make copies of audio to share',
    remedy: 'install and enable a transcode plugin',
};

/** The plugin to make copies with, out of the ones that currently can. `selectPlugin`'s rule. */
export function selectTranscodePlugin(candidates: readonly TranscodePlugin[], configured: string | undefined): TranscodePlugin | undefined {
    return selectPlugin(candidates, configured);
}

/** Why there is nothing to make copies with, in a sentence an operator can act on. */
export function explainNoTranscoder(candidates: readonly TranscodePlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, TRANSCODE_WORDING);
}

/** That the station chose its own encoder, and which others it could have used. */
export function explainDefaultTranscoder(
    chosen: TranscodePlugin,
    candidates: readonly TranscodePlugin[],
    quarantined: readonly string[] = [],
): string {
    return explainDefaultPick(chosen, candidates, TRANSCODE_WORDING, quarantined);
}
