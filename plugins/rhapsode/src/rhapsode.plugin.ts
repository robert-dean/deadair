import {
    configBaseUrl,
    configString,
    errorText,
    Plugin,
    PluginError,
    SPEECH_CUES,
    SPEECH_DELIVERIES,
    type ConfigFieldOption,
    type PluginConnectionResult,
    type PluginLogger,
    type SpeechCue,
    type SpeechDelivery,
    type SpeechHandle,
    type SpeechLimits,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
} from '@deadair/plugin-sdk';
import type { Capabilities, CoreHealth, EngineSpeakRequest } from '@maroonedsoftware/rhapsode-sdk';
import {
    cuesOf,
    deliveriesOf,
    effectiveVariant,
    encodableFormat,
    EngineCapabilities,
    maxCharactersOf,
    speedDialOf,
    speedWithin,
    variantNamesOf,
    type EffectiveVariant,
} from './rhapsode.capabilities.js';
import { fetchEngines, fetchHealth, fetchVoices, type RhapsodeAccess } from './rhapsode.directory.js';
import {
    DEFAULT_ENGINE,
    DEFAULT_FORMAT,
    isResponseFormat,
    MIN_KEEP_ALIVE_SECONDS,
    RESPONSE_FORMATS,
    rhapsodeManifest,
    SPEAK_TIMEOUT_MS,
    type ResponseFormat,
} from './rhapsode.manifest.js';
import { speakFailure } from './rhapsode.errors.js';
import {
    VOICE_ENGINE_COLUMN,
    VOICE_VARIANT_COLUMN,
    VOICE_VOICE_COLUMN,
    VOICES_FIELD,
    voiceMapOf,
    type VoiceMap,
    type VoiceMapping,
} from './rhapsode.voices.js';

export { rhapsodeManifest };

/**
 * Below this, what came back is a JSON error page or an empty reply, not audio.
 *
 * The same floor `plugins/kokoro` carries, and the same 256 bytes rhapsode enforces on its own side
 * — it destroys the connection rather than ending it when a worker produces less. Kept here anyway,
 * because the two are not the same check: a proxy between the station and the server can turn that
 * destroyed connection into a clean short body, and this is the last place before the segment store
 * where "was any of this plausibly audio" can still be asked.
 */
const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/**
 * The engine's body, with a size check on the end of it.
 *
 * The check belongs at the end rather than on the first chunk: a server can dribble a short JSON
 * error out in several pieces, and "was any of this plausibly audio" is only answerable once it
 * stops. Failing in `flush` is what makes the render fail loudly instead of storing a click.
 *
 * A `TransformStream` rather than a wrapper of our own, so cancelling the result still cancels the
 * socket underneath without anything here to forward it.
 */
const withPlausibilityCheck = (asked: string): TransformStream<Uint8Array, Uint8Array> => {
    let delivered = 0;

    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            delivered += chunk.byteLength;
            controller.enqueue(chunk);
        },
        flush() {
            if (delivered >= MIN_PLAUSIBLE_AUDIO_BYTES) return;
            throw new PluginError(`rhapsode returned only ${delivered} bytes for ${asked}, which is not audio`).withCode('upstream');
        },
    });
};

/**
 * Text to speech through a Rhapsode server.
 *
 * ## What is different from the other two
 *
 * One server, several engines, and it will tell you what each of them can do. The station's other
 * speech plugins each address a single process with a single set of weights, and everything about
 * what it can perform — which cues, which deliveries, how much text — is either hard-coded in the
 * plugin or discovered by reading an endpoint that was never meant for a client. rhapsode publishes
 * a capability document per engine, so this plugin's answers to `listCues`, `listDeliveries` and
 * `listLimits` are the server's answers rather than this file's opinion.
 *
 * It also owns residency itself. `plugins/chatterbox` carries a model lifecycle — load, poll, unload
 * after a render, an idle timer — because its server would otherwise hold the card forever. Nothing
 * of that is here: a `keepAliveSeconds` on the request is the whole of this plugin's say in it, and
 * the eviction, the queueing and the reload are the server's to do.
 *
 * ## Why the audio is a stream and not a return value
 *
 * `speak` starts the request and hands back its body, so a long script is bytes in flight rather
 * than a file held whole. The host reads it to the end or cancels it, and either one reaches the
 * socket without this plugin forwarding anything: it is the server's own response body, with a size
 * check bolted on. rhapsode streams by default and answers the duration in a trailer, which nothing
 * here has to read — the station measures the audio it stored.
 */
export class RhapsodePlugin extends Plugin implements SpeechPluginInstance {
    private baseUrl = '';
    private defaultEngine = DEFAULT_ENGINE;
    private defaultVoice?: string;
    private defaultVariant?: string;
    private format: ResponseFormat = DEFAULT_FORMAT;
    private keepAliveSeconds?: number;
    private voices: VoiceMap = {};
    // Absent until there is an address to ask, and rebuilt on every load, so a document read under
    // one server URL is never answered under another.
    private capabilities?: EngineCapabilities;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.baseUrl = configBaseUrl(config.baseUrl);
        this.defaultEngine = configString(config.defaultEngine) ?? DEFAULT_ENGINE;
        // No default of its own, unlike the other two speech plugins: an absent `voice` on the
        // request is a thing this server understands, and it means the engine's own default. Naming
        // one here would be this plugin guessing at a voice id per engine, which is exactly the
        // guess the engines already make correctly.
        this.defaultVoice = configString(config.defaultVoice);
        this.defaultVariant = configString(config.defaultVariant);
        this.format = isResponseFormat(config.format) ? config.format : DEFAULT_FORMAT;
        this.keepAliveSeconds = keepAliveOf(config.keepAliveSeconds);
        // No shipped rows to fall back to, so this reads exactly what is stored. The argument
        // `plugins/kokoro` makes for shipping a table — that an empty map is one voice reading
        // everything — is answered differently here: a shipped row would have to name an engine and
        // a voice id, and this plugin cannot know which engines an operator has installed.
        this.voices = voiceMapOf(config[VOICES_FIELD]);

        const access = this.access();
        this.capabilities = access === undefined ? undefined : new EngineCapabilities(access);

        this.host.logger.info('rhapsode ready', {
            baseUrl: this.baseUrl,
            engine: this.defaultEngine,
            format: this.format,
            voices: Object.keys(this.voices).length,
            ...(this.keepAliveSeconds === undefined ? {} : { keepAliveSeconds: this.keepAliveSeconds }),
        });
    }

    /**
     * Whether the server is there, as an ANSWER rather than as a throw.
     *
     * The catch carries the argument `plugins/kokoro` states in full: `probe` reads `ok`, and a
     * rejection is recorded as a failed call instead — so three presses of Test connection against a
     * server that is not running would quarantine the plugin, the render path would stop considering
     * it for being quarantined, and the station would lose the voice it still had a perfectly good
     * address for.
     *
     * What it reports beyond "connected" is the one thing an operator cannot see from the form: this
     * plugin's default engine is a name typed into a text box, and whether this server has it is the
     * difference between a station that speaks and one that fails every break with `unknown_engine`.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const access = this.access();
        if (access === undefined) return { ok: false, message: 'No server URL set.' };

        let health: CoreHealth | undefined;
        try {
            health = await fetchHealth(access);
        } catch (error) {
            return { ok: false, message: `Could not reach ${this.baseUrl}: ${errorText(error)}` };
        }

        if (health === undefined) return { ok: false, message: `Nothing at ${this.baseUrl} answered as a Rhapsode server.` };

        const engines = Array.isArray(health.engines) ? health.engines : [];
        const named = engines.find(engine => engine.id === this.defaultEngine);
        const resident = health.residency?.resident;

        return {
            ok: true,
            message: [
                `Connected. ${engines.length} ${engines.length === 1 ? 'engine' : 'engines'} installed.`,
                named === undefined
                    ? `This server has no engine called "${this.defaultEngine}".`
                    : `"${this.defaultEngine}" is ${named.process}, model ${named.model}.`,
                ...(typeof resident === 'number' ? [`${resident} of ${health.residency.max} model slots in use.`] : []),
            ].join(' '),
        };
    }

    /**
     * The station's own voice names, as the console lists them.
     *
     * These are the ids the host may pass back, so this reports the MAPPINGS rather than everything
     * the server can say: a voice on an engine the operator never named is not something the station
     * can ask for. The address is the description, because when choosing between two rows that is the
     * part that differs.
     *
     * The `spec` is composed here rather than taken from the server's own opaque one, which is a
     * deliberate trade. Reading the server's would mean listing every engine's voices on a console
     * page load, and on this server listing voices starts the engine's worker process — a page view
     * would cost several of them. What that buys is noticing a voice re-cloned under the SAME id,
     * whose preview would otherwise stay stale until something else about the row changed, and that
     * is worth less than the workers.
     */
    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, mapping]) => {
            const address = this.addressOf(mapping);

            return { id, label: id, description: describeFully(address), spec: specOf(address) };
        });

        // Always offer the fallback, under its own name, so a station with no mappings at all still
        // has something to preview and choose.
        const fallback = this.resolveVoice(undefined);
        return [{ id: '', label: 'Default', description: describeFully(fallback), spec: specOf(fallback) }, ...mapped];
    }

    /**
     * What the settings form should offer, out of what this server actually has.
     *
     * This is what makes the form fillable, and on this server there is more of it to fill than on
     * either of the others: an engine id, a voice id within that engine, and a build of it. None of
     * the three is guessable, and two of them are per-install — the engines are whatever the operator
     * has chosen to install, and the voices include any they have cloned in themselves.
     *
     * Every cell stays free text with these as suggestions rather than becoming a `select`. A voice
     * uploaded a moment ago, or an engine installed while this form was open, is still typeable, and
     * the console draws a cell with choices as an autocomplete for exactly that reason.
     *
     * Answers nothing rather than throwing when the server is unreachable: an operator fixing a bad
     * address needs the form, and the refresh control is right there. It gives up before the fan-out
     * for the same reason — if `/engines` did not answer, there is nothing to ask the rest of.
     */
    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        const access = this.access();
        const capabilities = this.capabilities;
        if (access === undefined || capabilities === undefined) return {};

        const engines = await fetchEngines(access);
        if (engines.length === 0) return {};

        // Every engine at once. Sequentially this is two round trips per engine against a budget for
        // the whole call, and an operator with four engines would watch it time out.
        const held = await Promise.all(
            engines.map(async engine => ({
                engine,
                voices: await fetchVoices(access, engine.id),
                variants: variantNamesOf(await capabilities.of(engine.id)),
            })),
        );

        const engineOptions = engines.map(engine => ({ value: engine.id, label: engine.displayName || engine.id }));
        // Labelled with the engine they belong to, because a voice id is only unique within one and
        // these are one flat list: two engines may both hold a `default`, and they are not the same
        // voice.
        const voiceOptions = held.flatMap(({ engine, voices }) =>
            voices.map(voice => ({ value: voice.id, label: `${voice.label || voice.id} (${engine.id})` })),
        );
        const variantOptions = held.flatMap(({ engine, variants }) =>
            variants.map(variant => ({ value: variant, label: `${variant} (${engine.id})` })),
        );

        return {
            defaultEngine: engineOptions,
            [`${VOICES_FIELD}.${VOICE_ENGINE_COLUMN}`]: engineOptions,
            ...(voiceOptions.length === 0 ? {} : { defaultVoice: voiceOptions, [`${VOICES_FIELD}.${VOICE_VOICE_COLUMN}`]: voiceOptions }),
            ...(variantOptions.length === 0 ? {} : { defaultVariant: variantOptions, [`${VOICES_FIELD}.${VOICE_VARIANT_COLUMN}`]: variantOptions }),
        };
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (this.baseUrl.length === 0) {
            throw new PluginError('rhapsode has no server URL configured').withCode('config');
        }

        const text = request.text.trim();
        if (text.length === 0) throw new PluginError('rhapsode was asked to say nothing').withCode('config');

        // Held before the first await: a config save mid-synthesis reinitialises this instance, and
        // `this.host` read after that throws rather than logging. See the SDK's CLAUDE.md.
        const host = this.host;
        const capabilities = this.capabilities;

        const asked = this.resolveVoice(request.voice);

        // Read once, for both of the things it decides. Cached per engine for minutes, so an
        // ordinary break pays for this on the first line after a restart and never again — and what
        // it buys is the two failures a station cannot diagnose from the outside: a format this
        // server was built without an encoder for, and a dial this build does not have.
        const document = capabilities === undefined ? undefined : await capabilities.of(asked.engine);
        const format = encodableFormat(document, isResponseFormat(request.format) ? request.format : this.format, host.logger);
        const params = speedParams(effectiveVariant(document, asked.variant), host.logger, asked);

        // Typed as the server's own request shape, so a field this plugin spells wrong is a build
        // failure here rather than a 400 on air. The text goes through untouched: a cue rides inside
        // it as `[laugh]`, which is the notation rhapsode reads and the same eight words the SDK
        // defines, and the server strips the ones the chosen build does not claim. A delivery it
        // does not claim is dropped there too, so both are safe to send without asking first.
        const body: EngineSpeakRequest = {
            engine: asked.engine,
            text,
            format,
            stream: true,
            ...(asked.voice === undefined ? {} : { voice: asked.voice }),
            ...(asked.variant === undefined ? {} : { variant: asked.variant }),
            ...(request.delivery === undefined ? {} : { delivery: request.delivery }),
            ...(params === undefined ? {} : { params }),
            ...(this.keepAliveSeconds === undefined ? {} : { keepAliveSeconds: this.keepAliveSeconds }),
        };

        const response = await host.fetch(`${this.baseUrl}/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });

        if (!response.ok || response.body === null) {
            throw await speakFailure(response, asked);
        }

        host.logger.debug('rhapsode speaking', {
            // The address without the row's speed on it: what was actually SENT is in `params`, and
            // a line reading `speed: 1.1` beside a request that withheld it is a log that lies.
            engine: asked.engine,
            ...(asked.voice === undefined ? {} : { voice: asked.voice }),
            ...(asked.variant === undefined ? {} : { variant: asked.variant }),
            format,
            chars: text.length,
            ...(request.delivery === undefined ? {} : { delivery: request.delivery }),
            ...(params === undefined ? {} : params),
        });

        return {
            mime: mimeOf(response.headers.get('content-type'), format),
            audio: response.body.pipeThrough(withPlausibilityCheck(describe(asked))),
        };
    }

    /**
     * A station voice name, as an address on this server.
     *
     * An unmapped name falls back rather than failing, and says so once: a station that says the
     * wrong thing in the wrong voice is recoverable, and one that goes silent because a persona was
     * renamed is not.
     *
     * Each half falls back on its own. A row that names a voice and no engine is spoken by the
     * default engine, which is what an operator running one engine means by leaving the column
     * empty, and a row that names no variant takes whatever is loaded, which is the cheap answer.
     */
    private resolveVoice(requested: string | undefined): SpeakAddress {
        const mapped = requested === undefined || requested.length === 0 ? undefined : this.voices[requested];

        if (mapped === undefined && requested !== undefined && requested.length > 0) {
            this.host.logger.warn('no mapping for this voice; using the defaults', { voice: requested, engine: this.defaultEngine });
        }

        const voice = mapped?.voice ?? this.defaultVoice;
        const variant = mapped?.variant ?? this.defaultVariant;

        return {
            engine: mapped?.engine ?? this.defaultEngine,
            ...(voice === undefined ? {} : { voice }),
            ...(variant === undefined ? {} : { variant }),
            // Not inherited from the defaults, because there is no default speed to inherit: a speed
            // belongs to the character whose row carries it.
            ...(mapped?.speed === undefined ? {} : { speed: mapped.speed }),
        };
    }

    /**
     * Which cues a writer may put in a script for this station.
     *
     * The UNION over every build the voices table can reach, rather than the intersection, and this
     * is only safe because of where the stripping happens. The host strips a cue this plugin does not
     * claim; the SERVER strips a cue the build it is about to use does not claim, per request. So a
     * cue claimed here and not performed by the engine that ends up reading a given line is removed
     * on the way past rather than read out as the word "laugh" — which is the failure the SDK warns
     * about, and the only one that would argue for the intersection.
     *
     * The intersection would cost real latitude for nothing: one row pointing at a build with a
     * short list would take cues away from every other voice on the station.
     */
    async listCues(): Promise<readonly SpeechCue[]> {
        const claimed = new Set((await this.buildsInUse()).flatMap(cuesOf));

        // In the vocabulary's own order rather than discovery order, so the answer does not change
        // shape because an operator reordered the voices table.
        return SPEECH_CUES.filter(cue => claimed.has(cue));
    }

    /** {@link listCues}' twin, on the same argument: the server drops a delivery the build cannot do. */
    async listDeliveries(): Promise<readonly SpeechDelivery[]> {
        const claimed = new Set((await this.buildsInUse()).flatMap(deliveriesOf));

        return SPEECH_DELIVERIES.filter(delivery => claimed.has(delivery));
    }

    /**
     * How much text one call takes, as the SMALLEST any build in use will accept.
     *
     * The opposite of {@link listCues}' union, because this is the opposite kind of answer. The host
     * asks once, for the plugin rather than for a voice, and chunks everything it has to say against
     * what it is told — so a ceiling that is too high for one of these builds is a request that build
     * refuses, and the SDK's own note says three of those in a row quarantine the plugin. The
     * smallest is the only number that is true of all of them.
     *
     * Nothing at all when no build declares one, which leaves the host's conservative default
     * standing rather than replacing it with a guess of this plugin's.
     */
    async listLimits(): Promise<SpeechLimits> {
        const declared = (await this.buildsInUse()).map(maxCharactersOf).filter((max): max is number => max !== undefined);

        return declared.length === 0 ? {} : { maxCharacters: Math.min(...declared) };
    }

    /**
     * Every build this station could end up speaking through.
     *
     * The default address plus one per mapped voice, deduplicated: what a build can do depends on
     * the engine and the variant and nothing else, so twelve rows on one engine are one question.
     *
     * The documents are fetched once per ENGINE and in parallel. Sequentially, three engines on a
     * cold cache would be three probes end to end against an eight-second budget for the whole call,
     * which is how a question about cues turns into a break with none.
     */
    private async buildsInUse(): Promise<(EffectiveVariant | undefined)[]> {
        const capabilities = this.capabilities;
        if (capabilities === undefined) return [];

        const addresses = [this.resolveVoice(undefined), ...Object.values(this.voices).map(mapping => this.addressOf(mapping))];
        const builds = new Map(addresses.map(address => [`${address.engine} ${address.variant ?? ''}`, address]));

        const engines = [...new Set([...builds.values()].map(address => address.engine))];
        const documents = new Map<string, Capabilities | undefined>(
            await Promise.all(engines.map(async engine => [engine, await capabilities.of(engine)] as const)),
        );

        return [...builds.values()].map(address => effectiveVariant(documents.get(address.engine), address.variant));
    }

    /**
     * What this plugin needs to ask the server anything, or nothing when it has no address.
     *
     * `host` is read once here rather than inside the closure, so a call that outlives a config save
     * fails on a dead socket rather than on a `this.host` that now throws.
     */
    private access(): RhapsodeAccess | undefined {
        if (this.baseUrl.length === 0) return undefined;

        const host = this.host;
        return { baseUrl: this.baseUrl, fetch: (url, init) => host.fetch(url, init), logger: host.logger };
    }

    /** One stored row as the address it names, with the defaults filling whatever it left blank. */
    private addressOf(mapping: VoiceMapping): SpeakAddress {
        const variant = mapping.variant ?? this.defaultVariant;

        return {
            engine: mapping.engine ?? this.defaultEngine,
            voice: mapping.voice,
            ...(variant === undefined ? {} : { variant }),
            ...(mapping.speed === undefined ? {} : { speed: mapping.speed }),
        };
    }
}

/** Where one line is going: an engine, and as much of a voice and a build as anybody named. */
interface SpeakAddress {
    engine: string;
    voice?: string;
    variant?: string;
    speed?: number;
}

/**
 * The dials to send with this line, which is at most a speed and usually nothing.
 *
 * Gated on the build's own declaration rather than sent hopefully, because on this server an unknown
 * dial key is a 400 naming it: a speed typed against an engine that has no speed dial would cost the
 * break rather than being ignored. That gate is also why this asks nothing of the server for the
 * ordinary line — a row with no speed in it never reaches the capability document at all, so the
 * common case is still one request.
 *
 * A document that could not be read means no speed, for the same reason. An unconfirmed dial and an
 * absent one are the same risk.
 */
function speedParams(build: EffectiveVariant | undefined, logger: PluginLogger, asked: SpeakAddress): Record<string, number> | undefined {
    if (asked.speed === undefined) return undefined;

    const dial = speedDialOf(build);
    if (dial === undefined) {
        logger.debug('rhapsode withheld the speed, because this build declares no speed dial', {
            engine: asked.engine,
            ...(asked.variant === undefined ? {} : { variant: asked.variant }),
            speed: asked.speed,
        });
        return undefined;
    }

    // Clamped rather than refused: the nearest thing the engine can do is a better answer than
    // ignoring an operator who asked for something outside its range.
    return { speed: speedWithin(dial, asked.speed) };
}

/** The address as one phrase, for a log line and for the message on a body that was not audio. */
const describe = (asked: SpeakAddress): string =>
    asked.voice === undefined ? `engine "${asked.engine}"` : `voice "${asked.voice}" on engine "${asked.engine}"`;

/** The same address for the console's list, where the build and the pace are worth saying too. */
const describeFully = (asked: SpeakAddress): string =>
    [
        asked.voice === undefined ? `${asked.engine}'s own default voice` : `${asked.voice} on ${asked.engine}`,
        ...(asked.variant === undefined ? [] : [`(${asked.variant})`]),
        ...(asked.speed === undefined ? [] : [`at ${asked.speed}x`]),
    ].join(' ');

/**
 * The token the host keys a cached voice preview on. See `SpeechVoice.spec`.
 *
 * Opaque to the host, so the only rule is that it change whenever the rendering would. Every part of
 * the address is in it, and a voice with no speed reads as a different token from the same voice at
 * 1x deliberately, because those are two different requests.
 */
const specOf = (asked: SpeakAddress): string =>
    [asked.engine, asked.voice ?? ''].join('/') +
    (asked.variant === undefined ? '' : `@${asked.variant}`) +
    (asked.speed === undefined ? '' : `@${asked.speed}`);

/**
 * What the bytes ARE, going by what the server said they are.
 *
 * Read off the response rather than assumed from the request, because rhapsode copies its worker's
 * `Content-Type` through verbatim and the worker is the only thing that knows what it actually
 * encoded. Announcing a wav as `audio/mpeg` is the failure this avoids, and it is a bad one: it airs
 * as silence rather than as an error anybody sees.
 *
 * Two adjustments and no more. Parameters are cut, because `audio/L16; rate=24000` is a media type
 * with a rate on it and the station files audio by type alone. `audio/opus` becomes `audio/ogg`,
 * because what rhapsode sends under that name is Ogg-encapsulated Opus and `ogg` is what the segment
 * store calls it. Anything else the server says is passed on as it stands, including a type the
 * station cannot hold: the host refuses that by name, which is a better failure than a plausible
 * guess from this end.
 *
 * A reply with no content-type at all falls back to what was ASKED for, which is the only guess
 * available and a fair one — a server that forgot the header is not a reason to drop the audio.
 */
export const mimeOf = (header: string | null, format: ResponseFormat): string => {
    const declared = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (declared.length === 0 || !declared.startsWith('audio/')) return RESPONSE_FORMATS[format];

    return declared === 'audio/opus' ? 'audio/ogg' : declared;
};

/**
 * The keep-alive as the server's own vocabulary, or nothing at all.
 *
 * Blank is not zero and this is where that is decided: an empty box means send no `keepAliveSeconds`
 * and let the server's own configuration answer, while a typed 0 means free the model the moment
 * this request lets go of it. A number field arrives as a number from the console and as whatever a
 * hand-edited row holds otherwise, so both are read here.
 */
const keepAliveOf = (value: unknown): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim().length === 0) return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;

    // Rounded rather than refused, and floored at the server's own -1: a fractional second is not
    // something its residency manager has a use for, and anything below -1 is a typo for "never".
    return Math.max(MIN_KEEP_ALIVE_SECONDS, Math.round(parsed));
};
