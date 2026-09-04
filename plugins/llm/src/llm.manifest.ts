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
 * A dependency, a branch and an option rather than a plugin each, because
 * everything above the transport is the same work whoever answers: one model
 * slot, one tool loop, one effort fallback. See `llm.provider.ts` for what an
 * arm is allowed to know.
 *
 * The OpenAI-compatible arm is the broad one and covers a local Ollama or vLLM,
 * OpenAI itself, Groq, Mistral and OpenRouter behind whatever address is set. So
 * a native arm is never here for coverage: it is here because that service's own
 * protocol carries something the shared one cannot say.
 */
export const PROVIDER_KINDS = { 'openai-compat': 'OpenAI-compatible' } as const;

export type ProviderKind = keyof typeof PROVIDER_KINDS;

export const DEFAULT_PROVIDER_KIND: ProviderKind = 'openai-compat';

/** Which kinds cannot work without an API key, for the save-time check below. */
export const KEYED_KINDS: readonly ProviderKind[] = [];

/** Whether a config value is one of {@link PROVIDER_KINDS}'s own keys, rather than something a hand-edited row left behind. */
export function isProviderKind(value: string | undefined): value is ProviderKind {
    return value !== undefined && Object.hasOwn(PROVIDER_KINDS, value);
}

/**
 * How hard a reasoning model should think, as an operator can set it rather than
 * as every one of the sixteen call sites hard-codes it.
 *
 * `auto` is the default and the reason the setting exists at all without
 * breaking anything that already works: it forwards whatever the caller asked
 * for, which is what keeps an outline pass unpinned and lets one operator's
 * Ollama stay at `low`. `off` sends the field as `none` rather than omitting it
 * outright, because that is the value a reasoning model reads as "answer without
 * reasoning"; omitting it instead risks the provider's own default kicking in.
 * A server that does not know the field at all, reasoning or not, is what the
 * live 400-then-retry in `llm.plugin.ts` is for, and it does not need this
 * setting's help. The fixed levels override the caller's own hint outright.
 */
export const REASONING_EFFORTS = {
    auto: "Auto (forward the caller's own hint)",
    off: 'Off',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
} as const;

export type ReasoningEffortSetting = keyof typeof REASONING_EFFORTS;

export const DEFAULT_REASONING_EFFORT: ReasoningEffortSetting = 'auto';

/** Whether a config value is one of {@link REASONING_EFFORTS}'s own keys, rather than something a hand-edited config row left behind. */
export function isReasoningEffortSetting(value: string | undefined): value is ReasoningEffortSetting {
    return value !== undefined && Object.hasOwn(REASONING_EFFORTS, value);
}

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
export const configSchema = z
    .object({
        providerKind: z.enum(Object.keys(PROVIDER_KINDS) as [ProviderKind, ...ProviderKind[]]).optional(),
        reasoningEffort: z.enum(Object.keys(REASONING_EFFORTS) as [ReasoningEffortSetting, ...ReasoningEffortSetting[]]).optional(),
        // Optional here and required per arm below, because whether there is an address to
        // give depends on which provider was chosen: an OpenAI-compatible endpoint is
        // nothing without one, and a vendor's own API has an address that is not an
        // operator's business.
        baseUrl: z.string().optional(),
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
    })
    // Refused at SAVE time rather than read leniently later, for `plugins/websearch`'s reason:
    // this is the one moment there is somebody looking at the form to tell. The plugin itself
    // stays lenient, so a row that says something unrecognised by the time it loads costs the
    // default rather than the station's ability to speak.
    //
    // Note what the check sees: the host validates the form as it WILL be, stored secrets
    // overlaid with the submission, so an operator who did not retype their key still passes.
    .refine(config => kindOf(config.providerKind) !== 'openai-compat' || hasText(config.baseUrl), {
        path: ['baseUrl'],
        message: 'An OpenAI-compatible endpoint needs its address, e.g. http://localhost:11434/v1',
    })
    .refine(config => !KEYED_KINDS.includes(kindOf(config.providerKind)) || hasText(config.apiKey), {
        path: ['apiKey'],
        message: 'This provider needs an API key',
    });

const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/** What the form means by its provider field, including the default it leaves unsaid. */
const kindOf = (value: string | undefined): ProviderKind => (isProviderKind(value) ? value : DEFAULT_PROVIDER_KIND);

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
            key: 'reasoningEffort',
            label: 'Reasoning effort',
            type: 'select',
            default: DEFAULT_REASONING_EFFORT,
            options: (Object.keys(REASONING_EFFORTS) as ReasoningEffortSetting[]).map(value => ({ value, label: REASONING_EFFORTS[value] })),
            help: 'How hard a reasoning model should think. Auto forwards whatever the station asked for; the fixed levels override it. A server that answers 400 to the field itself is what Off is for; a live refusal is already handled without asking.',
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
