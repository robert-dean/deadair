import { PLUGIN_CAPABILITY_LLM, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import { isParseableModelList } from './llm.models.js';

export const PLUGIN_ID = 'deadair.llm';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where a local model server usually answers.
 *
 * A placeholder in the form only: the operator supplies the real one, because
 * the same plugin has to reach a container from inside compose, `localhost` from
 * a host `pnpm dev`, and somebody's cloud endpoint from neither.
 */
export const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/**
 * How the provider is spoken to.
 *
 * One arm today, and the discriminator exists precisely so the second one is a
 * dependency, a branch and an option rather than a second plugin. An
 * OpenAI-compatible endpoint already covers a local Ollama, OpenAI itself,
 * vLLM and most hosted providers, so the second arm is for the ones with a
 * native protocol worth using rather than for coverage.
 */
export const PROVIDER_KINDS = { 'openai-compat': 'OpenAI-compatible' } as const;

export type ProviderKind = keyof typeof PROVIDER_KINDS;

export const DEFAULT_PROVIDER_KIND: ProviderKind = 'openai-compat';

/**
 * The provider name handed to the AI SDK, which is also the key its provider
 * options are read under. Fixed rather than derived from the plugin id, because
 * changing it would silently stop `reasoningEffort` reaching the server.
 */
export const PROVIDER_NAME = 'openai-compatible';

/** A short call: it exists to answer "is anything there?", not to do work. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Validated on the way in, so `onLoad` never has to defend against a half-typed
 * form.
 *
 * `models` is a textarea rather than a structured field for the same reason the
 * speech engine's voice map is: the host's form vocabulary has no list type, and
 * how many models a station keeps is not something to guess at. Parsing it here
 * means an entry that yields nothing is refused at save time, with the operator
 * still looking at the form.
 */
export const configSchema = z.object({
    providerKind: z.enum(Object.keys(PROVIDER_KINDS) as [ProviderKind, ...ProviderKind[]]).optional(),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    models: z.string().optional().refine(isParseableModelList, { message: 'each entry is a model id, optionally followed by "+tools"' }),
});

export const llmManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Language model',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_LLM],
    apiVersion: '^1.0.0',
    description:
        'Lets the station ask a model for words, through any OpenAI-compatible endpoint. One plugin covers a local server and a hosted provider alike; which one is a setting.',
    permissions: {
        // The operator names the address, so there is no hostname to write down
        // here. An unset or unparseable `baseUrl` contributes no entry at all,
        // which refuses the call exactly as an undeclared host would.
        network: [{ fromConfig: 'baseUrl' }],
        // Nothing is kept between calls. A conversation belongs to whoever is
        // having it, and this plugin is the transport rather than a party to it.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'providerKind',
            label: 'Provider',
            type: 'select',
            default: DEFAULT_PROVIDER_KIND,
            options: (Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(value => ({ value, label: PROVIDER_KINDS[value] })),
            help: 'How the endpoint is spoken to. OpenAI-compatible covers a local server, OpenAI, and most hosted providers.',
        },
        {
            key: 'baseUrl',
            label: 'Server URL',
            type: 'url',
            required: true,
            default: DEFAULT_BASE_URL,
            help: 'Including any /v1. A local Ollama answers on http://localhost:11434/v1, or its container name from inside compose.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Leave empty for a local server that wants no key. Required for a hosted provider.',
        },
        {
            key: 'model',
            label: 'Default model',
            type: 'string',
            required: true,
            help: 'Used whenever the station does not name one. Callers may ask for a different model per request.',
        },
        {
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            help: "Used when the station does not say. Leave empty for the provider's own default.",
        },
        {
            key: 'models',
            label: 'Models',
            type: 'string',
            help: 'One per line, e.g. "gpt-oss:20b +tools". The "+tools" marks a model that can be given tools, which no endpoint reports and cannot be guessed from a name. A model listed without it is never sent any.',
        },
    ],
    configSchema,
};
