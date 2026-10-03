import {
    configString,
    errorText,
    plausibleAudio,
    Plugin,
    PluginError,
    tryJsonBody,
    type ConfigFieldOption,
    type PluginConnectionResult,
    type PluginHost,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechCue,
    type SpeechDelivery,
    type SpeechLimits,
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
import { DEFAULT_MODEL, MODELS, settingsOf, tagsOf, takesLanguageCode, traitsOf, type ModelTraits } from './elevenlabs.models.js';
import { performed } from './elevenlabs.tags.js';
import { VOICE_VOICE_COLUMN, VOICES_FIELD, voiceMapOf, type VoiceMap, type VoiceMapping, type VoiceSettings } from './elevenlabs.voices.js';

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

    /** The configured model's languages, once `/v1/models` has answered with them. */
    private languages?: readonly string[];

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
     * Whether the key works, and how much of the plan is left, as an ANSWER rather than as a throw.
     *
     * `plugins/kokoro`'s contract: a throw here is a failed call, and three presses of Test connection
     * would quarantine a plugin the station was still using.
     *
     * The quota is the one number an operator of a hosted engine actually wants from this button,
     * since a key that works and a month that is spent fail the same way on air. It is read from a
     * second route that a restricted key may not be allowed, so failing to read it is said rather
     * than treated as a failed connection: the key that cannot read its own quota can still speak.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        const headers = this.authHeaders();
        if (this.apiKey === undefined) return { ok: false, message: 'No API key set.' };

        let response: Response;
        try {
            response = await host.fetch(`${API_BASE}/v1/voices`, { headers, timeoutMs: PROBE_TIMEOUT_MS });
        } catch (error) {
            return { ok: false, message: `Could not reach ElevenLabs: ${errorText(error)}` };
        }

        if (!response.ok) {
            const failure = await speakFailure(response, { voice: '(listing voices)', model: this.model });
            return { ok: false, message: failure.message };
        }

        const voices = voicesIn(await tryJsonBody<unknown>(response).catch(() => undefined));
        const quota = await readQuota(host, headers);

        return { ok: true, message: `Connected. ${voices.length} voices on this account. ${quota}` };
    }

    /**
     * What the settings form should offer: the account's voices for the voice column and the default,
     * and the models this plugin knows for the model field.
     *
     * The voice list is what makes the table fillable, since nobody knows a 20-character voice id by
     * heart. Every choice is a suggestion over free text: a voice added in ElevenLabs since the last
     * refresh, and a model released since this was written, both stay typeable. Answers the models
     * alone rather than throwing when the account cannot be read, because an operator fixing a bad
     * key needs the form.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        const host = this.host;
        const models = (Object.entries(MODELS) as [string, ModelTraits][]).map(([value, traits]) => ({ value, label: traits.label }));
        if (this.apiKey === undefined) return { model: models };

        let voices: AccountVoice[] = [];
        try {
            const response = await host.fetch(`${API_BASE}/v1/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
            if (response.ok) voices = voicesIn(await tryJsonBody<unknown>(response));
            else await response.body?.cancel().catch(() => {});
        } catch (error) {
            host.logger.debug('elevenlabs could not suggest voices', { error: errorText(error) });
        }

        if (voices.length === 0) return { model: models };

        const options = voices.map(voice => ({
            value: voice.id,
            label: voice.category === undefined ? voice.name : `${voice.name} (${voice.category})`,
        }));
        return { model: models, [`${VOICES_FIELD}.${VOICE_VOICE_COLUMN}`]: options, defaultVoice: options };
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

    /**
     * The cues the configured model has a tag for. None for a model that performs no tags, or one
     * the table does not know: claiming a cue and having it read aloud is the only way to break this.
     */
    async listCues(): Promise<readonly SpeechCue[]> {
        const tags = tagsOf(this.model);
        return tags === undefined ? [] : (Object.keys(tags.cues) as SpeechCue[]);
    }

    /** {@link listCues}' twin: the readings the configured model has a leading tag for. */
    async listDeliveries(): Promise<readonly SpeechDelivery[]> {
        const tags = tagsOf(this.model);
        return tags === undefined ? [] : (Object.keys(tags.deliveries) as SpeechDelivery[]);
    }

    /**
     * How much one request may carry, from the table and never from the network, since this is asked
     * on the render path. Nothing for an unknown model, which takes the host's cautious default.
     */
    async listLimits(): Promise<SpeechLimits> {
        const traits = traitsOf(this.model);
        return traits === undefined ? {} : { maxCharacters: traits.maxCharacters };
    }

    /**
     * The languages the configured model speaks, as `GET /v1/models` lists them.
     *
     * Asked of the service rather than copied, because v4 alone lists more than ninety. Remembered
     * once it has answered, and empty on any failure, which the host reads as "cannot tell" rather
     * than as a model that speaks nothing.
     */
    async listLanguages(): Promise<readonly string[]> {
        if (this.languages !== undefined) return this.languages;

        const host = this.host;
        if (this.apiKey === undefined) return [];

        try {
            const response = await host.fetch(`${API_BASE}/v1/models`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                return [];
            }

            const languages = languagesOf(await tryJsonBody<unknown>(response), this.model);
            if (languages.length > 0) this.languages = languages;
            return languages;
        } catch (error) {
            host.logger.debug('elevenlabs could not list its languages', { error: errorText(error) });
            return [];
        }
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        const host = this.host;
        if (this.apiKey === undefined) throw new PluginError('elevenlabs has no API key configured').withCode('config');

        const text = performed(request.text, request.delivery, tagsOf(this.model)).trim();
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
                // Only to a model documented to take it: the API refuses a language a model does not
                // enforce, and a refused line is a lost break. The others read the language off the text.
                ...(request.language !== undefined && takesLanguageCode(this.model) ? { language_code: primaryOf(request.language) } : {}),
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

/** The ISO 639-1 part of a BCP 47 tag, which is the form `language_code` takes. */
const primaryOf = (language: string): string => language.split('-')[0]!.toLowerCase();

/** The `language_id`s of one model in a `/v1/models` answer. Anything misshapen is none. */
const languagesOf = (body: unknown, model: string): string[] => {
    if (!Array.isArray(body)) return [];

    const entry: unknown = body.find(
        (candidate: unknown) => candidate !== null && typeof candidate === 'object' && (candidate as { model_id?: unknown }).model_id === model,
    );
    const languages: unknown = entry === undefined ? undefined : (entry as { languages?: unknown }).languages;
    if (!Array.isArray(languages)) return [];

    return languages.flatMap((language: unknown) => {
        const id = language !== null && typeof language === 'object' ? (language as { language_id?: unknown }).language_id : undefined;
        return typeof id === 'string' && id.length > 0 ? [id] : [];
    });
};

/** One voice on the account, as `/v1/voices` lists it. */
interface AccountVoice {
    id: string;
    name: string;
    /** `premade`, `cloned`, `generated` or `professional`, where the service says. */
    category?: string;
}

/** The voices in a `/v1/voices` answer. Anything misshapen is no voices rather than a throw. */
const voicesIn = (body: unknown): AccountVoice[] => {
    const listed: unknown = body !== null && typeof body === 'object' ? (body as { voices?: unknown }).voices : undefined;
    if (!Array.isArray(listed)) return [];

    return listed.flatMap((entry: unknown) => {
        if (entry === null || typeof entry !== 'object') return [];
        const { voice_id: id, name, category } = entry as { voice_id?: unknown; name?: unknown; category?: unknown };
        if (typeof id !== 'string' || id.trim().length === 0) return [];

        return [
            {
                id: id.trim(),
                name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : id.trim(),
                ...(typeof category === 'string' && category.length > 0 ? { category } : {}),
            },
        ];
    });
};

/**
 * The quota as a sentence: how much of this period's characters are spent, and when they reset.
 *
 * Never throws, and never fails the test it is part of. See `testConnection`.
 */
async function readQuota(host: PluginHost, headers: Record<string, string>): Promise<string> {
    const unread = 'The character quota could not be read; the key may not have the User permission.';

    try {
        const response = await host.fetch(`${API_BASE}/v1/user/subscription`, { headers, timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return unread;
        }

        const body = await tryJsonBody<{ character_count?: unknown; character_limit?: unknown; next_character_count_reset_unix?: unknown }>(response);
        const used = body?.character_count;
        const limit = body?.character_limit;
        if (typeof used !== 'number' || typeof limit !== 'number') return unread;

        const reset = body?.next_character_count_reset_unix;
        const resets = typeof reset === 'number' && reset > 0 ? `, resetting ${new Date(reset * 1000).toISOString().slice(0, 10)}` : '';
        return `${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} characters used this period${resets}.`;
    } catch {
        return unread;
    }
}

/** What a mapping is, for the console's list. */
const describe = (mapping: VoiceMapping): string => {
    const settings = Object.entries(mapping.settings).map(([key, value]) => `${key.replace('_boost', '')} ${value}`);
    return settings.length === 0 ? `ElevenLabs voice ${mapping.voice}` : `ElevenLabs voice ${mapping.voice}, ${settings.join(', ')}`;
};
