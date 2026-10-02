import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { isPluginError, PLUGIN_CAPABILITY_TRANSCODE, type AudioTranscode, type TranscodedAudio } from '@deadair/plugin-sdk';
import { asTranscodePlugin, type TranscodePlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, defaultPickIsNews, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { explainDefaultTranscoder, explainNoTranscoder, selectTranscodePlugin, TRANSCODE_PLUGIN_KEY } from './transcode.settings.js';

/**
 * How long a copy may take, as the host's invocation deadline.
 *
 * Above the bundled adapter's own `TRANSCODE_TIMEOUT_MS`, so the plugin's timeout is the one that
 * fires and its error says what happened, on `JOIN_INVOKE_TIMEOUT_MS`'s argument.
 */
export const TRANSCODE_INVOKE_TIMEOUT_MS = 90_000;

/**
 * What came of asking for a copy.
 *
 * Three ways not to get one, told apart because the caller answers them differently: a station that
 * has nothing to encode with, or whose encoder cannot, is a state (503, try another day); one whose
 * encoder tried and failed is a fault (502, worth a log line and another try).
 */
export type TranscodeOutcome = { ok: true; copy: TranscodedAudio } | { ok: false; reason: 'none' | 'unsupported' | 'failed'; message: string };

/**
 * What the station makes copies of its audio with.
 *
 * `MixerService`'s shape one capability over, and for its reasons: one plugin chosen by one setting
 * (`render.transcodePluginId`), the first by id when nobody chose, and that pick said aloud the first
 * time it is made. Nothing here touches a byte: the copy is a stream the caller writes straight into
 * a store, because encoding does not happen in Node.
 */
@Injectable()
export class TranscodeService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Every plugin that could make a copy right now, in a stable order, for `MixerService.mixers`' reason. */
    transcoders(): TranscodePlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asTranscodePlugin).sort(byPluginId);
    }

    private quarantined(): string[] {
        return this.pluginRegistry
            .list()
            .filter(record => record.status === 'failed' && record.manifest?.capabilities.includes(PLUGIN_CAPABILITY_TRANSCODE) === true)
            .map(record => record.id);
    }

    /** The plugin the station makes copies with, or why there is none. */
    private transcoder(): TranscodePlugin | string {
        const candidates = this.transcoders();
        const configured = this.config.get(TRANSCODE_PLUGIN_KEY, '');
        const chosen = selectTranscodePlugin(candidates, configured);

        if (chosen === undefined) return explainNoTranscoder(candidates, configured);

        if (defaultPickIsNews(chosen, candidates, TRANSCODE_PLUGIN_KEY, configured)) {
            this.logger.info(`render: ${explainDefaultTranscoder(chosen, candidates, this.quarantined())}`);
        }
        return chosen;
    }

    /**
     * A smaller copy of the audio at `request.url`.
     *
     * @param label - What this is, for the log line. Not read back.
     * @param request - The url must be reachable from wherever the encoding happens, which is a
     *                  sidecar container rather than this process, so the caller signs it.
     */
    async transcode(label: string, request: AudioTranscode): Promise<TranscodeOutcome> {
        const transcoder = this.transcoder();
        if (typeof transcoder === 'string') {
            this.logger.info('render: nothing to make a copy with', { label, reason: transcoder });
            return { ok: false, reason: 'none', message: transcoder };
        }

        try {
            const copy = await this.pluginInvoker.invoke(
                transcoder.record.id,
                'transcode.transcode',
                async () => transcoder.instance.transcode(request),
                {
                    timeoutMs: TRANSCODE_INVOKE_TIMEOUT_MS,
                },
            );
            return { ok: true, copy };
        } catch (error) {
            if (isPluginError(error) && error.code === 'unsupported') {
                return { ok: false, reason: 'unsupported', message: `${transcoder.record.id} cannot make copies of audio` };
            }
            this.logger.warn('render: could not make a copy of audio', { label, plugin: transcoder.record.id, error: errorText(error) });
            return { ok: false, reason: 'failed', message: errorText(error) };
        }
    }
}
