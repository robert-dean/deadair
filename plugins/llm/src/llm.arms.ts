import type { PluginHost } from '@deadair/plugin-sdk';
import type { ProviderKind } from './llm.manifest.js';
import { anthropicArm } from './anthropic.provider.js';
import { googleArm } from './google.provider.js';
import { openAiCompatibleArm } from './openai.compat.provider.js';
import type { ProviderArm } from './llm.provider.js';

/** One provider, as its row holds it plus the credential the row does not. */
export interface ProviderRow {
    /** The operator's own name for it. This is the qualifier a model name carries. */
    name: string;

    kind: ProviderKind;

    /** The address, for the OpenAI-compatible kind. Empty for the two that are reached where they live. */
    baseUrl: string;

    /** The key, out of the secrets store rather than out of the row. See `readRowSecret`. */
    apiKey?: string;

    /**
     * Headers a gateway in front of the OpenAI-compatible endpoint insists on, out of the secrets
     * store the same way `apiKey` is. Only that kind reads it: the native arms have no header cell.
     */
    headers?: Record<string, string>;
}

/**
 * Every provider the operator has configured, by the name they gave it.
 *
 * Named rows rather than one slot per protocol, and that is the whole shape of this plugin now: a
 * station wants a hosted model for the words listeners hear and a local one for the volume nobody
 * hears, and it may well want two of the same KIND — a local Ollama and Groq are both
 * OpenAI-compatible and are two different providers. A protocol is not a thing you can have two of;
 * a row is.
 *
 * A row missing what its kind needs is skipped rather than built half-configured. The manifest
 * refuses that at save time, so it is reachable here only from a hand-edited config row, and the
 * cost is that one provider rather than the station's ability to speak.
 */
export function buildArms(host: PluginHost, rows: readonly ProviderRow[]): ReadonlyMap<string, ProviderArm> {
    const arms = new Map<string, ProviderArm>();

    for (const row of rows) {
        const name = row.name.trim();
        if (name.length === 0 || arms.has(name)) continue;

        const arm = buildArm(host, row);
        if (arm !== undefined) arms.set(name, arm);
    }

    return arms;
}

/** One row's arm, or nothing when the row lacks what its kind cannot work without. */
function buildArm(host: PluginHost, row: ProviderRow): ProviderArm | undefined {
    switch (row.kind) {
        case 'openai-compat':
            return row.baseUrl.length === 0
                ? undefined
                : openAiCompatibleArm(host, {
                      baseUrl: row.baseUrl,
                      ...(hasKey(row.apiKey) ? { apiKey: row.apiKey } : {}),
                      ...(row.headers === undefined ? {} : { headers: row.headers }),
                  });

        case 'anthropic':
            return hasKey(row.apiKey) ? anthropicArm(host, { apiKey: row.apiKey }) : undefined;

        case 'google':
            return hasKey(row.apiKey) ? googleArm(host, { apiKey: row.apiKey }) : undefined;
    }
}

/**
 * What a row is missing, named to whoever asked for it.
 *
 * Says the credential rather than "not configured", because those are different repairs: one is a
 * cell in the table on this form and the other could be anything.
 */
export function missingCredential(kind: ProviderKind): string {
    return kind === 'openai-compat' ? 'it has no address' : 'it has no API key';
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
