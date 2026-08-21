import {
    configBaseUrl,
    configString,
    Plugin,
    PluginError,
    tryJsonBody,
    type PluginConnectionResult,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
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

/**
 * The engine's body, with a size check on the end of it.
 *
 * The check belongs at the end rather than on the first chunk: a server can
 * dribble a short JSON error out in several pieces, and "was any of this
 * plausibly audio" is only answerable once it stops. Failing in `flush` is what
 * makes the render fail loudly instead of storing a click.
 *
 * A `TransformStream` rather than a wrapper of our own, so cancelling the
 * result still cancels the socket underneath without anything here to forward
 * it.
 */
const withPlausibilityCheck = (voice: string): TransformStream<Uint8Array, Uint8Array> => {
    let delivered = 0;

    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            delivered += chunk.byteLength;
            controller.enqueue(chunk);
        },
        flush() {
            if (delivered >= MIN_PLAUSIBLE_AUDIO_BYTES) return;
            throw new PluginError(
                `kokoro returned only ${delivered} bytes for voice "${voice}", which is not audio: check the model and voice`,
            ).withCode('upstream');
        },
    });
};

/**
 * Text to speech through any OpenAI-compatible `/audio/speech`.
 *
 * Written against the bundled Kokoro container and deliberately not written
 * against Kokoro alone: the same three fields reach OpenAI's own endpoint, which
 * is the difference between an operator with a GPU and one without.
 *
 * ## Why the audio is a stream and not a return value
 *
 * `speak` starts the request and hands back its body, so a long script is bytes
 * in flight rather than a file held whole. The host reads it to the end or
 * cancels it, and either one reaches the socket without this plugin forwarding
 * anything: it is the engine's own response body, with a size check bolted on.
 */
export class KokoroPlugin extends Plugin implements SpeechPluginInstance {
    private baseUrl = '';
    private apiKey?: string;
    private model = DEFAULT_MODEL;
    private format: ResponseFormat = DEFAULT_FORMAT;
    private defaultVoice = DEFAULT_VOICE;
    private voices: Record<string, string> = {};

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        this.voices = voiceMapOf(config.voices);
        this.apiKey = await this.host.secrets.get('apiKey');

        this.host.logger.info('kokoro ready', {
            baseUrl: this.baseUrl,
            model: this.model,
            format: this.format,
            voices: Object.keys(this.voices).length,
        });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };

        const response = await this.host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) return { ok: false, message: `Server answered HTTP ${response.status}.` };

        // Reported rather than validated against: the operator's own mappings are
        // what matter, and a server whose voice list is shaped differently is
        // still a server that speaks.
        const body = await tryJsonBody<{ voices?: unknown[] }>(response);
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
            spec: engineVoice,
        }));

        // Always offer the fallback, under its own name, so a station with no
        // mappings at all still has something to preview and choose.
        return [{ id: '', label: 'Default', description: `${this.defaultVoice} on this server`, spec: this.defaultVoice }, ...mapped];
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (this.baseUrl.length === 0) {
            throw new PluginError('kokoro has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('kokoro was asked to say nothing').withCode('config');

        const format = isResponseFormat(request.format) ? request.format : this.format;
        const voice = this.resolveVoice(request.voice);

        const response = await this.host.fetch(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify({ model: this.model, input: text, voice, response_format: format }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        if (!response.ok || response.body === null) {
            // Nobody else is going to read this, and an error body is small
            // enough that letting the socket go is the whole of the cleanup.
            await response.body?.cancel().catch(() => {});
            throw new PluginError(`kokoro answered HTTP ${response.status} for voice "${voice}"`)
                .withCode(response.status === 401 || response.status === 403 ? 'auth' : 'upstream')
                .withUpstreamStatus(response.status);
        }

        this.host.logger.debug('kokoro speaking', { voice, format, chars: text.length });

        return { mime: RESPONSE_FORMATS[format], audio: response.body.pipeThrough(withPlausibilityCheck(voice)) };
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

        this.host.logger.warn('no mapping for this voice; using the default', { voice: requested, using: this.defaultVoice });
        return this.defaultVoice;
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    }
}

const isResponseFormat = (value: unknown): value is ResponseFormat => typeof value === 'string' && Object.hasOwn(RESPONSE_FORMATS, value);
