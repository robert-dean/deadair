import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PLUGIN_CAPABILITY_MIXER, type AudioJoin, type AudioOverlay, type JoinedAudio } from '@deadair/plugin-sdk';
import { asMixerPlugin, type MixerPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, defaultPickIsNews, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { explainDefaultMixer, explainNoMixer, MIXER_PLUGIN_KEY, selectMixerPlugin } from './mixer.settings.js';

/**
 * How long a join may take, as the host's invocation deadline.
 *
 * Minutes, and generous on purpose: the invoker caps the plugin's `host.fetch` budget at whatever
 * the invocation has left, so a stingy figure here silently overrides the plugin's more generous
 * one. Deliberately above the bundled adapter's own `JOIN_TIMEOUT_MS`, so the plugin's timeout is
 * the one that fires and the error says what actually happened.
 */
export const JOIN_INVOKE_TIMEOUT_MS = 4 * 60_000;

/**
 * What the station makes one piece of audio with.
 *
 * `SpeechService`'s shape one capability over, and beside it in `modules/render/` because it is the
 * same kind of thing: a plugin that turns station material into station audio, chosen by one
 * setting, with a defined answer for having none.
 *
 * ## Why this is not on `AnalysisService`
 *
 * It was, for one commit. Joining and measuring genuinely are the same work seen from the other end
 * — both need decoded PCM, and the bundled adapter still serves both off one sidecar with one
 * address — but that is an argument about the ADAPTER, and it was read as an argument about the
 * KEY. Reached through `AnalysisService.analyzer()`, the station's joiner was whichever plugin the
 * operator chose to MEASURE with: a second analyzer that measures better and cannot join takes
 * joining away, and the only remedy is to select a worse analyzer. `render.mixerPluginId` is the
 * other key, and one plugin declaring both capabilities is ordinary rather than a compromise.
 */
@Injectable()
export class MixerService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The plugin id the operator chose, or an empty string for "they have not".
     *
     * From the config rather than the settings repository, so this costs no query and no scope:
     * `deadair.settings` is a layer of the app's config, and a write to the row is live here on the
     * next read.
     */
    private get configuredMixer(): string {
        return this.config.get(MIXER_PLUGIN_KEY, '');
    }

    /**
     * Every plugin that could join right now, in a stable order.
     *
     * Sorted, and it is load-bearing rather than tidy: an unset key takes the FIRST candidate, and
     * installation order is whatever the disk scan found, so without this a station with two mixers
     * could join with a different one after a restart and nothing would say so.
     */
    mixers(): MixerPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asMixerPlugin).sort(byPluginId);
    }

    /**
     * Mixer plugins that are installed and enabled but currently quarantined, for
     * {@link explainDefaultMixer}'s sentence.
     *
     * Read straight from the registry rather than from {@link mixers}, which excludes them for an
     * unrelated reason (`asMixerPlugin` declines anything not `active`), so a `failed` plugin never
     * shows up in "X could too" on its own. Without naming it here, a quarantine that narrows the
     * field to one mixer reads as though nothing else was ever installed.
     */
    private quarantinedMixers(): string[] {
        return this.pluginRegistry
            .list()
            .filter(record => record.status === 'failed' && record.manifest?.capabilities.includes(PLUGIN_CAPABILITY_MIXER) === true)
            .map(record => record.id);
    }

    /**
     * The plugin the station joins with, or `undefined` with a reason logged.
     *
     * **A station with no mixer is an ordinary state, not a fault**, the way one with no analyzer
     * and one with no model are: a production whose beats cannot be joined airs as a block of beats,
     * which is what it did before anything could join them. So this reports rather than throws.
     */
    mixer(): MixerPlugin | undefined {
        const candidates = this.mixers();
        const configured = this.configuredMixer;
        const chosen = selectMixerPlugin(candidates, configured);

        if (chosen === undefined) {
            this.logger.info('render: nothing to join audio with', { reason: explainNoMixer(candidates, configured) });
            return undefined;
        }

        // On the edge only, for `SpeechService.speaker`'s reason, and it matters here for
        // `AnalysisService.analyzer`'s: nothing about a programme joined by a plugin nobody chose
        // looks wrong from the outside, so this line is the only place it is ever said.
        if (defaultPickIsNews(chosen, candidates, MIXER_PLUGIN_KEY, configured)) {
            this.logger.info(`render: ${explainDefaultMixer(chosen, candidates, this.quarantinedMixers())}`);
        }
        return chosen;
    }

    /**
     * Several pieces of audio as one, or `undefined` with the reason logged.
     *
     * Nothing here interprets the bytes — they are a stream the caller writes straight into a store.
     *
     * **Answering `undefined` is an ordinary outcome**, and there are two ways to reach it: no mixer
     * at all, and a join that failed. The caller has one answer to both, which is why they are not
     * told apart here. There were three before the capability split, the third being an analyzer
     * that could not join, which is no longer expressible.
     *
     * @param label - What this is, for the log line. Not read back.
     * @param urls - The parts in order, each reachable from wherever the joining happens — a sidecar
     *               container rather than this process.
     * @param gapMs - The silence between the parts.
     * @param options - Anything beyond a plain sequence. An options bag rather than a fourth
     *                  positional argument, because the next thing after overlays is a fifth, and a
     *                  call site reading `join(label, urls, 60, [], undefined)` says nothing about
     *                  what it wants.
     */
    async join(
        label: string,
        urls: readonly string[],
        gapMs: number,
        options: { overlays?: readonly AudioOverlay[] } = {},
    ): Promise<JoinedAudio | undefined> {
        const mixer = this.mixer();
        if (mixer === undefined) return undefined;

        const request: AudioJoin = {
            parts: urls.map(url => ({ url })),
            gapMs,
            // Omitted rather than sent empty, so an ordinary join puts the same request on the wire
            // it did before overlays existed.
            ...(options.overlays === undefined || options.overlays.length === 0 ? {} : { overlays: [...options.overlays] }),
        };

        try {
            return await this.pluginInvoker.invoke(mixer.record.id, 'mixer.join', async () => mixer.instance.join(request), {
                timeoutMs: JOIN_INVOKE_TIMEOUT_MS,
            });
        } catch (error) {
            this.logger.warn('render: could not join audio', { label, parts: urls.length, error: errorText(error) });
            return undefined;
        }
    }
}
