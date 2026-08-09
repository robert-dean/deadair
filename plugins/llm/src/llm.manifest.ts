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
 * How long the model list is trusted before asking the server again.
 *
 * Listing models is on the path of every conversation that might use tools, so a
 * round trip per break to learn something that only changes when an operator
 * installs a model is a poor trade. Short enough that a newly pulled model shows
 * up within a minute without anyone reloading the plugin.
 */
export const MODEL_CACHE_MS = 60_000;

/**
 * Validated on the way in, so `onLoad` never has to defend against a half-typed
 * form.
 *
 * `models` is a textarea rather than a structured field for the same reason the
 * speech engine's voice map is: the host's form vocabulary has no list type, and
 * how many models a station keeps is not something to guess at. Parsing it here
 * means an entry that yields nothing is refused at save time, with the operator
 * still looking at the form.
 *
 * Note what it no longer is. It used to be the whole model list, which asked the
 * operator to type out something the server will tell you if you ask it. It now
 * carries only the `+tools` flags, which is the part no endpoint reports.
 */
export const configSchema = z.object({
    providerKind: z.enum(Object.keys(PROVIDER_KINDS) as [ProviderKind, ...ProviderKind[]]).optional(),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    // Optional, and the reason is a loop the operator would otherwise be stuck in:
    // the server URL cannot be tested until it is saved, and the models cannot be
    // learned until it is tested. Requiring a model to save the address means being
    // asked for a name there is no way to find out. Save, test, read the names,
    // come back. `generate` refuses with `config` if it is still unset by the time
    // something asks for words, which is the right place to notice.
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    // Tolerant on purpose: the ordinary form is the multiselect's JSON array, and the older
    // "name +tools" text is still accepted so an install configured before the field changed keeps
    // its tool support rather than silently losing it.
    models: z.string().optional().refine(isParseableModelList, { message: 'expected a list of models' }),
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
            help: 'Used whenever the station does not name one. Save the server URL first and this lists what it has; anything it does not list can still be typed.',
        },
        {
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            help: "Used when the station does not say. Leave empty for the provider's own default.",
        },
        {
            key: 'models',
            label: 'Tool-capable models',
            type: 'multiselect',
            help: "Which of this server's models can be given tools. No endpoint reports this and it cannot be guessed from a name, so it is the one thing here you have to know. A model not ticked is never sent any.",
        },
    ],
    configSchema,
};
