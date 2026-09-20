import { PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import {
    VOICE_ENGINE_COLUMN,
    VOICE_NAME_COLUMN,
    VOICE_SPEED_COLUMN,
    VOICE_VARIANT_COLUMN,
    VOICE_VOICE_COLUMN,
    VOICES_FIELD,
    voiceRowsAreComplete,
} from './rhapsode.voices.js';

export const PLUGIN_ID = 'deadair.rhapsode';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where a rhapsode answers when nobody has moved it.
 *
 * Only a placeholder in the form: the operator supplies the real one, because the same plugin has to
 * reach `http://rhapsode:8080` from inside compose and `http://localhost:8080` from a host
 * `pnpm dev`, and the container publishes on loopback deliberately.
 */
export const DEFAULT_BASE_URL = 'http://localhost:8080';

/**
 * The engine a row that names none is spoken by.
 *
 * Kokoro because it is the one engine in the catalogue that runs on a CPU and needs no card, so a
 * fresh install of both halves has something that speaks. An operator with a GPU changes this once,
 * at the top of the form, and every row that never named an engine moves with it.
 */
export const DEFAULT_ENGINE = 'kokoro';

/**
 * Formats to ask for, and what each one IS to the station.
 *
 * rhapsode also encodes `pcm`, which is deliberately not here: it answers `audio/L16`, the segment
 * store holds no such thing, and a raw stream with its rate in the content-type parameters is not
 * something the station has anywhere to put. `opus` is Ogg-encapsulated and the server says so by
 * answering `audio/opus`, which is the one media type this plugin rewrites on the way out — the
 * store files it as `ogg`, and the bytes are the same bytes.
 *
 * What the SERVER can encode is narrower than this and it says so in its capability document: mp3,
 * opus and flac all want an ffmpeg with the matching encoder, and a rhapsode without one offers
 * `wav` and `pcm` alone. Asking for one it does not have is a refusal naming it, which is why this
 * table is a request and not a promise.
 */
export const RESPONSE_FORMATS = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    opus: 'audio/ogg',
    flac: 'audio/flac',
} as const satisfies Record<string, string>;

export type ResponseFormat = keyof typeof RESPONSE_FORMATS;

export const DEFAULT_FORMAT: ResponseFormat = 'mp3';

/** Whether a value is a format this plugin knows how to file the answer to. */
export const isResponseFormat = (value: unknown): value is ResponseFormat => typeof value === 'string' && Object.hasOwn(RESPONSE_FORMATS, value);

/**
 * How long one synthesis may take.
 *
 * This bounds the request and its headers only, not the audio, which arrives afterwards under the
 * host's own per-body idle, lifetime and byte bounds.
 *
 * The number is picked to lose a race on purpose. The render path gives `speech.speak` 120 seconds
 * and `host.fetch` clamps anything longer to whatever is left of that, so a plugin asking for more
 * would not get it: it would be abandoned mid-call by the invoker instead, which is a timeout with
 * nobody's name on it. Sitting just under means a server that never answers fails as THIS plugin's
 * timeout, naming the engine and the voice. It has to be this large because the first call after a
 * cold start pays for a model load and, at `maxResidentModels: 1`, possibly an eviction wait first —
 * rhapsode's own ceiling on a worker's headers is 120 seconds for the same reason.
 */
export const SPEAK_TIMEOUT_MS = 115_000;

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * The narrowest keep-alive the form will take, and what it means.
 *
 * rhapsode's own vocabulary: -1 never expires, 0 frees the model as soon as the request lets go of
 * it, and anything above is seconds. Blank is not zero — it means send nothing and let the server's
 * own configuration decide, which is the right default for the operator who has already tuned it
 * there.
 */
export const MIN_KEEP_ALIVE_SECONDS = -1;

/**
 * Validated on the way in, so `init()` never has to defend against a half-typed form.
 *
 * `voices` is a `list` field, stored as a JSON array of row objects, so the only thing left to check
 * here is that no row names a station voice without an engine voice to say it in — a shape the form
 * itself cannot prevent, and one that becomes a voice the station silently does not have. Refused at
 * save time, with the operator still looking at the table.
 */
export const configSchema = z.object({
    baseUrl: z.string().min(1),
    defaultEngine: z.string().optional(),
    defaultVoice: z.string().optional(),
    defaultVariant: z.string().optional(),
    format: z.enum(Object.keys(RESPONSE_FORMATS) as [ResponseFormat, ...ResponseFormat[]]).optional(),
    // A number field arrives as a number from the console and as whatever a hand-edited row holds
    // otherwise, so both are taken here and narrowed where it is read.
    keepAliveSeconds: z.union([z.number(), z.string()]).optional(),
    [VOICES_FIELD]: z.string().optional().refine(voiceRowsAreComplete, { message: 'every voice needs both a station name and an engine voice' }),
});

export const rhapsodeManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Rhapsode',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description: 'Gives the station a voice through a Rhapsode server, which holds several speech engines at once and says what each of them can do.',
    homepage: 'https://github.com/MaroonedSoftware/rhapsode',
    permissions: {
        // The operator names the address, so there is no hostname to write down here. An unset or
        // unparseable `baseUrl` contributes no entry at all, which refuses the call exactly as an
        // undeclared host would.
        network: [{ fromConfig: 'baseUrl' }],
        // Nothing is kept between calls. What this plugin would otherwise cache — the capability
        // document — is cheap to ask for again and wrong to keep across a restart, since it
        // describes a server that may have been reconfigured while the station was down.
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
            help: 'Where the Rhapsode server answers. Its container publishes on http://localhost:8080; inside compose it is the service name, like http://rhapsode:8080.',
        },
        {
            key: 'defaultEngine',
            label: 'Default engine',
            type: 'string',
            default: DEFAULT_ENGINE,
            help: 'Which engine speaks for any voice that does not name one of its own. The engines this server has installed are offered once it can be reached.',
        },
        {
            key: 'defaultVoice',
            label: 'Default voice',
            type: 'string',
            help: "Used for anything the station has no mapping for. Leave it empty to take the engine's own default voice.",
        },
        {
            key: 'defaultVariant',
            label: 'Default variant',
            type: 'string',
            help: 'Which build of the engine to use. Leave it empty to take whichever one the server already has loaded, which is the faster answer.',
        },
        {
            key: 'format',
            label: 'Audio format',
            type: 'select',
            default: DEFAULT_FORMAT,
            options: (Object.keys(RESPONSE_FORMATS) as ResponseFormat[]).map(value => ({ value, label: value })),
            help: 'mp3 unless you have a reason. It is what the station stores and what the stream wants. A server built without ffmpeg offers wav alone.',
        },
        {
            key: 'keepAliveSeconds',
            // The seconds are in the label because the host's `unit` vocabulary has no word for
            // them: it holds `bytes` and `fraction`, both of which exist to change what the console
            // DRAWS, and a plain number of seconds is already drawn correctly.
            label: 'Keep the model loaded for (seconds)',
            type: 'number',
            min: MIN_KEEP_ALIVE_SECONDS,
            step: 1,
            help: 'How long Rhapsode should hold a model on the card after a break. Leave it empty to use the setting on the server itself. 0 frees it immediately, -1 never does.',
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            placeholder: 'No voices yet, so everything the station says uses the default engine and voice.',
            help:
                'The station asks for its own names and this says what each one sounds like here. A name is whatever you want to call a voice — a role like "host" or "newsreader", or a character — and it is what a persona points at. ' +
                'A voice belongs to one engine, so the engine column is part of the address; leave it empty to use the default engine above.',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'host' },
                // None of the three carries `options` of its own: what this server has installed,
                // which voices each engine holds and which builds it can load are only knowable by
                // asking it, which only the plugin can do. See `suggestConfigOptions`. Left as
                // `string` rather than `select` so a voice cloned into the server a moment ago is
                // still typeable — the console draws a cell with choices as an autocomplete for
                // exactly this reason.
                { key: VOICE_ENGINE_COLUMN, label: 'Engine', type: 'string', placeholder: DEFAULT_ENGINE },
                { key: VOICE_VOICE_COLUMN, label: 'Engine voice', type: 'string', required: true, placeholder: 'af_heart' },
                { key: VOICE_VARIANT_COLUMN, label: 'Variant', type: 'string', placeholder: 'whatever is loaded' },
                { key: VOICE_SPEED_COLUMN, label: 'Speed', type: 'string', placeholder: "the engine's own pace" },
            ],
        },
        {
            key: 'speedNote',
            type: 'note',
            label:
                "Speed is optional, and only some engines have it: it is one of the engine's own dials, with its own range, and a voice on a build that does not declare one is read at its ordinary pace whatever you put here. " +
                'Leave it empty unless a character calls for it.',
        },
    ],
    configSchema,
};
