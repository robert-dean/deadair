import type { PluginHost } from '@deadair/plugin-sdk';
import type { ProviderKind } from './llm.manifest.js';
import { anthropicArm } from './anthropic.provider.js';
import { googleArm } from './google.provider.js';
import { openAiCompatibleArm } from './openai.compat.provider.js';
import type { ProviderArm } from './llm.provider.js';

/** Everything the arms are built out of, whichever one is being built. */
export interface ArmCredentials {
    /** The operator's address, already normalized. Empty when unset, which only the OpenAI-compatible arm minds. */
    baseUrl: string;

    /** The stored key. Absent for a local server that wants none, required by every hosted arm. */
    apiKey?: string;
}

/**
 * The arm for a kind, or nothing when this kind cannot work with what is configured.
 *
 * `undefined` rather than a throw, and the difference matters: a plugin that
 * will not load is a station that cannot be configured through its own console,
 * whereas an unbuilt arm is a plugin that loads, says what is missing in
 * `testConnection`, and refuses a generation with `config`. An operator saving
 * an address before a key, or a key before an address, passes through this state
 * on the way in.
 *
 * The switch is exhaustive over {@link ProviderKind} and stays that way: `tsc`
 * fails on a kind added to the manifest with nothing built for it here.
 */
export function buildArm(kind: ProviderKind, host: PluginHost, credentials: ArmCredentials): ProviderArm | undefined {
    switch (kind) {
        case 'openai-compat':
            return credentials.baseUrl.length === 0
                ? undefined
                : openAiCompatibleArm(host, {
                      baseUrl: credentials.baseUrl,
                      ...(credentials.apiKey === undefined ? {} : { apiKey: credentials.apiKey }),
                  });

        case 'anthropic':
            return hasKey(credentials.apiKey) ? anthropicArm(host, { apiKey: credentials.apiKey }) : undefined;

        case 'google':
            return hasKey(credentials.apiKey) ? googleArm(host, { apiKey: credentials.apiKey }) : undefined;
    }
}

/** What is missing, said to whoever is looking at the form. */
export function unconfiguredMessage(kind: ProviderKind): string {
    switch (kind) {
        case 'openai-compat':
            return 'No server URL set.';

        case 'anthropic':
        case 'google':
            return 'No API key set.';
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
