import { PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import {
    MAX_SPEED,
    MIN_SPEED,
    VOICE_ENGINE_COLUMN,
    VOICE_NAME_COLUMN,
    VOICE_SPEED_COLUMN,
    VOICES_FIELD,
    voiceMapOf,
    voiceRowsAreComplete,
    type VoiceMap,
} from './chatterbox.voices.js';

export const PLUGIN_ID = 'deadair.chatterbox';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where this engine usually answers.
 *
 * A placeholder like the other speech plugin's: the operator supplies the real
 * one, because the whole reason this engine is interesting is that it wants a
 * GPU, which is usually not the machine the station runs on.
 */
export const DEFAULT_BASE_URL = 'http://localhost:8004/v1';

/**
 * A voice that exists on a stock install.
 *
 * A FILENAME, which is the thing to know about this engine's voices: they are
 * reference WAVs in a directory rather than named presets, so there is no
 * canonical set and this is a guess that happens to be right about the images
 * shipping today.
 */
export const DEFAULT_VOICE = 'Olivia.wav';

/**
 * The voices a fresh station starts with, and which clip each one is here.
 *
 * **The NAMES are the point, and they are the other engine's names on purpose.**
 * A persona names a station voice, so the two bundled speech plugins shipping the
 * same twenty slots is what makes switching engines a settings change rather than
 * a rewrite of nineteen characters. That is the whole of what the indirection was
 * built for, and it is only true if both maps actually cover the same vocabulary
 * — `voice.slots.test.ts` in the API holds them to it, because a slot that exists
 * on one engine and not the other is a persona that silently loses its voice on
 * the day the operator switches.
 *
 * **The PICKS here are weaker than the other engine's, and it is worth saying so.**
 * Kokoro's voice ids carry their accent and register in the name, and the previous
 * station had auditioned ten of them, so those rows are evidence. This engine's
 * voices are reference clips named after people — nothing in `Everett.wav` says
 * whether it growls — so these are assigned to match the other map's gender and to
 * keep every character distinct, and nothing more. They are a starting point that
 * makes the station sound like twenty different people rather than one, which is
 * the failure worth fixing first; which of them suits the pirate is a question for
 * whoever listens, and it is one table row to answer.
 *
 * **Not one row sets a SPEED, and that is this engine rather than an oversight.**
 * Twelve of them did, copied across from the other map, where the rule is that a
 * speed is set only where the persona's own words ask for one ("breathless",
 * "hushed"). That rule is sound over there and wrong here, because the two engines
 * mean different things by the field. Kokoro is deterministic and scales its
 * duration predictor: asked for 1.1 it answered in x0.939 of the time, not the
 * x0.909 a stretch would give, because only the phonemes moved and the pauses did
 * not. This engine has no pace parameter at all, so its OpenAI-shaped layer
 * time-stretches audio the model has already finished — measured, the same line
 * rendered three times at speed 1 came back 4.000s, 3.960s and 4.240s (it samples,
 * so ~7% of spread is free), 1.1 came back 3.709s and 0.9 came back 4.711s, both
 * tracking 1/speed inside that noise, and every one of them at 24 kHz. Duration
 * scaling by exactly 1/speed with the pitch held is a pitch-preserving stretch, and
 * what it costs is the phase smearing that reads as a short echo on the voice,
 * worst on sibilants and worse the further from 1.
 *
 * So the shipped rows ask this engine for nothing but a clip, which is also the
 * better instrument here: these voices are reference recordings, and a recording
 * carries pace and register natively where a multiplier can only stretch what came
 * out. The COLUMN stays, because it is an operator's call on their own server and
 * the field's own help says what it costs. Do not "restore" the parity with
 * `plugins/kokoro` — the divergence is the measurement.
 */
export const DEFAULT_VOICE_ROWS: readonly { name: string; engine: string; speed?: string }[] = [
    { name: 'classic', engine: 'Olivia.wav' },
    { name: 'latenight', engine: 'Miles.wav' },
    { name: 'cratedigger', engine: 'Jade.wav' },
    { name: 'pirate', engine: 'Everett.wav' },
    { name: 'howler', engine: 'Axel.wav' },
    { name: 'quietstorm', engine: 'Layla.wav' },
    { name: 'countdown', engine: 'Michael.wav' },
    { name: 'wisecrack', engine: 'Cora.wav' },
    { name: 'shockjock', engine: 'Austin.wav' },
    { name: 'conspiracy', engine: 'Jeremiah.wav' },
    { name: 'bossjock', engine: 'Ryan.wav' },
    { name: 'videoage', engine: 'Gianna.wav' },
    { name: 'slacker', engine: 'Connor.wav' },
    { name: 'millennium', engine: 'Emily.wav' },
    { name: 'automaton', engine: 'Jordan.wav' },
    { name: 'naturalist', engine: 'Julian.wav' },
    { name: 'playbyplay', engine: 'Leonardo.wav' },
    { name: 'gumshoe', engine: 'Thomas.wav' },
    { name: 'forecast', engine: 'Alexander.wav' },
    { name: 'newsreader', engine: 'Abigail.wav' },
    // The people who ring IN — `caller.defaults.ts`. Matched to the other map for
    // register rather than for filename, so switching engines does not change a
    // caller's sex or age, and no caller shares a clip with a host: the two are in
    // one production talking to each other.
    { name: 'theorist', engine: 'Eli.wav' },
    { name: 'grumbler', engine: 'Henry.wav' },
    { name: 'dedication', engine: 'Alice.wav' },
    { name: 'pedant', engine: 'Elena.wav' },
    { name: 'nightshift', engine: 'Taylor.wav' },
];

/** The rows as the config stores them: a JSON array in a string, exactly as the console writes it. */
export const DEFAULT_VOICES_JSON = JSON.stringify(DEFAULT_VOICE_ROWS);

/**
 * What the config holds, or the shipped rows when it maps nothing.
 *
 * The fallback is on the MAP rather than on the raw value, which is the whole of
 * the fix: `"[]"`, `""`, `"not json"` and an absent key are four ways of saying
 * the same thing, and only the last of them used to get the shipped voices. See
 * the call site for why the console cannot leave a station in the never-opened
 * state that distinction relied on.
 */
export const shippedUnlessMapped = (raw: unknown): VoiceMap => {
    const configured = voiceMapOf(raw);

    return Object.keys(configured).length > 0 ? configured : voiceMapOf(DEFAULT_VOICES_JSON);
};

/**
 * How long one synthesis may take.
 *
 * Bounds the request and its headers, not the audio. Generous even by the other
 * speech plugin's standard, because this one may have to LOAD a model first —
 * see `ModelLifecycle`, whose own bound sits inside this one.
 */
export const SPEAK_TIMEOUT_MS = 90_000;

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Formats this plugin can hand the station, and what each one IS.
 *
 * The answer given in `SpeechHandle.mime` is what the station stores the audio
 * under and later serves, and both consumers of station audio go by that header
 * rather than by the bytes — so a wav announced as mpeg fails as silence rather
 * than as an error anybody sees.
 *
 * **The MIME is the half no server reports**, which is why this table stays a
 * constant while the CHOICE offered in the form does not: `suggestConfigOptions`
 * narrows it to what the operator's own server declares it will encode to, and the
 * two meet as an intersection. A format the server takes and this table has no MIME
 * for cannot be offered, because {@link configSchema} would refuse it on the way
 * back in and the operator would be picking a save that fails.
 *
 * `flac` was here for as long as this file existed and is gone: the server's schema
 * takes `wav | opus | mp3` and answers 422 to anything else, so it was a fourth
 * choice in the dropdown that broke every break rendered under it. That is the
 * failure the narrowing above exists to stop happening again to whichever entry is
 * next, and dropping it is what keeps the STATIC list honest for a form drawn while
 * the server is unreachable.
 */
export const RESPONSE_FORMATS = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    opus: 'audio/ogg',
} as const satisfies Record<string, string>;

export type ResponseFormat = keyof typeof RESPONSE_FORMATS;

export const DEFAULT_FORMAT: ResponseFormat = 'mp3';

/** Off, so a station proves the engine works before anything starts dropping it. See the field's help. */
export const DEFAULT_UNLOAD_AFTER_RENDER = false;

export const configSchema = z.object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    format: z.enum(Object.keys(RESPONSE_FORMATS) as [ResponseFormat, ...ResponseFormat[]]).optional(),
    defaultVoice: z.string().optional(),
    unloadAfterRender: z.union([z.boolean(), z.string()]).optional(),
    [VOICES_FIELD]: z.string().optional().refine(voiceRowsAreComplete, { message: 'every voice needs both a station name and an engine voice' }),
});

export const chatterboxManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Chatterbox',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description:
        'Gives the station a voice through a Chatterbox server, which reads from reference clips rather than named presets. Manages the model on the GPU, because this engine does not reload itself.',
    homepage: 'https://github.com/resemble-ai/chatterbox',
    permissions: {
        // One hostname, and it covers the model-lifecycle endpoints too: those sit
        // at the server root rather than under /v1, which is a path difference and
        // not a host one.
        network: [{ fromConfig: 'baseUrl' }],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'baseUrl',
            label: 'Server URL',
            type: 'url',
            required: true,
            default: DEFAULT_BASE_URL,
            help: 'The OpenAI-compatible root, ending in /v1. Synthesis and model management both live one level above it and are derived from this.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Leave empty unless the server is behind something that wants one.',
        },
        {
            key: 'modelNote',
            type: 'note',
            label:
                'There is no model to pick here: this server holds one at a time, named in its own configuration and swapped by restarting it, and the synthesis request does not name one at all. ' +
                'Test connection reports which model is loaded and what it is running on.',
        },
        {
            key: 'format',
            label: 'Audio format',
            type: 'select',
            default: DEFAULT_FORMAT,
            // The static fallback, for a form drawn before the server has answered. What is
            // actually offered is narrowed to the server's own declared set — see
            // `RESPONSE_FORMATS` and `suggestConfigOptions`.
            options: (Object.keys(RESPONSE_FORMATS) as ResponseFormat[]).map(value => ({ value, label: value })),
            help: 'mp3 unless you have a reason. It is what the station stores and what the stream wants.',
        },
        {
            key: 'defaultVoice',
            label: 'Default voice',
            type: 'string',
            default: DEFAULT_VOICE,
            help: "Used for anything the station has no mapping for. A filename in the server's predefined-voice directory.",
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            default: DEFAULT_VOICES_JSON,
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help:
                'The station asks for its own names and this says what each one sounds like here. A name is whatever you want to call a voice — a role like "host" or "newsreader", or a character — and it is what a persona points at. ' +
                'The engine voice offers what this server reports; drop a new clip into its predefined-voice directory and refresh to see it.',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'host' },
                // Free text with suggestions rather than a closed select: an operator who has just
                // dropped a WAV into the server's directory can name it before this plugin's list
                // has caught up, and being unable to name a voice the server HAS is a worse failure
                // than naming one it does not.
                { key: VOICE_ENGINE_COLUMN, label: 'Engine voice', type: 'string', required: true, placeholder: 'Olivia.wav' },
                { key: VOICE_SPEED_COLUMN, label: 'Speed', type: 'string', placeholder: '1' },
            ],
        },
        {
            key: 'speedNote',
            type: 'note',
            label:
                `Speed is optional and ranges from ${MIN_SPEED} to ${MAX_SPEED}. Leave it empty, which is what every shipped voice does. ` +
                'This engine has no pace of its own, so a speed is applied by stretching audio it has already finished, and that leaves a smearing on the voice that sounds like a faint echo. ' +
                'It is worst on a voice with a lot of sibilance, and it gets worse the further from 1 you go. Prefer a clip that already reads at the pace you want.',
        },
        {
            key: 'unloadAfterRender',
            label: 'Free the GPU between breaks',
            type: 'boolean',
            default: DEFAULT_UNLOAD_AFTER_RENDER,
            help:
                'Drops the model out of the GPU after each break and loads it again for the next one. Worth it only when something else wants that card — a local language model, most likely. ' +
                'Measured: an unload reclaims roughly 70% of what the model held, because the graphics runtime keeps the rest until the server exits, and the load before the next break is a new way for that break to be late or to fail. ' +
                'Off unless you know the card is contended.',
        },
    ],
    configSchema,
};
