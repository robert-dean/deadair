/**
 * Which plugin the station thinks with.
 *
 * The sibling of `render.speechPluginId`, and for the same reason: this is a capability with one
 * answer rather than a fan-out. Enrichment asks every source and merges what comes back, because
 * two sources knowing different facts about a record is more knowledge. Two models writing the same
 * line is not more of anything, it is one line and a wasted generation.
 *
 * A runtime knob, so it lives in `deadair.settings` rather than the environment: env is for what the
 * app needs before a database exists, and this is a decision an operator changes from the console.
 * Per install, and it moves onto the station row if the deferred multi-station work lands.
 *
 * Note what is NOT here. The base URL, the model, the credentials and the temperature are the
 * PLUGIN's config, exactly as the speech engine's are, because they are per-provider knobs and the
 * host has no business carrying them. What the station decides is which plugin, and nothing else.
 */

import type { LlmPlugin } from '#modules/plugins/plugin.capabilities.js';
import { explainDefaultPick, explainNoPlugin, selectPlugin, type CapabilityWording } from '#modules/plugins/plugin.selection.js';

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const LLM_PLUGIN_KEY = 'llm.pluginId';

/** What this capability is called in the sentences the operator reads. */
const LLM_WORDING: CapabilityWording = {
    key: LLM_PLUGIN_KEY,
    can: 'produce words',
    remedy: 'install and enable one to let a model write',
};

/**
 * The plugin to think with, out of the ones that currently can.
 *
 * `selectPlugin`'s rule: an unset key takes the first in id order, and a named plugin that is
 * disabled does not silently become a different model. The pick is reported rather than hidden —
 * see `LlmService.generator`, which is also where the reason for `undefined` is logged.
 *
 * Taking a default matters less here than for speech and is the same rule anyway. Nothing is billed
 * (the model is self-hosted) and nothing goes silent, because a station with no model writes its
 * breaks deterministically — but a capability that answers differently depending on which subsystem
 * is asking is exactly what `plugin.selection.ts` exists to prevent.
 */
export function selectLlmPlugin(candidates: readonly LlmPlugin[], configured: string | undefined): LlmPlugin | undefined {
    return selectPlugin(candidates, configured);
}

/**
 * Why there is nothing to think with, in a sentence an operator can act on.
 *
 * Separate from {@link selectLlmPlugin} because the selection has two distinct failure modes and
 * one `undefined`: nothing installed, and a chosen one that is not running. Told apart here so a
 * caller can say which.
 *
 * "Nothing installed" is deliberately worded as an ordinary state rather than a fault. A station
 * with no model plugin is every fresh install, and it writes its breaks deterministically, which is
 * a station that works.
 */
export function explainNoGenerator(candidates: readonly LlmPlugin[], configured: string | undefined): string {
    return explainNoPlugin(candidates, configured, LLM_WORDING);
}

/** That the station chose its own model plugin, and which others it could have used. */
export function explainDefaultGenerator(chosen: LlmPlugin, candidates: readonly LlmPlugin[]): string {
    return explainDefaultPick(chosen, candidates, LLM_WORDING);
}
