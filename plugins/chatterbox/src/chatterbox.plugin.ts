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
    DEFAULT_UNLOAD_AFTER_RENDER,
    DEFAULT_VOICE,
    PROBE_TIMEOUT_MS,
    RESPONSE_FORMATS,
    SPEAK_TIMEOUT_MS,
    chatterboxManifest,
    type ResponseFormat,
} from './chatterbox.manifest.js';
import { ModelLifecycle } from './chatterbox.lifecycle.js';
import { VOICE_ENGINE_COLUMN, VOICES_FIELD, voiceMapOf, type VoiceMap, type VoiceMapping } from './chatterbox.voices.js';

export { chatterboxManifest };

/**
 * Below this, what came back is a JSON error page or an empty reply, not audio.
 *
 * The same floor the other speech plugin keeps, and for the same reason: a
 * server that answers 200 with a complaint produces a segment that airs as a
 * click, and the only place to notice is here.
 */
const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/**
 * The engine's body, with a size check on the end of it.
 *
 * The check belongs at the end rather than on the first chunk: a server can
 * dribble a short JSON error out in several pieces, and "was any of this
 * plausibly audio" is only answerable once it stops.
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
                `chatterbox returned only ${delivered} bytes for voice "${voice}", which is not audio: check the model and voice`,
            ).withCode('upstream');
        },
    });
};

/**
 * The same bytes, with something to run once the host has finished with them.
 *
 * This is where the unload rides, and it has to be here rather than at the end
 * of `speak`: that method returns a stream and comes back long before the audio
 * does, so unloading there would pull the model out from under the synthesis it
 * just started. Only the stream knows when the reading stopped.
 *
 * All three endings count — the body ran out, the host cancelled it, the
 * plausibility check threw — because a card held after an abandoned render is
 * held for exactly as long as one held after a successful one. Guarded so it
 * fires once, since a cancel following an error would otherwise unload twice and
 * the second one races the next break's load.
 *
 * A wrapper rather than a `cancel` on the transformer above, because that hook
 * is not in the stream types this builds against and a cast to reach it would be
 * a runtime assumption in exchange for a few lines.
 *
 * Safe against a second synthesis arriving mid-unload because the HOST
 * serializes: `SpeechGate` holds one slot for the whole call including the
 * drain, so nothing is ever waiting behind this. That is what the previous
 * station's per-server in-flight counter was for, and why this needs none.
 */
const whenFinished = (source: ReadableStream<Uint8Array>, onDone: () => void): ReadableStream<Uint8Array> => {
    const reader = source.getReader();
    let fired = false;

    const done = (): void => {
        if (fired) return;
        fired = true;
        onDone();
    };

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await reader.read();
                if (next.done) {
                    controller.close();
                    done();
                    return;
                }
                controller.enqueue(next.value);
            } catch (error) {
                done();
                controller.error(error);
            }
        },
        async cancel(reason) {
            done();
            await reader.cancel(reason);
        },
    });
};

/**
 * Text to speech through a Chatterbox server.
 *
 * Shaped on the station's other speech plugin throughout, because most of what a
 * speech plugin does is the same on any engine. Two things are not:
 *
 * **A voice is a reference clip, not a preset.** The engine reads from WAVs in a
 * directory, so its voice names are filenames and an operator can add one by
 * copying a file. That is why the engine column is free text with suggestions
 * rather than a closed list.
 *
 * **The model has to be put on the GPU and can be taken off it.** See
 * `ModelLifecycle`. Every synthesis makes sure there is a model first, because
 * this engine does not reload itself after an unload and the previous render may
 * have been the thing that unloaded it.
 *
 * This is the OpenAI-compatible path only. The engine's own `/tts` adds voice
 * cloning and expressiveness dials, which are the capabilities that most
 * distinguish it, and they are deliberately left for later: the lifecycle work
 * above is what any integration needs and is worth having on its own.
 */
export class ChatterboxPlugin extends Plugin implements SpeechPluginInstance {
    private baseUrl = '';
    private apiKey?: string;
    private model = DEFAULT_MODEL;
    private format: ResponseFormat = DEFAULT_FORMAT;
    private defaultVoice = DEFAULT_VOICE;
    private voices: VoiceMap = {};
    private unloadAfterRender = DEFAULT_UNLOAD_AFTER_RENDER;
    private lifecycle?: ModelLifecycle;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        this.voices = voiceMapOf(config[VOICES_FIELD]);
        this.unloadAfterRender = isOn(config.unloadAfterRender);
        this.apiKey = await this.host.secrets.get('apiKey');

        this.lifecycle =
            this.baseUrl.length === 0
                ? undefined
                : new ModelLifecycle({
                      baseUrl: this.baseUrl,
                      fetch: (url, init) => this.host.fetch(url, init),
                      headers: () => this.authHeaders(),
                      logger: this.host.logger,
                  });

        // A model this plugin asked for is a model this plugin should put back. Registered rather
        // than left to the render path, because an operator reloading the plugin, or the API
        // shutting down mid-hour, is exactly when a held card is least excusable — and it is a
        // no-op on a station that never turned the setting on.
        this.register(async () => {
            if (this.unloadAfterRender) await this.lifecycle?.unload();
        });

        this.host.logger.info('chatterbox ready', {
            baseUrl: this.baseUrl,
            model: this.model,
            format: this.format,
            voices: Object.keys(this.voices).length,
            unloadAfterRender: this.unloadAfterRender,
        });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };

        const response = await this.host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) return { ok: false, message: `Server answered HTTP ${response.status}.` };

        const body = await tryJsonBody<{ voices?: unknown[] }>(response);
        const count = Array.isArray(body?.voices) ? body.voices.length : undefined;

        // Whether a model is RESIDENT is worth reporting here and nowhere else: it is the one
        // question about this engine an operator cannot answer by looking, and a "connected but
        // holding nothing" server is about to make the next break pay for a load.
        const loaded = (await this.lifecycle?.loaded()) ?? false;
        const voices = count === undefined ? '' : ` ${count} voices available.`;
        return { ok: true, message: `Connected.${voices} ${loaded ? 'A model is loaded.' : 'No model is loaded; the next break will load one.'}` };
    }

    /**
     * The station's own voice names, as the console lists them.
     *
     * These are the ids the host may pass back, so this reports the operator's
     * MAPPINGS rather than every clip the server holds: a voice the station has
     * never named is not something it can ask for.
     */
    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, mapping]) => ({
            id,
            label: id,
            description: describe(mapping),
            spec: specOf(mapping),
        }));

        const fallback: VoiceMapping = { engine: this.defaultVoice };
        return [{ id: '', label: 'Default', description: describe(fallback), spec: specOf(fallback) }, ...mapped];
    }

    /**
     * What the settings form should offer, out of what the server actually has.
     *
     * The engine's predefined clips, for the voice table's engine cell and for
     * the default voice. `/get_predefined_voices` is preferred over the
     * OpenAI-shaped list because it carries a display name beside the filename,
     * and the filename is what the request needs while the name is what a person
     * is choosing between — so the option's VALUE is the file and its LABEL is
     * the name.
     *
     * Answers nothing rather than throwing when the server is unreachable: an
     * operator fixing a bad address needs the form.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        if (this.baseUrl.length === 0) return {};

        let voices: ConfigFieldOption[];
        try {
            voices = await this.fetchEngineVoices();
        } catch (error) {
            this.host.logger.debug('chatterbox could not suggest voices', { error: messageOf(error) });
            return {};
        }

        if (voices.length === 0) return {};

        return { [`${VOICES_FIELD}.${VOICE_ENGINE_COLUMN}`]: voices, defaultVoice: voices };
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (this.baseUrl.length === 0 || this.lifecycle === undefined) {
            throw new PluginError('chatterbox has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('chatterbox was asked to say nothing').withCode('config');

        // Before anything else, because a previous render's unload may have emptied the server and
        // synthesis against an empty one is a 503 rather than a wait. Throws `unavailable`, which is
        // the code that keeps the segment's words on its row for the next pass.
        await this.lifecycle.ensureLoaded();

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
                ...(mapping.speed === undefined ? {} : { speed: mapping.speed }),
            }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        if (!response.ok || response.body === null) {
            await response.body?.cancel().catch(() => {});
            // The card is held by a synthesis that never happened, so let it go here too.
            this.releaseModel();
            throw new PluginError(`chatterbox answered HTTP ${response.status} for voice "${voice}"`)
                .withCode(response.status === 401 || response.status === 403 ? 'auth' : 'upstream')
                .withUpstreamStatus(response.status);
        }

        this.host.logger.debug('chatterbox speaking', {
            voice,
            format,
            chars: text.length,
            ...(mapping.speed === undefined ? {} : { speed: mapping.speed }),
        });

        return {
            mime: RESPONSE_FORMATS[format],
            audio: whenFinished(response.body.pipeThrough(withPlausibilityCheck(voice)), () => this.releaseModel()),
        };
    }

    /** Drop the model if the operator asked for that, and never let it cost the audio. */
    private releaseModel(): void {
        if (!this.unloadAfterRender) return;
        void this.lifecycle?.unload();
    }

    /** Every predefined clip this server holds, as a value and a name to show for it. */
    private async fetchEngineVoices(): Promise<ConfigFieldOption[]> {
        const named = await this.host.fetch(`${serverRootOf(this.baseUrl)}/get_predefined_voices`, {
            headers: this.authHeaders(),
            timeoutMs: PROBE_TIMEOUT_MS,
        });

        if (named.ok) {
            const body = await tryJsonBody<unknown>(named);
            const options = Array.isArray(body)
                ? body.flatMap(entry => {
                      if (typeof entry !== 'object' || entry === null) return [];
                      const { filename, display_name: display } = entry as { filename?: unknown; display_name?: unknown };
                      if (typeof filename !== 'string' || filename.trim().length === 0) return [];
                      return [{ value: filename.trim(), label: typeof display === 'string' && display.length > 0 ? display : filename.trim() }];
                  })
                : [];
            if (options.length > 0) return options;
        } else {
            await named.body?.cancel().catch(() => {});
        }

        // The OpenAI-shaped list, for a build that does not serve the named one. Bare filenames, so
        // the label is the value.
        const response = await this.host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return [];
        }

        const body = await tryJsonBody<{ voices?: unknown }>(response);
        const listed = Array.isArray(body?.voices) ? body.voices : [];

        return listed.flatMap(entry => {
            if (typeof entry === 'string' && entry.trim().length > 0) return [{ value: entry.trim(), label: entry.trim() }];
            if (typeof entry !== 'object' || entry === null) return [];

            const id = (entry as { id?: unknown }).id;
            return typeof id === 'string' && id.trim().length > 0 ? [{ value: id.trim(), label: id.trim() }] : [];
        });
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

/** The lifecycle module owns this rule; repeated here for the one call that is not its own. */
const serverRootOf = (baseUrl: string): string => baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');

const isResponseFormat = (value: unknown): value is ResponseFormat => typeof value === 'string' && Object.hasOwn(RESPONSE_FORMATS, value);

/**
 * A boolean config value, defaulting OFF.
 *
 * Plugin config is jsonb, so a checkbox arrives as a real boolean and this is
 * mostly a narrowing. The string arm covers a row hand-edited in psql, where
 * `"false"` would otherwise be truthy — which is the same trap `settingIsOn`
 * exists for on the station's own settings, and it cost six switches there.
 */
const isOn = (value: unknown): boolean => value === true || value === 'true';

/** What a mapping sounds like, for the console's list. The speed is only worth saying when set. */
const describe = (mapping: VoiceMapping): string =>
    mapping.speed === undefined ? `${mapping.engine} on this server` : `${mapping.engine} on this server, at ${mapping.speed}x`;

/** The token the host keys a cached voice preview on. Opaque to it; see `SpeechVoice.spec`. */
const specOf = (mapping: VoiceMapping): string => (mapping.speed === undefined ? mapping.engine : `${mapping.engine}@${mapping.speed}`);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
