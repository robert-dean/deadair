import {
    configBaseUrl,
    configString,
    Plugin,
    PluginError,
    tryJsonBody,
    type ConfigFieldOption,
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
    shippedUnlessMapped,
    type ResponseFormat,
} from './kokoro.manifest.js';
import { VOICE_ENGINE_COLUMN, VOICES_FIELD, type VoiceMap, type VoiceMapping } from './kokoro.voices.js';

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
    private voices: VoiceMap = {};

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        // An EMPTY table means the shipped map, exactly as an absent one does. This read `?? ` for
        // as long as it existed, on the argument that a station clearing the box wants one voice
        // where a station clearing `rotation.breakTemplates` would want the station's phrasings
        // back — a real distinction the console cannot express: it submits every declared field on
        // every save, so a `list` nobody has touched is stored as "[]" the moment an operator
        // changes the server URL beside it. Never-opened was therefore the only way to keep the
        // rows and an ordinary save the way to lose them, silently. Measured on this station: a
        // chatterbox row holding `"voices":"[]"` collapsed nineteen characters onto one voice.
        this.voices = shippedUnlessMapped(config[VOICES_FIELD]);
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
        const mapped = Object.entries(this.voices).map(([id, mapping]) => ({
            id,
            label: id,
            description: describe(mapping),
            spec: specOf(mapping),
        }));

        // Always offer the fallback, under its own name, so a station with no
        // mappings at all still has something to preview and choose.
        const fallback: VoiceMapping = { engine: this.defaultVoice };
        return [{ id: '', label: 'Default', description: describe(fallback), spec: specOf(fallback) }, ...mapped];
    }

    /**
     * What the settings form should offer, out of what the server actually has.
     *
     * This is what makes the form fillable, and the measurement behind it is
     * blunt: 68 voicepacks on the bundled server, and a station whose map held
     * the empty string, because filling it in required knowing `af_heart` by
     * heart. `testConnection` has always fetched this list and thrown it away
     * after counting it.
     *
     * Both fields get the same list and use it differently. The engine cell of
     * each voice row is free text WITH these as suggestions, because the server's
     * list is not the whole vocabulary — a blend expression names no single
     * voicepack and is a legal value — and the default voice is the same. The
     * column is addressed as `<field>.<column>`, which is how the host publishes
     * choices for one cell of a list rather than for the field.
     *
     * Answers nothing rather than throwing when the server is unreachable: an
     * operator fixing a bad address needs the form, and the refresh control is
     * right there.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        if (this.baseUrl.length === 0) return {};

        let voices: string[];
        try {
            voices = await this.fetchEngineVoices();
        } catch (error) {
            this.host.logger.debug('kokoro could not suggest voices', { error: error instanceof Error ? error.message : String(error) });
            return {};
        }

        if (voices.length === 0) return {};

        const options = voices.map(id => ({ value: id, label: id }));
        return { [`${VOICES_FIELD}.${VOICE_ENGINE_COLUMN}`]: options, defaultVoice: options };
    }

    /**
     * Every voice this server holds, by name.
     *
     * The bundled engine answers `{ voices: [{ id, name }] }` and other builds
     * have answered a bare array of strings, so both shapes are read and anything
     * else is no voices rather than a throw. Reported as ids, since that is what
     * goes in the request.
     */
    private async fetchEngineVoices(): Promise<string[]> {
        const response = await this.host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return [];
        }

        const body = await tryJsonBody<{ voices?: unknown }>(response);
        const listed = Array.isArray(body?.voices) ? body.voices : [];

        return listed.flatMap(entry => {
            if (typeof entry === 'string') return entry.trim().length > 0 ? [entry.trim()] : [];
            if (typeof entry !== 'object' || entry === null) return [];

            const id = (entry as { id?: unknown }).id;
            return typeof id === 'string' && id.trim().length > 0 ? [id.trim()] : [];
        });
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (this.baseUrl.length === 0) {
            throw new PluginError('kokoro has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('kokoro was asked to say nothing').withCode('config');

        const format = isResponseFormat(request.format) ? request.format : this.format;
        const mapping = this.resolveVoice(request.voice);
        const voice = mapping.engine;

        const response = await this.host.fetch(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify({
                model: this.model,
                input: text,
                voice,
                response_format: format,
                // Omitted rather than sent as 1 when the operator set no speed. A request with no
                // `speed` is the plainest thing this can ask for, and it is what every voice asked
                // for before the column existed.
                ...(mapping.speed === undefined ? {} : { speed: mapping.speed }),
            }),
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

        this.host.logger.debug('kokoro speaking', {
            voice,
            format,
            chars: text.length,
            ...(mapping.speed === undefined ? {} : { speed: mapping.speed }),
        });

        return { mime: RESPONSE_FORMATS[format], audio: response.body.pipeThrough(withPlausibilityCheck(voice)) };
    }

    /**
     * A station voice name, as an engine voice.
     *
     * An unmapped name falls back rather than failing, and says so once: a
     * station that says the wrong thing in the wrong voice is recoverable, and
     * one that goes silent because a persona was renamed is not.
     */
    private resolveVoice(requested: string | undefined): VoiceMapping {
        if (requested === undefined || requested.length === 0) return { engine: this.defaultVoice };

        const mapped = this.voices[requested];
        if (mapped !== undefined) return mapped;

        this.host.logger.warn('no mapping for this voice; using the default', { voice: requested, using: this.defaultVoice });
        return { engine: this.defaultVoice };
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    }
}

const isResponseFormat = (value: unknown): value is ResponseFormat => typeof value === 'string' && Object.hasOwn(RESPONSE_FORMATS, value);

/** What a mapping sounds like, for the console's list. The speed is only worth saying when set. */
const describe = (mapping: VoiceMapping): string =>
    mapping.speed === undefined ? `${mapping.engine} on this server` : `${mapping.engine} on this server, at ${mapping.speed}x`;

/**
 * The token the host keys a cached voice preview on. See `SpeechVoice.spec`.
 *
 * Opaque to the host, so the only rule is that it change whenever the rendering
 * would: both halves of the mapping are in it, and a voice with no speed reads as
 * a different token from the same voice at 1x deliberately, because those are two
 * different requests.
 */
const specOf = (mapping: VoiceMapping): string => (mapping.speed === undefined ? mapping.engine : `${mapping.engine}@${mapping.speed}`);
