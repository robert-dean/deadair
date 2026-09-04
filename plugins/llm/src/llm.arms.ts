import type { PluginHost } from '@deadair/plugin-sdk';
import type { ProviderKind } from './llm.manifest.js';
import { anthropicArm } from './anthropic.provider.js';
import { googleArm } from './google.provider.js';
import { openAiCompatibleArm } from './openai.compat.provider.js';
import type { ProviderArm } from './llm.provider.js';

/** Everything the arms are built out of, all of it at once. */
export interface ArmCredentials {
    /** The operator's address, already normalized. Empty when unset, which is the OpenAI-compatible arm not being configured. */
    baseUrl: string;

    /** The key for the address above. Absent for a local server that wants none. */
    apiKey?: string;

    /** Anthropic's key. Its presence is what configures that arm; there is no address to give. */
    anthropicApiKey?: string;

    /** Gemini's key, likewise. */
    googleApiKey?: string;
}

/**
 * Every arm the operator has given a credential for, keyed by kind.
 *
 * All of them rather than one, and that is the whole shape of this plugin: a
 * station wants a hosted model for the words listeners hear and a local one for
 * the volume nobody hears, and the only place it can say so is the model name
 * (see `llm.names.ts`). An arm missing from this map is one nothing is
 * configured for, which is an ordinary state rather than a fault — an operator
 * pasting a second key passes through it — and a generation naming a model on
 * that arm is what refuses, with a sentence saying which credential is missing.
 *
 * Empty is legitimate and means nothing is configured at all. The manifest
 * refuses that at SAVE time, so it is reachable here only on a fresh install
 * nobody has filled in yet.
 */
export function buildArms(host: PluginHost, credentials: ArmCredentials): ReadonlyMap<ProviderKind, ProviderArm> {
    const arms = new Map<ProviderKind, ProviderArm>();

    if (credentials.baseUrl.length > 0) {
        arms.set(
            'openai-compat',
            openAiCompatibleArm(host, {
                baseUrl: credentials.baseUrl,
                ...(hasKey(credentials.apiKey) ? { apiKey: credentials.apiKey } : {}),
            }),
        );
    }

    if (hasKey(credentials.anthropicApiKey)) arms.set('anthropic', anthropicArm(host, { apiKey: credentials.anthropicApiKey }));

    if (hasKey(credentials.googleApiKey)) arms.set('google', googleArm(host, { apiKey: credentials.googleApiKey }));

    return arms;
}

/**
 * What is missing for an arm nothing is configured for, named to whoever asked for it.
 *
 * Says the credential rather than "not configured", because those are different
 * repairs: one is a field on this form and the other could be anything.
 */
export function missingCredential(kind: ProviderKind): string {
    switch (kind) {
        case 'openai-compat':
            return 'no server URL is set';

        case 'anthropic':
            return 'no Anthropic API key is set';

        case 'google':
            return 'no Gemini API key is set';
    }
}

/** A key that is actually there, as opposed to one saved blank. */
const hasKey = (apiKey: string | undefined): apiKey is string => apiKey !== undefined && apiKey.trim().length > 0;

/**
 * Addresses that answer the OpenAI-compatible protocol, offered as suggestions on the
 * `baseUrl` field.
 *
 * Half a setup aid and half a piece of documentation. An operator looking at a provider
 * list holding Anthropic and Gemini has every reason to read the absence of OpenAI as a
 * gap; these say what is actually true, which is that OpenAI, Groq, Mistral and
 * OpenRouter are all this arm with a different address in it.
 *
 * Suggestions rather than a closed list, deliberately: the field stays free text, so the
 * container name a compose file uses is still typeable.
 */
export const OPENAI_COMPATIBLE_ADDRESSES: readonly { value: string; label: string }[] = [
    { value: 'http://localhost:11434/v1', label: 'Ollama, local' },
    { value: 'https://api.openai.com/v1', label: 'OpenAI' },
    { value: 'https://api.groq.com/openai/v1', label: 'Groq' },
    { value: 'https://api.mistral.ai/v1', label: 'Mistral' },
    { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
];
