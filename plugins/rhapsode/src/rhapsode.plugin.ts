import {
    configBaseUrl,
    configString,
    Plugin,
    PluginError,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
} from '@deadair/plugin-sdk';
import type { EngineSpeakRequest } from '@maroonedsoftware/rhapsode-sdk';
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
import { VOICES_FIELD, voiceMapOf, type VoiceMap } from './rhapsode.voices.js';

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

        this.host.logger.info('rhapsode ready', {
            baseUrl: this.baseUrl,
            engine: this.defaultEngine,
            format: this.format,
            voices: Object.keys(this.voices).length,
            ...(this.keepAliveSeconds === undefined ? {} : { keepAliveSeconds: this.keepAliveSeconds }),
        });
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

        const asked = this.resolveVoice(request.voice);
        const format = isResponseFormat(request.format) ? request.format : this.format;

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
            ...asked,
            format,
            chars: text.length,
            ...(request.delivery === undefined ? {} : { delivery: request.delivery }),
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
        };
    }
}

/** Where one line is going: an engine, and as much of a voice and a build as anybody named. */
interface SpeakAddress {
    engine: string;
    voice?: string;
    variant?: string;
}

/** The address as one phrase, for a log line and for the message on a body that was not audio. */
const describe = (asked: SpeakAddress): string =>
    asked.voice === undefined ? `engine "${asked.engine}"` : `voice "${asked.voice}" on engine "${asked.engine}"`;

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
