import { PLUGIN_CAPABILITY_LLM, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';
import { isParseableModelList } from './llm.models.js';
import { readModelName } from './llm.names.js';

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
 * Note what this is NOT any more: a choice. Every arm with a credential is built
 * and reachable at once, and which one a generation reaches is read off the
 * MODEL NAME (`llm.names.ts`). This table is now only what each arm is called.
 */
export const PROVIDER_KINDS = { 'openai-compat': 'OpenAI-compatible', anthropic: 'Anthropic', google: 'Google Gemini' } as const;

export type ProviderKind = keyof typeof PROVIDER_KINDS;

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
        reasoningEffort: z.enum(Object.keys(REASONING_EFFORTS) as [ReasoningEffortSetting, ...ReasoningEffortSetting[]]).optional(),
        // Every credential is optional on its own and at least one is required below, because
        // each one configures a DIFFERENT provider and a station may want any combination of
        // them. An address for the OpenAI-compatible arm, a key each for the two that have
        // their own protocol and an address that is not an operator's business.
        //
        // A stale `providerKind` from before this was a combination rather than a choice is
        // simply not declared here, so zod strips it and the next save drops it. Nothing reads
        // it, and a row still carrying one loads exactly as a row without one does.
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        anthropicApiKey: z.string().optional(),
        googleApiKey: z.string().optional(),
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
    // stays lenient, so a row saying something unrecognised by the time it loads costs that arm
    // rather than the station's ability to speak.
    //
    // Note what the check sees: the host validates the form as it WILL be, stored secrets
    // overlaid with the submission, so an operator who did not retype a key still passes.
    //
    // Naming no field, deliberately: the repair is any ONE of three inputs and pointing at a
    // particular one would be arbitrary. It reaches the operator as the form's own banner,
    // which is what the field-routing fix in `plugins.service.ts` was for.
    .refine(config => hasText(config.baseUrl) || hasText(config.anthropicApiKey) || hasText(config.googleApiKey), {
        message: 'Set a server URL, an Anthropic API key or a Gemini API key, whichever you have',
    })
    // A default model naming a provider with no credential is a station that will refuse every
    // generation it does not name a model for, which presents as a DJ that stopped talking. The
    // name is read exactly as `generate` reads it, so the two can never disagree.
    .refine(config => configuresNamedArm(config), {
        path: ['model'],
        message: 'That model names a provider nothing is configured for',
    });

const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/** Whether the arm this form's default model names is one this form also configures. */
function configuresNamedArm(config: { model?: string; baseUrl?: string; anthropicApiKey?: string; googleApiKey?: string }): boolean {
    if (!hasText(config.model)) return true;

    switch (readModelName(config.model).kind) {
        case 'openai-compat':
            return hasText(config.baseUrl);
        case 'anthropic':
            return hasText(config.anthropicApiKey);
        case 'google':
            return hasText(config.googleApiKey);
    }
}

export const llmManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Language model',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_LLM],
    apiVersion: '^1.0.0',
    description:
        'Lets the station ask a model for words, through an OpenAI-compatible endpoint, Anthropic and Gemini — any of them at once. Which provider a request reaches is read off the model name, so one station can write its breaks on a hosted model and do its reading on a local one.',
    permissions: {
        // The OpenAI-compatible arm's address is the operator's, so there is no
        // hostname to write down for it: an unset or unparseable `baseUrl`
        // contributes no entry at all, which refuses the call exactly as an
        // undeclared host would. A native arm's address is not an operator's
        // business, so it is named outright — the same split `plugins/weather`
        // makes between a self-hosted supplier and three named ones.
        //
        // No rate declared on either. The host serializes model calls through one
        // slot, so there is no burst here to pace, and a published limit written
        // down would be a second bound on something already bounded.
        network: [{ fromConfig: 'baseUrl' }, ANTHROPIC_HOST, GOOGLE_HOST],
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
            key: 'baseUrl',
            label: 'Server URL',
            type: 'url',
            // NOT `required`, even though the OpenAI-compatible arm cannot work without it.
            // The console enforces a required field before it will submit the form at all,
            // which would make an operator choosing Anthropic or Gemini fill in an address
            // those arms ignore. The schema's own refine asks for it on the one arm that
            // needs it, which is the same answer in the right place.
            default: DEFAULT_BASE_URL,
            help: 'An OpenAI-compatible server: a local Ollama or vLLM, or OpenAI, Groq, Mistral and OpenRouter by address. Including any /v1. Its models are named plainly, with no prefix.',
        },
        {
            key: 'apiKey',
            label: 'Server API key',
            type: 'secret',
            help: 'For the server URL above. Leave empty for a local server that wants no key.',
        },
        {
            key: 'anthropicApiKey',
            label: 'Anthropic API key',
            type: 'secret',
            help: 'Setting this makes Claude available. Its models are named anthropic:claude-… and every one of them can use tools.',
        },
        {
            key: 'googleApiKey',
            label: 'Gemini API key',
            type: 'secret',
            help: 'Setting this makes Gemini available. Its models are named google:gemini-… and every one of them can use tools.',
        },
        {
            key: 'model',
            label: 'Default model',
            type: 'string',
            help: 'Used whenever the station does not name one, and it decides which provider that is: a plain name is the server URL above, anthropic:… is Claude, google:… is Gemini. Save your credentials first and this lists what they have; anything not listed can still be typed.',
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
            help: 'For the server URL only: which of ITS models can be given tools. No such endpoint reports it and it cannot be guessed from a name, so it is the one thing here you have to know, and a model not ticked is never sent any. Claude and Gemini answer this themselves and are not listed here.',
        },
    ],
    configSchema,
};
