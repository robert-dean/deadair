import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError, type SpeechRequest, type SpeechVoice } from '@deadair/plugin-sdk';
import { asSpeechPlugin, type SpeechPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { explainNoSpeaker, selectSpeechPlugin, SPEECH_PLUGIN_KEY } from './speech.settings.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentExtension } from './segment.store.js';
import type { VoiceSampleStore } from './voice.sample.store.js';

/**
 * How long one `speak` may take before the host abandons it.
 *
 * Far above the 15s a call into plugin code gets by default, because this is not a call anybody is
 * waiting on and Kokoro on CPU genuinely thinks for a while. It bounds the request and its headers
 * only — the audio arrives afterwards, under `host.streams`' own idle and lifetime caps.
 */
export const SPEAK_TIMEOUT_MS = 120_000;

/**
 * How long one chunk may take.
 *
 * Its own budget rather than a share of the whole render, because each read is a separate call into
 * plugin code with its own deadline. Generous enough for a server that pauses mid-generation and
 * short enough that a dead socket is not the station's problem for two minutes.
 */
export const READ_CHUNK_TIMEOUT_MS = 45_000;

/** Asked for per read. A compromise between round trips across the boundary and bytes held at once. */
export const READ_CHUNK_BYTES = 256 * 1024;

/**
 * A hard stop on how many chunks one render may take.
 *
 * The plugin's stream is bounded by the host's own byte and lifetime caps, so this is not the real
 * defence — it is the one that catches a plugin implementing `readStream` as an infinite supply of
 * empty non-terminal chunks, which no host bound would ever trip. Cheap, and the alternative is a
 * job that never ends.
 */
export const MAX_CHUNKS = 100_000;

/** Reverse of {@link SEGMENT_CONTENT_TYPES}: what a plugin's declared mime is stored as. */
const EXTENSION_BY_MIME = new Map<string, SegmentExtension>(
    (Object.entries(SEGMENT_CONTENT_TYPES) as [SegmentExtension, string][]).map(([ext, mime]) => [mime, ext]),
);

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
 * The one place that knows how to do it, and deliberately so: the render job, and later anything
 * that wants a voice preview, both come through here rather than each learning the drain-and-store
 * dance. Everything about which plugin, how long it gets, and how the bytes reach disk is settled
 * in this file.
 *
 * ## Nothing holds the audio
 *
 * `speak` hands back a handle, this drains it a chunk at a time, and the chunks go straight into
 * the content-addressed store, which hashes as it writes. A five-minute talk break is a buffer of a
 * few hundred kilobytes here and a file on disk, never a `Buffer` of the whole thing. That is what
 * the byte protocol in `docs/decisions/plugin-streaming.md` bought and this is its first caller.
 *
 * Scoped, like the repositories it sits beside: called from a job's scope today.
 */
@Injectable()
export class SpeechService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly settings: SettingsRepository,
        private readonly store: SegmentStore,
        private readonly logger: Logger,
    ) {}

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
    async speaker(): Promise<SpeechPlugin | undefined> {
        const candidates = this.speakers();
        const configured = await this.settings.get(SPEECH_PLUGIN_KEY);
        const chosen = selectSpeechPlugin(candidates, configured);

        if (chosen === undefined) this.logger.info(`render: nothing to speak with (${explainNoSpeaker(candidates, configured)})`);
        return chosen;
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
        const plugin = await this.speaker();
        if (plugin === undefined) {
            const candidates = this.speakers();
            const reason = explainNoSpeaker(candidates, await this.settings.get(SPEECH_PLUGIN_KEY));
            throw new PluginError(`render: ${reason}`).withCode('unavailable');
        }

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

        const handle = await this.pluginInvoker.invoke(pluginId, 'speech.speak', async () => plugin.instance.speak(request), {
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        const ext = EXTENSION_BY_MIME.get(handle.mime.split(';')[0]!.trim().toLowerCase());
        if (ext === undefined) {
            // Close it before complaining: the plugin has a socket open on our behalf and nothing
            // else will ever ask it to let go.
            await this.closeQuietly(plugin, handle.streamId);
            throw new PluginError(`plugin "${pluginId}" answered with "${handle.mime}", which the segment store cannot hold`).withCode('unsupported');
        }

        try {
            const checksum = await this.store.writeStream(this.drain(plugin, handle.streamId), ext);
            this.logger.info('render: spoke a segment', { plugin: pluginId, voice: request.voice, ext, checksum });
            return { checksum, ext, pluginId };
        } finally {
            // Always, including the ordinary path: `closeStream` is idempotent by contract, and a
            // stream the plugin already finished is exactly the case it promises to no-op on.
            await this.closeQuietly(plugin, handle.streamId);
        }
    }

    /**
     * As {@link SpeechService.speakWith}, but filed under a key the caller chose and streamed
     * straight there.
     *
     * For a cache whose name answers "which voice, saying which line" rather than "which bytes".
     * Same drain, same store, different naming — see {@link VoiceSampleStore}.
     */
    async speakAs(plugin: SpeechPlugin, key: string, store: VoiceSampleStore, request: SpeechRequest): Promise<SegmentExtension> {
        const pluginId = plugin.record.id;

        const handle = await this.pluginInvoker.invoke(pluginId, 'speech.speak', async () => plugin.instance.speak(request), {
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        const ext = EXTENSION_BY_MIME.get(handle.mime.split(';')[0]!.trim().toLowerCase());
        if (ext === undefined) {
            await this.closeQuietly(plugin, handle.streamId);
            throw new PluginError(`plugin "${pluginId}" answered with "${handle.mime}", which the segment store cannot hold`).withCode('unsupported');
        }

        try {
            await store.writeStreamAs(key, this.drain(plugin, handle.streamId), ext);
            return ext;
        } finally {
            await this.closeQuietly(plugin, handle.streamId);
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

    /**
     * The plugin's stream, as bytes.
     *
     * One `readStream` per chunk, each its own invocation with its own deadline, because that is
     * what a stream opened in one call and read from later ones means. Decoding the base64 here is
     * where the boundary's 33% inflation stops.
     */
    private async *drain(plugin: SpeechPlugin, streamId: string): AsyncGenerator<Uint8Array> {
        const pluginId = plugin.record.id;

        for (let chunks = 0; ; chunks++) {
            if (chunks >= MAX_CHUNKS) {
                throw new PluginError(`plugin "${pluginId}" produced more than ${MAX_CHUNKS} chunks without finishing`).withCode('upstream');
            }

            const chunk = await this.pluginInvoker.invoke(
                pluginId,
                'speech.readStream',
                async () => plugin.instance.readStream(streamId, READ_CHUNK_BYTES),
                { timeoutMs: READ_CHUNK_TIMEOUT_MS },
            );

            if (chunk.done) return;
            if (chunk.data === undefined) continue;

            yield Buffer.from(chunk.data, 'base64');
        }
    }

    /**
     * Close a stream and swallow the failure.
     *
     * Cleanup on a path that is already returning or already throwing something more interesting. A
     * plugin that cannot close still has to be let go of, and the host closes whatever is left when
     * the plugin is disposed.
     */
    private async closeQuietly(plugin: SpeechPlugin, streamId: string): Promise<void> {
        try {
            await this.pluginInvoker.invoke(plugin.record.id, 'speech.closeStream', async () => plugin.instance.closeStream(streamId));
        } catch (error) {
            this.logger.warn('render: a speech stream would not close', {
                plugin: plugin.record.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
