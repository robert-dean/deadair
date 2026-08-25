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
} from './kokoro.voices.js';

export const PLUGIN_ID = 'deadair.kokoro';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where Kokoro answers when it is the container beside the app.
 *
 * Only a placeholder in the form: the operator supplies the real one, because
 * the same plugin has to reach `http://kokoro:8880/v1` from inside compose,
 * `http://localhost:8880/v1` from a host `pnpm dev`, and OpenAI's own endpoint
 * from neither.
 */
export const DEFAULT_BASE_URL = 'http://localhost:8880/v1';

/** Kokoro's own model name. `tts-1` and friends are accepted aliases. */
export const DEFAULT_MODEL = 'kokoro';

/** A safe voice to start on: it exists on a stock Kokoro build. */
export const DEFAULT_VOICE = 'af_heart';

/**
 * The voices a fresh station starts with, and which engine voice each one is here.
 *
 * ## Why a plugin ships a map of the station's own names
 *
 * Because the alternative was measured and it was one voice. An empty map is not
 * a neutral starting point: every persona falls through to `defaultVoice`, so a
 * station with nineteen written characters reads all of them in the same warm
 * American female and the operator has no way to know that is a default rather
 * than a decision. The names are the STATION's vocabulary and the engine voices
 * are this plugin's answer to them, which is exactly the split the whole
 * indirection is for — `plugins/chatterbox` ships the same names against its own
 * clips, so switching engines keeps every persona pointed at something.
 *
 * ## Where the picks come from
 *
 * The previous station's built-in voice profiles, for the ten characters it had,
 * and each persona's own sheet for the rest. Two of those inherited picks carry
 * an argument worth keeping: a pirate's growl is nearer `bm_george` than anything
 * in the American set and the dialect reads far better in it, and a measured,
 * thoughtful read lands better in `bm_fable` than in any of them. A shipping
 * forecast is not read by an American either.
 *
 * What is NOT inherited is the previous station's per-provider matrix, which
 * mapped every profile onto every engine host-side. That was rejected here on
 * purpose: the engine's opinion belongs to the engine, which is why this table is
 * in a plugin and the names in it are the only part the host knows.
 *
 * ## Two rules about the rows
 *
 * **No two characters that could air in one shift share a voice.** They are all
 * distinct here, which is easy at twenty against sixty-eight; the rule matters on
 * an engine with fewer, where sharing is fine between characters a schedule keeps
 * apart and wrong between two a listener hears in an hour.
 *
 * **A speed is only set where the persona's own words ask for one** — "speaking
 * slow", "breathless", "hushed", "never lets a second of dead air happen". A
 * default that nudged every voice would be this file having an opinion about
 * characters it did not write.
 */
export const DEFAULT_VOICE_ROWS: readonly { name: string; engine: string; speed?: string }[] = [
    { name: 'classic', engine: 'af_heart' },
    { name: 'latenight', engine: 'am_echo', speed: '0.95' },
    { name: 'cratedigger', engine: 'af_kore' },
    { name: 'pirate', engine: 'bm_george' },
    { name: 'howler', engine: 'am_fenrir', speed: '1.1' },
    { name: 'quietstorm', engine: 'af_river', speed: '0.9' },
    { name: 'countdown', engine: 'am_michael' },
    { name: 'wisecrack', engine: 'af_jessica' },
    { name: 'shockjock', engine: 'am_adam', speed: '1.1' },
    { name: 'conspiracy', engine: 'am_eric' },
    { name: 'bossjock', engine: 'am_liam', speed: '1.15' },
    { name: 'videoage', engine: 'af_nova' },
    { name: 'slacker', engine: 'am_puck', speed: '0.9' },
    { name: 'millennium', engine: 'af_sarah', speed: '1.1' },
    { name: 'automaton', engine: 'af_alloy', speed: '0.95' },
    { name: 'naturalist', engine: 'bm_fable', speed: '0.9' },
    { name: 'playbyplay', engine: 'bm_lewis', speed: '1.15' },
    { name: 'gumshoe', engine: 'am_onyx', speed: '0.9' },
    { name: 'forecast', engine: 'bm_daniel', speed: '0.9' },
    // Not a persona. The one role slot worth shipping, because a bulletin read in
    // the host's voice is a decision a station should be able to make rather than
    // one it falls into — see `docs/todo/personas.md` §1, which is the work that
    // will read it.
    { name: 'newsreader', engine: 'bf_emma' },
    // The people who ring IN — `caller.defaults.ts`. They are down here rather than
    // in key order because they are a different kind of character, and the rule
    // above them is the same one read twice as hard: a caller must never share a
    // voice with a host, since the two are in one production talking to each other.
    { name: 'theorist', engine: 'am_v0gurney', speed: '1.1' },
    { name: 'grumbler', engine: 'am_santa', speed: '0.95' },
    { name: 'dedication', engine: 'bf_lily' },
    { name: 'pedant', engine: 'bf_isabella' },
    { name: 'nightshift', engine: 'af_nicole', speed: '0.9' },
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
 * This bounds the request and its headers only, not the audio, which arrives
 * afterwards under the host's own per-body idle, lifetime and byte bounds.
 * Kokoro on CPU thinks for a few seconds before the first byte and that is
 * normal, not a fault, so this sits well above it.
 */
export const SPEAK_TIMEOUT_MS = 30_000;

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Formats Kokoro will encode to, and what each one IS.
 *
 * Kept here rather than derived, because the answer this plugin gives in
 * `SpeechHandle.mime` is what the station stores the audio under and later
 * serves, and both consumers of station audio go by that header rather than by
 * the bytes.
 */
export const RESPONSE_FORMATS = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    opus: 'audio/ogg',
    flac: 'audio/flac',
} as const satisfies Record<string, string>;

export type ResponseFormat = keyof typeof RESPONSE_FORMATS;

export const DEFAULT_FORMAT: ResponseFormat = 'mp3';

/**
 * Validated on the way in, so `init()` never has to defend against a half-typed
 * form.
 *
 * `voices` is a `list` field, stored as a JSON array of row objects, so the only
 * thing left to check here is that no row names one half of a mapping and not the
 * other — a shape the form itself cannot prevent, and one that becomes a voice the
 * station silently does not have. Refused at save time, with the operator still
 * looking at the table.
 */
export const configSchema = z.object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    format: z.enum(Object.keys(RESPONSE_FORMATS) as [ResponseFormat, ...ResponseFormat[]]).optional(),
    defaultVoice: z.string().optional(),
    [VOICES_FIELD]: z.string().optional().refine(voiceRowsAreComplete, { message: 'every voice needs both a station name and an engine voice' }),
});

export const kokoroManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Kokoro',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description: 'Gives the station a voice, through any OpenAI-compatible speech server. Ships pointed at the bundled Kokoro container.',
    homepage: 'https://github.com/remsky/Kokoro-FastAPI',
    permissions: {
        // The operator names the address, so there is no hostname to write down
        // here. An unset or unparseable `baseUrl` contributes no entry at all,
        // which refuses the call exactly as an undeclared host would.
        network: [{ fromConfig: 'baseUrl' }],
        // Nothing is kept between calls. Voice previews are cached by the
        // station, which already has somewhere to put audio and a route that
        // serves it; a base64 copy in plugin storage would be a second, worse one.
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
            help: 'An OpenAI-compatible speech server. The bundled container answers on http://kokoro:8880/v1, or http://localhost:8880/v1 when the API runs on the host.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Leave empty for a local Kokoro. Required if you point this at OpenAI instead.',
        },
        {
            key: 'model',
            label: 'Model',
            type: 'string',
            default: DEFAULT_MODEL,
        },
        {
            key: 'format',
            label: 'Audio format',
            type: 'select',
            default: DEFAULT_FORMAT,
            options: (Object.keys(RESPONSE_FORMATS) as ResponseFormat[]).map(value => ({ value, label: value })),
            help: 'mp3 unless you have a reason. It is what the station stores and what the stream wants.',
        },
        {
            key: 'defaultVoice',
            label: 'Default voice',
            type: 'string',
            default: DEFAULT_VOICE,
            help: 'Used for anything the station has no mapping for. Pick from what this server reports, or type a blend.',
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            default: DEFAULT_VOICES_JSON,
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help:
                'The station asks for its own names and this says what each one sounds like here. A name is whatever you want to call a voice — a role like "host" or "newsreader", or a character — and it is what a persona points at. ' +
                'The engine voice offers what this server actually has; you can also type a blend, like "af_bella(2)+af_sky(1)".',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'host' },
                // No `options` of its own: the list is whatever the operator's own server currently
                // reports, which only the plugin can ask for. See `suggestConfigOptions`. Left as
                // `string` rather than `select` so a blend expression, which names no single
                // voicepack, is still typeable — the console draws a cell with choices as an
                // autocomplete for exactly this reason.
                { key: VOICE_ENGINE_COLUMN, label: 'Engine voice', type: 'string', required: true, placeholder: 'af_heart' },
                { key: VOICE_SPEED_COLUMN, label: 'Speed', type: 'string', placeholder: '1' },
            ],
        },
        {
            key: 'speedNote',
            type: 'note',
            label: `Speed is optional and ranges from ${MIN_SPEED} to ${MAX_SPEED}. Leave it empty to read at the engine's own pace, which is what every voice did before the column existed.`,
        },
    ],
    configSchema,
};
