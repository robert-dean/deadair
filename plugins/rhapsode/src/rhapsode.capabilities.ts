/**
 * What each engine on this server can actually do, asked rather than assumed.
 *
 * ## Why this file exists at all
 *
 * The station has always had to guess at this. `plugins/kokoro` claims no cues and no deliveries
 * because there is nowhere to ask; `plugins/chatterbox` reads an OpenAPI document the server
 * publishes for its own UI and walks `$ref`s through it to find out which audio formats it will
 * take, and keeps an allowlist of model names in the plugin because nothing on the wire says which
 * builds honour the expressiveness dials. Both of them leave `listLimits` unimplemented, and the
 * host's comment on that says what it costs: an unknown ceiling that turns out to be real is a
 * request the engine refuses, and three in a row quarantine the plugin.
 *
 * rhapsode answers the question directly. `GET /engines/{engine}/capabilities` is a document per
 * engine describing every build it can load: which cues it performs, which deliveries, which
 * engine-specific dials with their ranges, how much text one call takes. This file is the whole of
 * reading it, and the plugin's `listCues`, `listDeliveries` and `listLimits` are that document's
 * answers rather than this plugin's opinion.
 *
 * ## The effective variant, and why `current` is not it
 *
 * An engine here is several builds — Chatterbox ships `turbo`, `original` and `multilingual` — and
 * they do not all perform the same cues or take the same dials. The document reports `variants` for
 * everything the worker could load and `current` for what is loaded right now, and `current` is
 * ABSENT entirely while nothing is, which the server is explicit about: a worker with no model has
 * nothing to describe and an invented answer would be worse than no answer.
 *
 * So nothing here may depend on `current` for shape. The variant that answers a question is the one
 * the request will name, then whatever is loaded, then the first the engine lists — the same order
 * the server resolves, so what this plugin reports and what it will get are the same build.
 *
 * ## What a failure means
 *
 * Nothing, deliberately. Every answer derived here is a flourish or a ceiling, and the host's own
 * rule for both is that an engine which could not be asked must cost the station a plainer break
 * rather than the break. So a document that will not fetch leaves the last one standing, and no
 * document at all is silence rather than a throw.
 */

import { isSpeechDelivery, SPEECH_CUES, tryJsonBody, type PluginLogger, type SpeechCue, type SpeechDelivery } from '@deadair/plugin-sdk';
import type { Capabilities, CurrentVariant, Dial, Variant } from '@maroonedsoftware/rhapsode-sdk';
import type { RhapsodeAccess } from './rhapsode.directory.js';
import { PROBE_TIMEOUT_MS, type ResponseFormat } from './rhapsode.manifest.js';

/**
 * How long a document is believed.
 *
 * Long enough that a render never pays for one — the answers are asked for per break — and short
 * enough that an operator who has just installed an engine or loaded a different build sees it
 * without restarting the station. What it describes changes when somebody changes the server, which
 * is minutes-scale, not seconds.
 */
const CACHE_TTL_MS = 5 * 60_000;

/** The dial every engine spells the same way, and the only one this plugin knows the meaning of. */
export const SPEED_DIAL = 'speed';

interface Cached {
    at: number;
    document: Capabilities;
}

/** What a build says about itself, whether it is the loaded one or merely one that could be. */
export type EffectiveVariant = Variant | CurrentVariant;

export interface EngineCapabilitiesOptions extends RhapsodeAccess {
    /** For tests, which would otherwise have to wait five minutes to watch a document go stale. */
    ttlMs?: number;
}

/** The capability documents this server has been asked for, and when. */
export class EngineCapabilities {
    private readonly cache = new Map<string, Cached>();
    private readonly ttlMs: number;

    constructor(private readonly options: EngineCapabilitiesOptions) {
        this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    }

    /**
     * One engine's document, from the cache or from the server.
     *
     * A failed fetch answers the last document this engine gave rather than nothing, because a
     * server that has gone briefly unreachable has not changed what its engines can do, and the
     * alternative is a break written with no cues in it for the sake of one timed-out call. Stale
     * for as long as the process lives, which is the honest bound: nothing here is stored, so a
     * restart asks again anyway.
     */
    async of(engine: string): Promise<Capabilities | undefined> {
        const cached = this.cache.get(engine);
        if (cached !== undefined && Date.now() - cached.at < this.ttlMs) return cached.document;

        let document: Capabilities | undefined;
        try {
            document = await this.fetchDocument(engine);
        } catch (error) {
            this.options.logger.debug('rhapsode could not read what this engine can do', {
                engine,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (document === undefined) return cached?.document;

        this.cache.set(engine, { at: Date.now(), document });
        return document;
    }

    /**
     * The document, or `undefined` for a server that answered something else.
     *
     * A 404 here is an engine the operator has named and this server does not have, which is worth
     * no more than a debug line: the same mistake produces a refusal with a sentence in it the next
     * time anybody tries to speak with it, and that is where an operator will see it.
     */
    private async fetchDocument(engine: string): Promise<Capabilities | undefined> {
        const response = await this.options.fetch(`${this.options.baseUrl}/engines/${encodeURIComponent(engine)}/capabilities`, {
            timeoutMs: PROBE_TIMEOUT_MS,
        });

        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            this.options.logger.debug('rhapsode would not say what this engine can do', { engine, status: response.status });
            return undefined;
        }

        // A document that will not parse is one this server did not send: the address is right and
        // something else is answering on it. Read as nothing, which leaves the last real one
        // standing and keeps the failure to a debug line, exactly as an unreachable server does.
        const document = await tryJsonBody<Capabilities>(response);
        return document?.variants !== undefined && document.variants !== null ? document : undefined;
    }
}

/**
 * The build that will answer a request naming this variant, or none.
 *
 * The server's own resolution order, so that what this plugin reads and what it will get are the
 * same build: the one asked for, then the one loaded, then the first the engine lists. The last step
 * is what makes a cold server answerable at all — nothing is resident, so `current` is absent, and an
 * engine's first variant is the one it will load when asked to speak.
 *
 * A variant named but not offered answers nothing rather than falling through to another build. The
 * request will be refused for the same reason, and reporting some other build's cues would be this
 * plugin promising a reading it is not going to get.
 */
export function effectiveVariant(document: Capabilities | undefined, variant: string | undefined): EffectiveVariant | undefined {
    if (document === undefined) return undefined;

    if (variant !== undefined) return document.variants[variant];
    if (document.current !== undefined) return document.current;

    return Object.values(document.variants)[0];
}

/**
 * What to ask for when the format the operator chose is one this server cannot make.
 *
 * `wav` first, and it is not an arbitrary order: every rhapsode encodes `pcm` and `wav` with no
 * help, while `mp3`, `opus` and `flac` each need an ffmpeg with the matching encoder built in. A
 * server without one refuses the request naming the format, which is a break lost over a
 * preference — and a wav the station can store is worth more than the bytes it saves.
 *
 * `pcm` is not on the list at any position: it answers `audio/L16` with the rate in the content-type
 * parameters, and the segment store has nowhere to put it.
 */
const FALLBACK_FORMATS: readonly ResponseFormat[] = ['wav', 'flac', 'opus', 'mp3'];

/**
 * The format to actually ask for, given what this server says it can encode.
 *
 * Silent when the answer is the one that was wanted, which is every ordinary station. When it is
 * not, the substitution is logged rather than hidden, because an operator who chose mp3 and is
 * getting wav should be able to find out why without reading this file.
 *
 * A server that would not describe itself gets the request as asked. Guessing from no evidence would
 * trade a refusal that names the problem — this is where the "ffmpeg is not on PATH" sentence comes
 * from — for a format nobody chose.
 */
export function encodableFormat(document: Capabilities | undefined, wanted: ResponseFormat, logger: PluginLogger): ResponseFormat {
    const encodable = document?.formats;
    if (!Array.isArray(encodable) || encodable.length === 0 || encodable.includes(wanted)) return wanted;

    const instead = FALLBACK_FORMATS.find(format => encodable.includes(format));
    if (instead === undefined) return wanted;

    logger.debug('rhapsode asked for a different format, because this server cannot encode the one configured', {
        wanted,
        instead,
        encodes: encodable,
    });

    return instead;
}

/**
 * Every build this engine could load, by name.
 *
 * For the settings form, where the variant cell is free text with these as suggestions: the list is
 * what this operator's server actually has, and typing one it does not have is a refusal naming it.
 */
export const variantNamesOf = (document: Capabilities | undefined): string[] => Object.keys(document?.variants ?? {});

/**
 * The cues this build performs, in the station's vocabulary.
 *
 * Filtered against {@link SPEECH_CUES} rather than passed through, because the two vocabularies are
 * the same eight words by agreement and not by construction: the server's list is a string array
 * precisely so that a newer one may add a word, and a cue the station has no name for is one nothing
 * can write. Claiming it would be the worse failure of the two — the host strips what a plugin does
 * not claim, so under-claiming costs a flourish and over-claiming gets the word "laugh" read out.
 */
export const cuesOf = (variant: EffectiveVariant | undefined): SpeechCue[] =>
    (variant?.cues ?? []).filter((cue): cue is SpeechCue => (SPEECH_CUES as readonly string[]).includes(cue));

/** The deliveries this build performs, on {@link cuesOf}'s rule and for its reason. */
export const deliveriesOf = (variant: EffectiveVariant | undefined): SpeechDelivery[] => (variant?.deliveries ?? []).filter(isSpeechDelivery);

/**
 * The most text this build takes in one call, if it says.
 *
 * Absent is absent rather than a number of this plugin's own: the host has a conservative default
 * for exactly this case and applying a different one here would hide it.
 */
export const maxCharactersOf = (variant: EffectiveVariant | undefined): number | undefined => {
    const declared = variant?.maxCharacters;
    return typeof declared === 'number' && Number.isInteger(declared) && declared > 0 ? declared : undefined;
};

/**
 * This build's speed dial, if it has one.
 *
 * `speed` is the one dial name this plugin knows the meaning of. Everything else in `dials` is an
 * engine's own vocabulary — `exaggeration`, `cfgWeight`, `gpuMemory` — which the SDK is explicit
 * belongs in a plugin's config rather than on the station's contract, and which this plugin has no
 * column for on purpose.
 */
export const speedDialOf = (variant: EffectiveVariant | undefined): Dial | undefined => {
    const dial = variant?.dials?.[SPEED_DIAL];
    if (dial === undefined) return undefined;

    return typeof dial.min === 'number' && typeof dial.max === 'number' && dial.min <= dial.max ? dial : undefined;
};

/**
 * A speed the operator typed, as a number this dial will take.
 *
 * Clamped rather than refused, on `plugins/kokoro`'s argument: a value out of range is an operator
 * asking for something the engine cannot do, and the nearest thing it can do is a better answer than
 * ignoring them. Refusing is not even available here — an out-of-range dial is a 400 naming the key,
 * which would cost the break.
 */
export const speedWithin = (dial: Dial, speed: number): number => Math.min(dial.max, Math.max(dial.min, speed));
