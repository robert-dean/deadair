import { PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import {
    MAX_SPEED,
    MIN_SPEED,
    VOICE_ENGINE_COLUMN,
    VOICE_NAME_COLUMN,
    VOICE_SPEED_COLUMN,
    VOICES_FIELD,
    voiceRowsAreComplete,
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

/** What the OpenAI-compatible layer calls the model. Accepted aliases exist; this is the plain one. */
export const DEFAULT_MODEL = 'chatterbox';

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
 * Formats this server will encode to, and what each one IS.
 *
 * The answer given in `SpeechHandle.mime` is what the station stores the audio
 * under and later serves, and both consumers of station audio go by that header
 * rather than by the bytes — so a wav announced as mpeg fails as silence rather
 * than as an error anybody sees.
 */
export const RESPONSE_FORMATS = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    opus: 'audio/ogg',
    flac: 'audio/flac',
} as const satisfies Record<string, string>;

export type ResponseFormat = keyof typeof RESPONSE_FORMATS;

export const DEFAULT_FORMAT: ResponseFormat = 'mp3';

/** Off, so a station proves the engine works before anything starts dropping it. See the field's help. */
export const DEFAULT_UNLOAD_AFTER_RENDER = false;

export const configSchema = z.object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    format: z.enum(Object.keys(RESPONSE_FORMATS) as [ResponseFormat, ...ResponseFormat[]]).optional(),
    defaultVoice: z.string().optional(),
    unloadAfterRender: z.union([z.boolean(), z.string()]).optional(),
    [VOICES_FIELD]: z
        .string()
        .optional()
        .refine(voiceRowsAreComplete, { message: 'every voice needs both a station name and an engine voice' }),
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
            help: 'The OpenAI-compatible root, ending in /v1. Model management lives one level above it and is derived from this.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Leave empty unless the server is behind something that wants one.',
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
            help: "Used for anything the station has no mapping for. A filename in the server's predefined-voice directory.",
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help:
                'The station asks for its own names and this says what each one sounds like here. A name is whatever you want to call a voice — a role like "host" or "newsreader", or a character — and it is what a persona points at. ' +
                "The engine voice offers what this server reports; drop a new clip into its predefined-voice directory and refresh to see it.",
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
            label: `Speed is optional and ranges from ${MIN_SPEED} to ${MAX_SPEED}. Leave it empty to read at the engine's own pace.`,
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
