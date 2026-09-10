import { PLUGIN_CAPABILITY_LLM, parseMultiSelect, parseRows, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import { isParseableModelList } from './llm.models.js';
import { isProviderName, readModelName } from './llm.names.js';

export const PLUGIN_ID = 'deadair.llm';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Anthropic's own address, and it is named here rather than left to the SDK's
 * default on purpose: that SDK reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`
 * out of the environment when it is not told, and a plugin whose upstream and
 * credential can be moved by the container it happens to run in is a plugin whose
 * declared network permission describes something other than what it does.
 *
 * Beside the manifest rather than beside the arm because the manifest is what has
 * to name the hostname, and two spellings of one address is how they drift.
 */
export const ANTHROPIC_HOST = 'api.anthropic.com';
export const ANTHROPIC_BASE_URL = `https://${ANTHROPIC_HOST}/v1`;
export const GOOGLE_HOST = 'generativelanguage.googleapis.com';
export const GOOGLE_BASE_URL = `https://${GOOGLE_HOST}/v1beta`;

/**
 * The providers this plugin can speak to, and what to call each one.
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
 *
 * Note what this is NOT any more: a choice, nor a provider. It is the PROTOCOL a
 * provider is spoken to in, picked per row of the providers table, and a station
 * can have several rows of the same kind — two OpenAI-compatible servers, a local
 * Ollama and a hosted one, told apart by the names the operator gave them. Which
 * row a generation reaches is read off the MODEL NAME (`llm.names.ts`).
 */
export const PROVIDER_KINDS = { 'openai-compat': 'OpenAI-compatible', anthropic: 'Anthropic', google: 'Google Gemini' } as const;

export type ProviderKind = keyof typeof PROVIDER_KINDS;

/** What an operator picked in a row's Kind cell, read leniently. Anything unrecognised is the broad one. */
export function readProviderKind(value: string | undefined): ProviderKind {
    const kind = value?.trim() ?? '';
    return Object.hasOwn(PROVIDER_KINDS, kind) ? (kind as ProviderKind) : 'openai-compat';
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
 * How long a failed listing is trusted before asking that provider again.
 *
 * Listing runs on the same path as a healthy provider's cache, so a dead row
 * should cost one probe per window rather than the full round trip (and its
 * timeout) inside every model slot that asks in the meantime.
 */
export const MODEL_FAILURE_CACHE_MS = 15_000;

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
        reasoningEffort: z.enum(Object.keys(REASONING_EFFORTS) as [ReasoningEffortSetting, ...ReasoningEffortSetting[]]).optional(),
        // The providers, as the JSON string a `list` field is stored as. Every credential in it is
        // a `secret` CELL, so what this sees is the form as it WILL be — the host merges each
        // stored key back into its row before validating (`plugin.config.rows.ts`), which is what
        // lets an operator rename a provider without retyping the key beside it.
        providers: z.string().optional(),
        // Optional, and the reason is a loop the operator would otherwise be stuck in: a provider
        // cannot be tested until it is saved, and its models cannot be learned until it is tested.
        // Requiring a model to save a provider means being asked for a name there is no way to find
        // out. Save, test, read the names, come back. `generate` refuses with `config` if it is
        // still unset by the time something asks for words, which is the right place to notice.
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        // Tolerant on purpose: the ordinary form is the multiselect's JSON array, and the older
        // "name +tools" text is still accepted so an install configured before the field changed keeps
        // its tool support rather than silently losing it.
        models: z.string().optional().refine(isParseableModelList, { message: 'expected a list of models' }),
    })
    // Refused at SAVE time rather than read leniently later, for `plugins/websearch`'s reason: this
    // is the one moment there is somebody looking at the form to tell. The plugin itself stays
    // lenient, so a row that says something unrecognised by the time it loads costs that provider
    // rather than the station's ability to speak.
    //
    // Every one of these names the `providers` field, because that is the table the repair is made
    // in — the console puts a field-routed 422 on the input it names, and there is one input here.
    .refine(config => providerRows(config.providers).length > 0, {
        path: ['providers'],
        message: 'Add a provider: a server address, or an Anthropic or Gemini key',
    })
    .refine(config => providerRows(config.providers).every(row => isProviderName(row.name ?? '')), {
        path: ['providers'],
        message: 'Every provider needs a name, with no spaces and no ":" in it',
    })
    .refine(config => uniqueNames(providerRows(config.providers)), {
        path: ['providers'],
        message: 'Two providers cannot share a name; the name is what a model is addressed by',
    })
    .refine(config => providerRows(config.providers).every(row => hasWhatItNeeds(row)), {
        path: ['providers'],
        message: 'An OpenAI-compatible provider needs an address; Anthropic and Gemini need an API key',
    })
    // A default model naming a provider that is not in the table is a station that will refuse every
    // generation it does not name a model for, which presents as a DJ that stopped talking. Read
    // exactly as `generate` reads it, so the two can never disagree.
    .refine(config => namesAConfiguredProvider(config.model, config.providers), {
        path: ['model'],
        message: 'That model does not name one of your providers. Use provider:model, e.g. ollama:gpt-oss',
    })
    .refine(config => parseMultiSelect(config.models).every(model => namesAConfiguredProvider(model, config.providers)), {
        path: ['models'],
        message: 'A tool-capable model names a provider that is not in the table',
    });

const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/** One provider as the form holds it. Every cell is a string, and `apiKey` is only ever here in memory. */
type ProviderRow = { name?: string; kind?: string; baseUrl?: string; apiKey?: string };

/** The rows, out of the JSON string the list is stored as. */
const providerRows = (value: unknown): ProviderRow[] => parseRows(value) as ProviderRow[];

/** Whether the names in the table can each address exactly one row. */
function uniqueNames(rows: readonly ProviderRow[]): boolean {
    const names = rows.map(row => (row.name ?? '').trim()).filter(name => name.length > 0);
    return new Set(names).size === names.length;
}

/** Whether a row carries the one thing its kind cannot work without. */
function hasWhatItNeeds(row: ProviderRow): boolean {
    return readProviderKind(row.kind) === 'openai-compat' ? hasText(row.baseUrl) : hasText(row.apiKey);
}

/** Whether a qualified model name points at a row of this table. */
function namesAConfiguredProvider(model: string | undefined, providers: unknown): boolean {
    if (!hasText(model)) return true;

    const named = readModelName(model);
    if (named === undefined) return false;

    return providerRows(providers).some(row => (row.name ?? '').trim() === named.provider);
}

export const llmManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Language model',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_LLM],
    apiVersion: '^1.0.0',
    description:
        'Lets the station ask a model for words, through as many providers at once as you care to add: OpenAI-compatible servers, Anthropic and Gemini. Which one a request reaches is read off the model name, so a station can write its breaks on a hosted model and do its reading on a local one.',
    permissions: {
        // An OpenAI-compatible provider's address is the operator's, so there is no
        // hostname to write down for it: the host reads them out of the `url` COLUMN
        // of the providers table (`addressCells`), one entry per row, and a row with
        // an unset or unparseable address contributes none — which refuses the call
        // exactly as an undeclared host would. A native provider's address is not an
        // operator's business, so it is named outright — the same split
        // `plugins/weather` makes between a self-hosted supplier and three named ones.
        //
        // No rate declared on either. The host serializes model calls through one
        // slot, so there is no burst here to pace, and a published limit written
        // down would be a second bound on something already bounded.
        network: [{ fromConfig: 'providers' }, ANTHROPIC_HOST, GOOGLE_HOST],
        // Nothing is kept between calls. A conversation belongs to whoever is
        // having it, and this plugin is the transport rather than a party to it.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'reasoningEffort',
            label: 'Reasoning effort',
            type: 'select',
            default: DEFAULT_REASONING_EFFORT,
            options: (Object.keys(REASONING_EFFORTS) as ReasoningEffortSetting[]).map(value => ({ value, label: REASONING_EFFORTS[value] })),
            help: 'How hard a reasoning model should think, in whatever each provider calls it. Auto forwards whatever the station asked for; the fixed levels override it. A server that answers 400 to the field itself is what Off is for; a live refusal is already handled without asking.',
        },
        {
            key: 'providers',
            label: 'Providers',
            type: 'list',
            placeholder: 'No providers yet.',
            // NOT `required`, even though nothing works without a row. The console enforces a
            // required field before it will submit the form at all, and a table it refuses to
            // submit is a table an operator cannot fix. The schema's own refine says the same
            // thing where it can be read: on the field, in a sentence.
            help: 'Every provider the station can ask for words, and the name you give each one is how a model is addressed: a model on the row called "ollama" is named ollama:gpt-oss. Add as many as you like, including two of the same kind — a local server and a hosted one are two rows. OpenAI, Groq, Mistral and OpenRouter are not missing kinds: they are the OpenAI-compatible kind with their own address, which the Address cell offers.',
            columns: [
                {
                    key: 'name',
                    label: 'Name',
                    type: 'string',
                    required: true,
                    placeholder: 'ollama',
                },
                {
                    key: 'kind',
                    label: 'Kind',
                    type: 'select',
                    options: (Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(value => ({ value, label: PROVIDER_KINDS[value] })),
                    placeholder: 'OpenAI-compatible',
                },
                // Only on the kind that has one. Anthropic and Gemini are reached where they live,
                // so an Address cell on those rows is a question with no answer — and one filled in
                // before a row's Kind was changed would put a host on this plugin's allowlist that
                // it can never call, since the host reads the `url` column of every row.
                //
                // Named rather than "not the native two", because the declaration is an allow-list
                // and there is no other form of it. That parts company with `readProviderKind`,
                // which is LENIENT and reads anything unrecognised as this kind: a `groq` in the
                // Kind cell would run as an OpenAI-compatible provider while its Address cell was
                // hidden. Only a hand-edited config row can be in that state — the cell is a
                // `select` over these keys — and the way out is the Kind cell, which is beside it
                // and always drawn.
                {
                    key: 'baseUrl',
                    label: 'Address',
                    type: 'url',
                    placeholder: 'http://localhost:11434/v1',
                    dependsOn: 'kind',
                    dependsOnValues: ['openai-compat'],
                },
                {
                    key: 'apiKey',
                    label: 'API key',
                    type: 'secret',
                    placeholder: 'For a hosted provider',
                },
            ],
        },
        {
            key: 'model',
            label: 'Default model',
            type: 'string',
            help: 'Used whenever the station does not name one, written as provider:model — the provider being the name you gave it in the table above. Save your providers first and this lists what they have; anything not listed can still be typed.',
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
            help: 'For OpenAI-compatible providers only: which of their models can be given tools. No such endpoint reports it and it cannot be guessed from a name, so it is the one thing here you have to know, and a model not ticked is never sent any. Claude and Gemini answer this themselves and are not listed here.',
        },
    ],
    configSchema,
};
