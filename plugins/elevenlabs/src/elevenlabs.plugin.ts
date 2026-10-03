import {
    configString,
    errorText,
    plausibleAudio,
    Plugin,
    PluginError,
    tryJsonBody,
    type PluginConnectionResult,
    type PluginHost,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
} from '@deadair/plugin-sdk';
import { speakFailure } from './elevenlabs.errors.js';
import {
    API_BASE,
    DEFAULT_OUTPUT_FORMAT,
    DEFAULT_VOICE,
    PROBE_TIMEOUT_MS,
    SPEAK_TIMEOUT_MS,
    elevenlabsManifest,
    isOutputFormat,
    type OutputFormat,
} from './elevenlabs.manifest.js';
import { DEFAULT_MODEL, settingsOf } from './elevenlabs.models.js';
import { VOICES_FIELD, voiceMapOf, type VoiceMap, type VoiceMapping, type VoiceSettings } from './elevenlabs.voices.js';

export { elevenlabsManifest };

/**
 * What the station files the audio under.
 *
 * Fixed rather than read off the response, unlike `plugins/rhapsode`, because every format this
 * plugin asks for is MP3: the only way the header could differ from this is to name MP3 another
 * way (`audio/mp3`), which the segment store has no extension for.
 */
const MP3_MIME = 'audio/mpeg';

/**
 * Text to speech through ElevenLabs.
 *
 * The first speech plugin that talks to somebody else's computer. Everything else about it is
 * `plugins/kokoro`'s shape: a station voice is a row in this plugin's own table, `speak` hands back
 * the service's own response body with a size check bolted on, and nothing is held between calls.
 */
export class ElevenLabsPlugin extends Plugin implements SpeechPluginInstance {
    private apiKey?: string;
    private model: string = DEFAULT_MODEL;
    private format: OutputFormat = DEFAULT_OUTPUT_FORMAT;
    private defaultVoice = DEFAULT_VOICE;
    private voices: VoiceMap = {};

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = await host.config.get();
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.format = isOutputFormat(config.format) ? config.format : DEFAULT_OUTPUT_FORMAT;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        this.voices = voiceMapOf(config[VOICES_FIELD]);
        this.apiKey = configString(await host.secrets.get('apiKey'));

        host.logger.info('elevenlabs ready', {
            model: this.model,
            format: this.format,
            voices: Object.keys(this.voices).length,
            keyed: this.apiKey !== undefined,
        });
    }

    /**
     * Whether the key works, as an ANSWER rather than as a throw.
     *
     * `plugins/kokoro`'s contract: a throw here is a failed call, and three presses of Test connection
     * would quarantine a plugin the station was still using.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.apiKey === undefined) return { ok: false, message: 'No API key set.' };

        let response: Response;
        try {
            response = await host.fetch(`${API_BASE}/v1/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        } catch (error) {
            return { ok: false, message: `Could not reach ElevenLabs: ${errorText(error)}` };
        }

        if (!response.ok) {
            const failure = await speakFailure(response, { voice: '(listing voices)', model: this.model });
            return { ok: false, message: failure.message };
        }

        const body = await tryJsonBody<{ voices?: unknown[] }>(response).catch(() => undefined);
        const count = Array.isArray(body?.voices) ? body.voices.length : undefined;
        return { ok: true, message: count === undefined ? 'Connected.' : `Connected. ${count} voices on this account.` };
    }

    /**
     * The station's own voice names, as the console lists them.
     *
     * The mappings rather than the account's whole library, since only a mapped name is something the
     * station can ask for, plus the default under its own name so a station with no rows still has
     * something to preview.
     */
    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, mapping]) => ({
            id,
            label: id,
            description: describe(mapping),
            spec: this.specOf(mapping),
        }));

        const fallback: VoiceMapping = { voice: this.defaultVoice, settings: {} };
        return [{ id: '', label: 'Default', description: describe(fallback), spec: this.specOf(fallback) }, ...mapped];
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        const host = this.host;
        if (this.apiKey === undefined) throw new PluginError('elevenlabs has no API key configured').withCode('config');

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('elevenlabs was asked to say nothing').withCode('config');

        const mapping = this.resolveVoice(host, request.voice);
        const settings = this.sendable(mapping.settings);

        const url = `${API_BASE}/v1/text-to-speech/${encodeURIComponent(mapping.voice)}?output_format=${this.format}`;
        const response = await host.fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: MP3_MIME, ...this.authHeaders() },
            body: JSON.stringify({
                text,
                model_id: this.model,
                // Omitted when the row set nothing, so the voice reads with the settings it was saved
                // with in ElevenLabs rather than with the API's textbook defaults.
                ...(Object.keys(settings).length === 0 ? {} : { voice_settings: settings }),
            }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        if (!response.ok || response.body === null) {
            throw await speakFailure(response, { voice: mapping.voice, model: this.model });
        }

        host.logger.debug('elevenlabs speaking', { voice: mapping.voice, model: this.model, chars: text.length, ...settings });

        return {
            mime: MP3_MIME,
            audio: response.body.pipeThrough(
                plausibleAudio({
                    engine: 'elevenlabs',
                    asked: `voice "${mapping.voice}" on ${this.model}`,
                    advice: 'check the voice id and the model',
                }),
            ),
        };
    }

    /**
     * A station voice name, as an ElevenLabs voice.
     *
     * An unmapped name falls back rather than failing, and says so: a station that says the right
     * thing in the wrong voice is recoverable, and one that goes silent because a persona was renamed
     * is not.
     */
    private resolveVoice(host: PluginHost, requested: string | undefined): VoiceMapping {
        if (requested === undefined || requested.length === 0) return { voice: this.defaultVoice, settings: {} };

        const mapped = this.voices[requested];
        if (mapped !== undefined) return mapped;

        host.logger.warn('no mapping for this voice; using the default', { voice: requested, using: this.defaultVoice });
        return { voice: this.defaultVoice, settings: {} };
    }

    /** The row's settings, less any the configured model does not read. */
    private sendable(settings: VoiceSettings): VoiceSettings {
        const allowed = settingsOf(this.model);
        return Object.fromEntries(Object.entries(settings).filter(([key]) => allowed.includes(key as keyof VoiceSettings)));
    }

    /**
     * The token the host keys a cached voice preview on. See `SpeechVoice.spec`.
     *
     * Changes whenever the rendering would: the voice, the model, and every setting actually SENT,
     * so a speed typed against v4 (which does not read it) does not re-key a preview that would sound
     * identical.
     */
    private specOf(mapping: VoiceMapping): string {
        const settings = Object.entries(this.sendable(mapping.settings))
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
        return [mapping.voice, this.model, ...(settings.length > 0 ? [settings] : [])].join('@');
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey === undefined ? {} : { 'xi-api-key': this.apiKey };
    }
}

/** What a mapping is, for the console's list. */
const describe = (mapping: VoiceMapping): string => {
    const settings = Object.entries(mapping.settings).map(([key, value]) => `${key.replace('_boost', '')} ${value}`);
    return settings.length === 0 ? `ElevenLabs voice ${mapping.voice}` : `ElevenLabs voice ${mapping.voice}, ${settings.join(', ')}`;
};
