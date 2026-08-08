import {
    PluginError,
    tryJsonBody,
    type PluginConnectionResult,
    type PluginHost,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
    type StreamChunk,
} from '@deadair/plugin-sdk';
import {
    DEFAULT_FORMAT,
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    PROBE_TIMEOUT_MS,
    RESPONSE_FORMATS,
    SPEAK_TIMEOUT_MS,
    kokoroManifest,
    type ResponseFormat,
} from './kokoro.manifest.js';
import { voiceMapOf } from './kokoro.voices.js';

export { kokoroManifest };

/**
 * Below this, what came back is a JSON error page or an empty reply, not audio.
 *
 * Ported from v1, where it was paid for: a server that answers 200 with a
 * complaint about the voice produces a segment that airs as a click, and the
 * only place to notice is here. A real line is tens of kilobytes.
 */
const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/** One in-flight synthesis: our handle id, and the host stream behind it. */
interface Speaking {
    hostStreamId: string;
    /** Bytes handed over so far, to catch a body that is not audio on the first read. */
    delivered: number;
}

/**
 * Text to speech through any OpenAI-compatible `/audio/speech`.
 *
 * Written against the bundled Kokoro container and deliberately not written
 * against Kokoro alone: the same three fields reach OpenAI's own endpoint, which
 * is the difference between an operator with a GPU and one without.
 *
 * ## Why the audio is a handle and not a return value
 *
 * `speak` opens the request and stops. The bytes come out through
 * `readStream`, which forwards to the host stream underneath, so a long script
 * is a sequence of chunks rather than a file held whole in two processes. The
 * host closes anything still open when this plugin is disposed, and this closes
 * its own side in `closeStream`, which the host calls from a `finally`.
 */
export class KokoroPlugin implements SpeechPluginInstance {
    private host?: PluginHost;
    private baseUrl = '';
    private apiKey?: string;
    private model = DEFAULT_MODEL;
    private format: ResponseFormat = DEFAULT_FORMAT;
    private defaultVoice = DEFAULT_VOICE;
    private voices: Record<string, string> = {};

    /** Our stream ids, never the host's. The two are kept apart on purpose. */
    private readonly speaking = new Map<string, Speaking>();

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = await host.config.get();
        this.baseUrl = trimSlashes(typeof config.baseUrl === 'string' ? config.baseUrl : '');
        this.model = nonEmpty(config.model) ?? DEFAULT_MODEL;
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.defaultVoice = nonEmpty(config.defaultVoice) ?? DEFAULT_VOICE;
        this.voices = voiceMapOf(config.voices);
        this.apiKey = await host.secrets.get('apiKey');

        host.logger.info('kokoro ready', { baseUrl: this.baseUrl, model: this.model, format: this.format, voices: Object.keys(this.voices).length });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.hostOrThrow();
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };

        const response = await host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) return { ok: false, message: `Server answered HTTP ${response.status}.` };

        // Reported rather than validated against: the operator's own mappings are
        // what matter, and a server whose voice list is shaped differently is
        // still a server that speaks.
        const body = tryJsonBody<{ voices?: unknown[] }>(response);
        const count = Array.isArray(body?.voices) ? body.voices.length : undefined;
        return { ok: true, message: count === undefined ? 'Connected.' : `Connected. ${count} voices available.` };
    }

    /**
     * The station's own voice names, as the console lists them.
     *
     * These are the ids the host may pass back, so this reports the mappings
     * rather than everything the engine can do: a voice Kokoro has and the
     * operator never named is not something the station can ask for. The engine
     * voice is the label, because when choosing between them that is the part
     * that differs.
     */
    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, engineVoice]) => ({
            id,
            label: id,
            description: `${engineVoice} on this server`,
        }));

        // Always offer the fallback, under its own name, so a station with no
        // mappings at all still has something to preview and choose.
        return [{ id: '', label: 'Default', description: `${this.defaultVoice} on this server` }, ...mapped];
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        const host = this.hostOrThrow();
        if (this.baseUrl.length === 0) {
            throw new PluginError('kokoro has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('kokoro was asked to say nothing').withCode('config');

        const format = isResponseFormat(request.format) ? request.format : this.format;
        const voice = this.resolveVoice(request.voice);

        const opened = await host.streams.open(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify({ model: this.model, input: text, voice, response_format: format }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        if (!opened.ok) {
            // Nothing is registered yet, so this is the only chance to let the
            // socket go.
            await host.streams.close(opened.streamId);
            throw new PluginError(`kokoro answered HTTP ${opened.status} for voice "${voice}"`)
                .withCode(opened.status === 401 || opened.status === 403 ? 'auth' : 'upstream')
                .withUpstreamStatus(opened.status);
        }

        const streamId = `speak-${opened.streamId}`;
        this.speaking.set(streamId, { hostStreamId: opened.streamId, delivered: 0 });
        host.logger.debug('kokoro speaking', { voice, format, chars: text.length });

        return { streamId, mime: RESPONSE_FORMATS[format] };
    }

    async readStream(streamId: string, maxBytes?: number): Promise<StreamChunk> {
        const host = this.hostOrThrow();
        const speaking = this.speaking.get(streamId);
        if (speaking === undefined) throw new PluginError(`kokoro has no stream "${streamId}"`).withCode('not_found');

        const chunk = await host.streams.read(speaking.hostStreamId, maxBytes);

        if (chunk.done) {
            // The size check belongs here rather than on the first chunk: a
            // server can dribble a short JSON error out in several pieces, and
            // "was any of this plausibly audio" is only answerable at the end.
            if (speaking.delivered < MIN_PLAUSIBLE_AUDIO_BYTES) {
                await this.closeStream(streamId);
                throw new PluginError(
                    `kokoro returned only ${speaking.delivered} bytes, which is not audio — check the model and voice`,
                ).withCode('upstream');
            }
            this.speaking.delete(streamId);
            return { seq: chunk.seq, done: true };
        }

        speaking.delivered += decodedLength(chunk.data);
        return { seq: chunk.seq, data: chunk.data, done: false };
    }

    async closeStream(streamId: string): Promise<void> {
        const speaking = this.speaking.get(streamId);
        // Idempotent: the host calls this from a `finally`, so it routinely
        // arrives for a stream that already ended normally.
        if (speaking === undefined) return;

        this.speaking.delete(streamId);
        await this.host?.streams.close(speaking.hostStreamId);
    }

    async dispose(): Promise<void> {
        // The host closes what it still holds when it drops this instance, so
        // this is only about not leaving a stale map behind for a reinit.
        for (const streamId of [...this.speaking.keys()]) await this.closeStream(streamId);
        this.host = undefined;
    }

    /**
     * A station voice name, as an engine voice.
     *
     * An unmapped name falls back rather than failing, and says so once: a
     * station that says the wrong thing in the wrong voice is recoverable, and
     * one that goes silent because a persona was renamed is not.
     */
    private resolveVoice(requested: string | undefined): string {
        if (requested === undefined || requested.length === 0) return this.defaultVoice;

        const mapped = this.voices[requested];
        if (mapped !== undefined) return mapped;

        this.host?.logger.warn('no mapping for this voice; using the default', { voice: requested, using: this.defaultVoice });
        return this.defaultVoice;
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    }

    private hostOrThrow(): PluginHost {
        if (!this.host) throw new PluginError('kokoro: init() was never called').withCode('internal');
        return this.host;
    }
}

/** How many bytes a base64 chunk actually carries. */
const decodedLength = (data: string | undefined): number => (data === undefined ? 0 : Buffer.from(data, 'base64').byteLength);

const nonEmpty = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

/** The base URL without a trailing slash, so paths can be appended with one. */
const trimSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

const isResponseFormat = (value: unknown): value is ResponseFormat =>
    typeof value === 'string' && Object.hasOwn(RESPONSE_FORMATS, value);
