import {
    configBaseUrl,
    configString,
    Plugin,
    PluginError,
    SPEECH_CUES,
    tryJsonBody,
    type ConfigFieldOption,
    type PluginConnectionResult,
    type SpeechCue,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
} from '@deadair/plugin-sdk';
import {
    DEFAULT_FORMAT,
    DEFAULT_UNLOAD_AFTER_IDLE_MINUTES,
    DEFAULT_UNLOAD_AFTER_RENDER,
    DEFAULT_VOICE,
    PROBE_TIMEOUT_MS,
    RESPONSE_FORMATS,
    SPEAK_TIMEOUT_MS,
    chatterboxManifest,
    shippedUnlessMapped,
    type ResponseFormat,
} from './chatterbox.manifest.js';
import { ModelLifecycle, type ModelInfo } from './chatterbox.lifecycle.js';
import { VOICE_ENGINE_COLUMN, VOICES_FIELD, type VoiceMap, type VoiceMapping } from './chatterbox.voices.js';

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
 * ## Synthesis goes through the engine's own `/tts`
 *
 * It went through the OpenAI-compatible `/audio/speech` first, which was the right
 * order — the lifecycle work above is what any integration needs — but that shape
 * is the plainest thing an engine can expose and this one is not a plain engine.
 * `/tts` is where it keeps `exaggeration`, `cfg_weight`, `temperature` and `seed`,
 * which are the controls that most distinguish it and the only route the station
 * has to a delivery rather than a voice.
 *
 * **None of those four is sent, deliberately.** This is the transport standing
 * where they are reachable, not the feature: whether a dial belongs on a voice
 * (a character is consistently intense) or on a REQUEST (one break shouts and the
 * next is hushed) is a decision with a contract change behind it, and moving the
 * endpoint should not smuggle in an answer. Anything added here owes
 * `SpeechVoice.spec` a thought first — it keys the cached voice preview, so a knob
 * that changes the rendering and not the key plays the old voice back.
 *
 * The other half of `/tts` is `voice_mode: 'clone'`, which reads a reference WAV
 * the operator uploaded. Also not taken: it is a second way to name a voice, and
 * it belongs in the mapping table beside the clip rather than in this call.
 */
export class ChatterboxPlugin extends Plugin implements SpeechPluginInstance {
    private baseUrl = '';
    private apiKey?: string;
    private format: ResponseFormat = DEFAULT_FORMAT;
    private defaultVoice = DEFAULT_VOICE;
    private voices: VoiceMap = {};
    private unloadAfterRender = DEFAULT_UNLOAD_AFTER_RENDER;
    private unloadAfterIdleMinutes = DEFAULT_UNLOAD_AFTER_IDLE_MINUTES;
    private lifecycle?: ModelLifecycle;
    // Rearmed after every synthesis ends and cleared the moment the next one starts, so the model is
    // only ever let go once the station has genuinely gone quiet rather than merely between two
    // breaks. `unref()`'d because a station with nothing left to say should not be kept alive by its
    // own housekeeping.
    private idleTimer?: ReturnType<typeof setTimeout>;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        // An empty table means the shipped map, exactly as an absent one does. See the same line in
        // the other speech plugin for why never-opened is not a state the console can keep a station
        // in, and for the row on THIS engine that proved it.
        this.voices = shippedUnlessMapped(config[VOICES_FIELD]);
        this.unloadAfterRender = isOn(config.unloadAfterRender);
        this.unloadAfterIdleMinutes = minutesOrDefault(config.unloadAfterIdleMinutes);
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
            this.clearIdleTimer();
            if (this.unloadAfterRender) await this.lifecycle?.unload();
        });

        this.host.logger.info('chatterbox ready', {
            baseUrl: this.baseUrl,
            format: this.format,
            voices: Object.keys(this.voices).length,
            unloadAfterRender: this.unloadAfterRender,
            unloadAfterIdleMinutes: this.unloadAfterIdleMinutes,
        });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (this.baseUrl.length === 0) return { ok: false, message: 'No server URL set.' };

        const response = await this.host.fetch(`${this.baseUrl}/audio/voices`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
        if (!response.ok) return { ok: false, message: `Server answered HTTP ${response.status}.` };

        const body = await tryJsonBody<{ voices?: unknown[] }>(response);
        const count = Array.isArray(body?.voices) ? body.voices.length : undefined;

        // WHICH model is resident is worth reporting here and nowhere else, and this is the only
        // place it can be: the settings form is drawn from a static manifest, so the field that
        // used to sit where the note now sits could never have shown it. It is also the one
        // question about this engine an operator cannot answer by looking, and a "connected but
        // holding nothing" server is about to make the next break pay for a load.
        const info = await this.lifecycle?.info();
        const voices = count === undefined ? '' : ` ${count} voices available.`;
        return { ok: true, message: `Connected.${voices} ${describeModel(info)}` };
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
     * Which performance cues this server can do, right now.
     *
     * The intersection of the station's four with what the LOADED model names, which is the only
     * honest answer: this engine's tags belong to the model rather than to the build, so the same
     * server answers differently after `/restart_server` swaps one in. A manifest flag would have
     * been wrong on exactly the station that switched models, and wrong in the direction where the
     * engine reads the word "laugh" out loud.
     *
     * The engine's vocabulary is wider than the station's — it also offers a `shush`, which the
     * station does not name because shushing is aimed AT somebody in the room — so this narrows
     * rather than translates. The station's own list grew to meet most of the rest of it: a caller
     * on a phone-in clears their throat, and which speaker may use which is decided host-side. It happens that both spell a cue the
     * same way, which is why {@link speak} passes the text through untouched; a future engine that
     * spells them differently would rewrite them there and change nothing here.
     *
     * Answers empty rather than throwing, for the reason {@link fetchSupportedFormats} does: this is
     * asked on the path that WRITES a break, and a server that cannot be reached should cost the
     * station a plain script rather than the script.
     */
    async listCues(): Promise<readonly SpeechCue[]> {
        if (this.lifecycle === undefined) return [];

        const info = await this.lifecycle.info();
        if (info === undefined || !info.supportsCues) return [];

        const named = new Set(info.availableTags);
        return SPEECH_CUES.filter(cue => named.has(cue));
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
     * And the response formats, which is the newer half and the one that is not a
     * convenience: the manifest's list is what this plugin can handle and the
     * server's is what it will encode, and a choice offered from the first alone
     * is a save that renders every break as a 422. See {@link fetchSupportedFormats}.
     *
     * The two are gathered INDEPENDENTLY. They are different endpoints and a build
     * that serves one and not the other is an ordinary state, so a form losing its
     * voices because the schema was not published — or the reverse — would be this
     * method inventing a failure neither upstream reported.
     *
     * Answers nothing rather than throwing when the server is unreachable: an
     * operator fixing a bad address needs the form.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        if (this.baseUrl.length === 0) return {};

        const suggestions: Record<string, ConfigFieldOption[]> = {};

        const formats = await this.fetchSupportedFormats();
        if (formats.length > 0) suggestions.format = formats;

        let voices: ConfigFieldOption[] = [];
        try {
            voices = await this.fetchEngineVoices();
        } catch (error) {
            this.host.logger.debug('chatterbox could not suggest voices', { error: messageOf(error) });
        }

        if (voices.length > 0) {
            suggestions[`${VOICES_FIELD}.${VOICE_ENGINE_COLUMN}`] = voices;
            suggestions.defaultVoice = voices;
        }

        return suggestions;
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (this.baseUrl.length === 0 || this.lifecycle === undefined) {
            throw new PluginError('chatterbox has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('chatterbox was asked to say nothing').withCode('config');

        // A synthesis starting is proof the quiet spell is over, whether or not the timer had
        // actually fired yet.
        this.clearIdleTimer();

        // Before anything else, because a previous render's unload may have emptied the server and
        // synthesis against an empty one is a 503 rather than a wait. Throws `unavailable`, which is
        // the code that keeps the segment's words on its row for the next pass.
        await this.lifecycle.ensureLoaded();

        const format = isResponseFormat(request.format) ? request.format : this.format;
        const mapping = this.resolveVoice(request.voice);
        const voice = mapping.engine;

        const response = await this.host.fetch(`${serverRootOf(this.baseUrl)}/tts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify({
                text,
                // A predefined clip rather than an upload. `clone` takes a reference WAV the operator
                // has pushed to the server, which is a second way to name a voice and belongs with
                // the mapping table if it is ever wanted, not here.
                voice_mode: 'predefined',
                predefined_voice_id: voice,
                output_format: format,
                // The streaming arm ignores `output_format` and always answers WAV, and this plugin
                // hands the response body back either way, so the audio is already in flight without
                // it. Asking for it would trade the operator's chosen format for nothing.
                stream: false,
                // The operator's own column, under this endpoint's name for it. Measured on the
                // running server: 4.120s at 1.0 against 4.950s at 0.8, which is the same
                // post-synthesis stretch the OpenAI-shaped `speed` performed, with the same smearing.
                // Sent anyway, because `DEFAULT_VOICE_ROWS` no longer ships one and the field's help
                // now says what it costs, so a speed in the table is somebody asking for it.
                ...(mapping.speed === undefined ? {} : { speed_factor: mapping.speed }),
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
        if (this.unloadAfterRender) {
            void this.lifecycle?.unload();
            return;
        }

        this.armIdleTimer();
    }

    /**
     * Starts the countdown to letting the model go, from the moment a synthesis just ended.
     *
     * Skipped when `unloadAfterRender` is on, because {@link releaseModel} has already dropped the
     * model by the time this would run, and when the minutes are `0`, which is the operator's "never".
     * `unref()`'d so this timer alone never keeps the process alive.
     */
    private armIdleTimer(): void {
        this.clearIdleTimer();
        if (this.unloadAfterIdleMinutes === 0) return;

        const timer = setTimeout(() => void this.lifecycle?.unload(), this.unloadAfterIdleMinutes * 60_000);
        timer.unref?.();
        this.idleTimer = timer;
    }

    private clearIdleTimer(): void {
        if (this.idleTimer === undefined) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
    }

    /**
     * The response formats this server will actually encode to.
     *
     * **Read out of the server's own schema, because no endpoint answers the
     * question.** The full surface was checked: `/api/model-info` describes the
     * model, `/api/ui/initial-data` carries `audio_output.format` — which is the
     * server's own DEFAULT for what it writes to disk, not the set a request may
     * ask for — and neither `/v1/audio/voices` nor the model-management routes
     * come near it. The OpenAPI document is the only place the accepted values are
     * written down, and it is the same server writing them.
     *
     * The request schema is reached through the speech path's own `$ref` rather
     * than by its generated name, because the name is the upstream's Python class
     * and a rename there would silently take the narrowing off. It reads the path
     * `speak` actually posts to, which is the point of asking at all: a document
     * that describes one endpoint is no evidence about another, and the two here
     * genuinely differ (`response_format` on the OpenAI arm, `output_format` on
     * this one).
     *
     * Intersected with {@link RESPONSE_FORMATS}, which is the half the server never
     * reports — a format with no MIME cannot be stored, and `configSchema` would
     * refuse it anyway, so offering it would offer a save that fails.
     *
     * Answers empty for anything that goes wrong, including a server built with its
     * schema switched off. The manifest's own list stands in that case, which is
     * why it is kept honest rather than generous.
     */
    private async fetchSupportedFormats(): Promise<ConfigFieldOption[]> {
        const root = serverRootOf(this.baseUrl);
        // Server-root-relative, which is what the document's keys are, and the same literal `speak`
        // builds its URL from.
        const speechPath = '/tts';

        try {
            const response = await this.host.fetch(`${root}/openapi.json`, { headers: this.authHeaders(), timeoutMs: PROBE_TIMEOUT_MS });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                return [];
            }

            const document = await tryJsonBody<OpenApiDocument>(response);
            const reference = document?.paths?.[speechPath]?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
            const schemaName = typeof reference === 'string' ? reference.split('/').pop() : undefined;
            const declared = schemaName === undefined ? undefined : enumOf(document?.components?.schemas?.[schemaName]?.properties?.output_format);
            if (declared === undefined) return [];

            return declared.flatMap((entry: unknown) => (isResponseFormat(entry) ? [{ value: entry, label: entry }] : []));
        } catch (error) {
            this.host.logger.debug('chatterbox could not read the formats its server accepts', { error: messageOf(error) });
            return [];
        }
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

/**
 * As much of an OpenAPI document as this plugin reads, and no more.
 *
 * Every level optional and nothing asserted: a schema document is a third party's
 * output, so the only safe shape for it is one where every step down is allowed to
 * be missing and the answer to a missing step is "no suggestion".
 */
interface OpenApiDocument {
    paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { $ref?: unknown } }> } } }>;
    components?: { schemas?: Record<string, { properties?: Record<string, JsonSchemaProperty | undefined> }> };
}

/** One property of a request schema, as much of it as {@link enumOf} walks. */
interface JsonSchemaProperty {
    enum?: unknown;
    anyOf?: readonly JsonSchemaProperty[];
}

/**
 * A property's allowed values, whether or not it is wrapped in a nullable union.
 *
 * The wrapper is why this is a function rather than a property read. An optional field on this
 * server's native schema is generated as `anyOf: [{enum: [...]}, {type: 'null'}]`, where the OpenAI
 * arm's equivalent is a bare `enum` — so the reader that worked against one answers `undefined`
 * against the other, and the failure is silent in the worst way: the form falls back to the
 * manifest's own list, which is a superset, and the operator saves a format the server refuses.
 *
 * One level of `anyOf` and no deeper, because that is the shape a nullable field generates and
 * chasing an arbitrary schema graph here would be building a validator for one dropdown.
 */
const enumOf = (property: JsonSchemaProperty | undefined): unknown[] | undefined => {
    if (property === undefined) return undefined;
    if (Array.isArray(property.enum)) return property.enum;

    for (const branch of property.anyOf ?? []) {
        if (Array.isArray(branch.enum)) return branch.enum;
    }

    return undefined;
};

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

/**
 * Minutes of idle time before the model is let go, defaulting on anything that is not a sane number.
 *
 * `0` is a real answer ("never") rather than a bad value, so it is the only number let through
 * unchanged below the default; a negative number or anything that does not parse falls back the same
 * way `isOn` falls back on a boolean field, and for the same reason: a row hand-edited in psql should
 * not turn into a station holding a GPU it never lets go.
 *
 * `undefined` and a blank or whitespace-only string are checked before the conversion rather than
 * after, because `Number('')` is `0`: a cleared field would otherwise read as the explicit "never"
 * above rather than as nothing having been set, and the model would stay resident forever.
 */
const minutesOrDefault = (value: unknown): number => {
    if (value === undefined) return DEFAULT_UNLOAD_AFTER_IDLE_MINUTES;
    if (typeof value === 'string' && value.trim().length === 0) return DEFAULT_UNLOAD_AFTER_IDLE_MINUTES;

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_UNLOAD_AFTER_IDLE_MINUTES;
};

/** What a mapping sounds like, for the console's list. The speed is only worth saying when set. */
const describe = (mapping: VoiceMapping): string =>
    mapping.speed === undefined ? `${mapping.engine} on this server` : `${mapping.engine} on this server, at ${mapping.speed}x`;

/** The token the host keys a cached voice preview on. Opaque to it; see `SpeechVoice.spec`. */
const specOf = (mapping: VoiceMapping): string => (mapping.speed === undefined ? mapping.engine : `${mapping.engine}@${mapping.speed}`);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The model half of the connection message.
 *
 * Three outcomes rather than two, because a server that would not answer is not a
 * server holding nothing: telling an operator "no model is loaded" about a readout
 * that never came back is a confident sentence about the one thing they opened this
 * dialog to find out. The class name is preferred over the type because it is the
 * more specific of the two names the server offers, and the device is worth a
 * clause on its own — a model that quietly landed on the CPU is every break late.
 */
const describeModel = (info: ModelInfo | undefined): string => {
    if (info === undefined) return 'It would not say what model it is holding.';
    if (!info.loaded) return 'No model is loaded; the next break will load one.';

    const named = info.className ?? info.type;
    const running = info.device === undefined ? '' : ` on ${info.device}`;
    return named === undefined ? `A model is loaded${running}.` : `Loaded: ${named}${running}.`;
};
