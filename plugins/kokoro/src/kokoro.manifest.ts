import { PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import { parseVoiceMap } from './kokoro.voices.js';

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
 * `voices` is a textarea of `stationId = engineVoice` lines rather than a
 * structured field, because the host's form vocabulary has no map type and a
 * fixed set of named voice slots would be a guess at how many personas a station
 * will have. Parsing it here means a malformed line is refused at save time,
 * with the operator still looking at the form.
 */
export const configSchema = z.object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    format: z.enum(Object.keys(RESPONSE_FORMATS) as [ResponseFormat, ...ResponseFormat[]]).optional(),
    defaultVoice: z.string().optional(),
    voices: z
        .string()
        .optional()
        .refine(value => parseVoiceMap(value).ok, { message: 'each entry must be "stationVoice = engineVoice"' }),
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
            help: 'Used for anything the station has no mapping for. Must be a voice this server has.',
        },
        {
            key: 'voices',
            label: 'Voices',
            type: 'string',
            help: '"stationVoice = engineVoice", separated by commas or newlines, e.g. "host = af_heart, newsreader = am_michael". The station asks for its own names; this says what they sound like here.',
        },
    ],
    configSchema,
};
