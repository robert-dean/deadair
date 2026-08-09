import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError, type SpeechHandle, type SpeechRequest, type SpeechVoice } from '@deadair/plugin-sdk';
import { asSpeechPlugin, type SpeechPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { explainNoSpeaker, selectSpeechPlugin, SPEECH_PLUGIN_KEY } from './speech.settings.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentExtension } from './segment.store.js';
import type { VoiceSampleStore } from './voice.sample.store.js';

/**
 * How long one `speak` may take before the host abandons it.
 *
 * Far above the 15s a call into plugin code gets by default, because this is not a call anybody is
 * waiting on and Kokoro on CPU genuinely thinks for a while. It bounds the request and its headers
 * only: the audio arrives afterwards, under the host's own per-body idle, lifetime and byte caps,
 * which is exactly why a body is not bounded by the invocation that fetched it.
 */
export const SPEAK_TIMEOUT_MS = 120_000;

/** Reverse of {@link SEGMENT_CONTENT_TYPES}: what a plugin's declared mime is stored as. */
const EXTENSION_BY_MIME = new Map<string, SegmentExtension>(
    (Object.entries(SEGMENT_CONTENT_TYPES) as [SegmentExtension, string][]).map(([ext, mime]) => [mime, ext]),
);

/**
 * Let go of audio nobody is going to read, swallowing the failure.
 *
 * Always cleanup on a path that is already returning or already throwing something more
 * interesting, and cancelling a stream that already ended is the ordinary case rather than news.
 * The host cancels whatever a plugin still holds when it is disposed, so this is politeness and
 * promptness, not the only line of defence.
 */
const cancelQuietly = async (audio: ReadableStream<Uint8Array>): Promise<void> => {
    await audio.cancel().catch(() => {});
};

/** What one render produced. */
export interface SpokenAudio {
    checksum: string;
    ext: SegmentExtension;
    /** Which plugin said it, for the log and for the row. */
    pluginId: string;
}

/**
 * Turning words into audio the station owns.
 *
 * The one place that knows how to do it, and deliberately so: the render job, and the voice
 * preview, both come through here rather than each learning the same dance. Everything about which
 * plugin, how long it gets, and how the bytes reach disk is settled in this file.
 *
 * ## Nothing holds the audio
 *
 * `speak` hands back a stream and it goes straight into the content-addressed store, which hashes
 * as it writes. A five-minute talk break is a few hundred kilobytes in flight and a file on disk,
 * never a `Buffer` of the whole thing.
 *
 * There used to be a drain loop here, reading base64 chunks one invocation at a time through a
 * handle protocol, with a chunk-count guard against a plugin that never said `done`. All of it was
 * the cost of a boundary that could not carry a live object. See `docs/decisions/plugin-trust.md`.
 *
 * Scoped, like the repositories it sits beside: called from a job's scope today.
 */
@Injectable()
export class SpeechService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly store: SegmentStore,
        private readonly logger: Logger,
    ) {}

    /**
     * The plugin id the operator chose, or an empty string for "they have not".
     *
     * From the config rather than the settings repository, so this costs no query and no scope:
     * `deadair.settings` is a layer of the app's config, and a write to the row is live here on
     * the next read.
     */
    private get configuredSpeaker(): string {
        return this.config.get(SPEECH_PLUGIN_KEY, '');
    }

    /** Every plugin that could speak right now, in a stable order. */
    speakers(): SpeechPlugin[] {
        const plugins: SpeechPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const plugin = asSpeechPlugin(record);
            if (plugin) plugins.push(plugin);
        }
        return plugins.sort((left, right) => left.record.id.localeCompare(right.record.id));
    }

    /**
     * The plugin the station speaks with, or `undefined` with a reason logged.
     *
     * Not a throw, because every caller so far treats "nobody can speak" as a state rather than a
     * fault: a station with no TTS plugin plays records, which is what it did yesterday.
     */
    speaker(): SpeechPlugin | undefined {
        const candidates = this.speakers();
        const configured = this.configuredSpeaker;
        const chosen = selectSpeechPlugin(candidates, configured);

        if (chosen === undefined) this.logger.info(`render: nothing to speak with (${explainNoSpeaker(candidates, configured)})`);
        return chosen;
    }

    /**
     * Why there is nobody to speak, in a sentence an operator can act on.
     *
     * Here rather than at each caller because there are three of them — a 503, an empty voice list
     * with a reason attached, and the throw below — and every one of them needs the candidates and
     * the configured id together. Answers a sentence even when there IS a speaker, so it is only
     * worth calling once {@link speaker} has said `undefined`.
     */
    explainSpeaker(): string {
        return explainNoSpeaker(this.speakers(), this.configuredSpeaker);
    }

    /**
     * Say something, and keep the audio.
     *
     * @throws {PluginError} `unavailable` when no plugin can speak, `unsupported` when the one
     * chosen answered with a format the store cannot hold, and whatever the plugin itself threw
     * otherwise. Every one of them is a `PluginError`, because `PluginInvoker` flattens anything
     * else, so a caller branches on `code` rather than on a message.
     */
    async speak(request: SpeechRequest): Promise<SpokenAudio> {
        const plugin = this.speaker();
        if (plugin === undefined) throw new PluginError(`render: ${this.explainSpeaker()}`).withCode('unavailable');

        return await this.speakWith(plugin, request);
    }

    /**
     * As {@link SpeechService.speak}, against a plugin the caller already chose.
     *
     * Separate so a voice preview can render through a named plugin without that plugin having to
     * be the station's current speaker: previewing is how an operator decides which one should be.
     */
    async speakWith(plugin: SpeechPlugin, request: SpeechRequest): Promise<SpokenAudio> {
        const pluginId = plugin.record.id;
        const handle = await this.startSpeaking(plugin, request);
        const ext = this.extensionOf(pluginId, handle);

        try {
            const checksum = await this.store.writeStream(handle.audio, ext);
            this.logger.info('render: spoke a segment', { plugin: pluginId, voice: request.voice, ext, checksum });
            return { checksum, ext, pluginId };
        } finally {
            // Always, including the ordinary path, where the stream is drained already and this is
            // a no-op. It is the failure path that needs it: a store write that threw half way
            // leaves the plugin holding a socket nothing else will ever ask it to let go of.
            await cancelQuietly(handle.audio);
        }
    }

    /**
     * As {@link SpeechService.speakWith}, but filed under a key the caller chose and streamed
     * straight there.
     *
     * For a cache whose name answers "which voice, saying which line" rather than "which bytes".
     * Same stream, same store, different naming. See {@link VoiceSampleStore}.
     */
    async speakAs(plugin: SpeechPlugin, key: string, store: VoiceSampleStore, request: SpeechRequest): Promise<SegmentExtension> {
        const handle = await this.startSpeaking(plugin, request);
        const ext = this.extensionOf(plugin.record.id, handle);

        try {
            await store.writeStreamAs(key, handle.audio, ext);
            return ext;
        } finally {
            await cancelQuietly(handle.audio);
        }
    }

    /**
     * The voices one plugin offers, or none when it cannot say.
     *
     * `listVoices` is optional in the SDK, so a plugin without it is not broken and answers an
     * empty list rather than an error.
     */
    async voices(plugin: SpeechPlugin): Promise<SpeechVoice[]> {
        if (!plugin.listsVoices) return [];
        return await this.pluginInvoker.invoke(plugin.record.id, 'speech.listVoices', async () => (await plugin.instance.listVoices?.()) ?? []);
    }

    /** One `speak`, through the invoker on the long budget an engine actually needs. */
    private async startSpeaking(plugin: SpeechPlugin, request: SpeechRequest): Promise<SpeechHandle> {
        return await this.pluginInvoker.invoke(plugin.record.id, 'speech.speak', async () => plugin.instance.speak(request), {
            timeoutMs: SPEAK_TIMEOUT_MS,
        });
    }

    /**
     * What to file the audio as, going by what the plugin says it produced.
     *
     * @throws {PluginError} `unsupported` for a media type the store cannot hold. The stream is
     * cancelled on the way out, because the plugin has a socket open on our behalf and this is the
     * only place that knows it is not wanted.
     */
    private extensionOf(pluginId: string, handle: SpeechHandle): SegmentExtension {
        const ext = EXTENSION_BY_MIME.get(handle.mime.split(';')[0]!.trim().toLowerCase());
        if (ext !== undefined) return ext;

        void cancelQuietly(handle.audio);
        throw new PluginError(`plugin "${pluginId}" answered with "${handle.mime}", which the segment store cannot hold`).withCode('unsupported');
    }
}
