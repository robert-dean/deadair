import { PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import { DEFAULT_MODEL } from './elevenlabs.models.js';
import {
    SETTING_RANGES,
    VOICE_NAME_COLUMN,
    VOICE_SIMILARITY_COLUMN,
    VOICE_SPEED_COLUMN,
    VOICE_STABILITY_COLUMN,
    VOICE_STYLE_COLUMN,
    VOICE_VOICE_COLUMN,
    VOICES_FIELD,
    voiceRowsAreComplete,
} from './elevenlabs.voices.js';

export const PLUGIN_ID = 'deadair.elevenlabs';
export const PLUGIN_VERSION = '0.0.1';

/** The one host this plugin reaches. Fixed rather than configurable: there is one ElevenLabs. */
export const API_HOST = 'api.elevenlabs.io';
export const API_BASE = `https://${API_HOST}`;

/**
 * The voice anything unmapped is read in, until the operator picks one.
 *
 * George, one of ElevenLabs' own default voices and the one its API reference uses in every
 * example, so it is on every account. A starting point rather than a choice: the voices table is
 * where the station's characters get voices of their own.
 */
export const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

/**
 * Output formats to ask for, and what each one IS to the station.
 *
 * MP3 only. `pcm_*` answers raw samples the segment store has nowhere to file, and the `opus`,
 * `wav` and law-encoded formats buy a station that stores and streams MP3 nothing. 192 kbps needs a
 * Creator plan or above, which is why it is not the default: on a free key it is a refusal on every
 * break.
 */
export const OUTPUT_FORMATS = {
    mp3_44100_128: 'MP3, 44.1 kHz, 128 kbps',
    mp3_44100_192: 'MP3, 44.1 kHz, 192 kbps (Creator plan and above)',
    mp3_22050_32: 'MP3, 22 kHz, 32 kbps (smallest)',
} as const satisfies Record<string, string>;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'mp3_44100_128';

export const isOutputFormat = (value: unknown): value is OutputFormat => typeof value === 'string' && Object.hasOwn(OUTPUT_FORMATS, value);

/**
 * How long one synthesis may take.
 *
 * `plugins/rhapsode`'s number and its reason: the render path gives `speech.speak` 120 seconds and
 * `host.fetch` clamps to what is left, so sitting just under means a service that never answers
 * fails as THIS plugin's timeout, naming the voice, rather than as an invoker abandoning the call.
 * A hosted model answers in a second or two; the headroom is for a bad day, not for a cold start.
 */
export const SPEAK_TIMEOUT_MS = 115_000;

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Validated on the way in. The key is not here: it is a secret, read through `host.secrets`, and
 * `plugins/lastfm` leaves its own out of the schema for the same reason.
 */
export const configSchema = z.object({
    model: z.string().optional(),
    format: z.enum(Object.keys(OUTPUT_FORMATS) as [OutputFormat, ...OutputFormat[]]).optional(),
    defaultVoice: z.string().optional(),
    [VOICES_FIELD]: z.string().optional().refine(voiceRowsAreComplete, { message: 'every voice needs both a station name and an ElevenLabs voice' }),
});

const range = (key: keyof typeof SETTING_RANGES): string => `${SETTING_RANGES[key].min}–${SETTING_RANGES[key].max}`;

export const elevenlabsManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'ElevenLabs',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description:
        'Gives the station a voice through ElevenLabs, a hosted speech service. Needs an ElevenLabs API key; every character spoken counts against its plan.',
    homepage: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
    permissions: {
        // ElevenLabs does not publish a request rate for this route, only a concurrency limit per
        // plan, which the service enforces itself with a 429. This bucket is a ceiling on the
        // station's own mistakes rather than a reading of theirs.
        network: [{ host: API_HOST, ratePerSecond: 5, bucket: 'elevenlabs' }],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            required: true,
            help: 'From your ElevenLabs profile, under API keys. A restricted key needs Text to Speech, and Voices (read) for the voice list.',
        },
        {
            key: 'model',
            label: 'Model',
            type: 'string',
            default: DEFAULT_MODEL,
            help: 'Eleven v4 is the most expressive. v4 Turbo answers faster, Flash v2.5 is the cheapest. Any model id ElevenLabs lists works.',
        },
        {
            key: 'format',
            label: 'Audio format',
            type: 'select',
            default: DEFAULT_OUTPUT_FORMAT,
            options: (Object.entries(OUTPUT_FORMATS) as [OutputFormat, string][]).map(([value, label]) => ({ value, label })),
        },
        {
            key: 'defaultVoice',
            label: 'Default voice',
            type: 'string',
            default: DEFAULT_VOICE,
            help: 'An ElevenLabs voice id, used for anything the station has no mapping for.',
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help:
                'The station asks for its own names and this says which ElevenLabs voice each one is. A name is a role like "host" or "newsreader", or a character, and it is what a persona points at. ' +
                'The settings are optional: leave one empty and the voice keeps the setting it has in ElevenLabs.',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'host' },
                // Free text with suggestions rather than a select, so a voice added in ElevenLabs since
                // the list was last fetched is still typeable.
                { key: VOICE_VOICE_COLUMN, label: 'ElevenLabs voice', type: 'string', required: true, placeholder: DEFAULT_VOICE },
                { key: VOICE_STABILITY_COLUMN, label: 'Stability', type: 'string', placeholder: range('stability') },
                { key: VOICE_SIMILARITY_COLUMN, label: 'Similarity', type: 'string', placeholder: range('similarity_boost') },
                { key: VOICE_STYLE_COLUMN, label: 'Style', type: 'string', placeholder: range('style') },
                { key: VOICE_SPEED_COLUMN, label: 'Speed', type: 'string', placeholder: range('speed') },
            ],
        },
        {
            key: 'settingsNote',
            type: 'note',
            label: 'Eleven v4 and v4 Turbo read Stability and Similarity only. Style and Speed are kept for the models that read them (v3, Multilingual v2, Flash v2.5) and are not sent to the others.',
        },
    ],
    configSchema,
};
