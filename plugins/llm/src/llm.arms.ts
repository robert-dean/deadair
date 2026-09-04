import type { PluginHost } from '@deadair/plugin-sdk';
import type { ProviderKind } from './llm.manifest.js';
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
    }
}

/** What is missing, said to whoever is looking at the form. */
export function unconfiguredMessage(kind: ProviderKind): string {
    switch (kind) {
        case 'openai-compat':
            return 'No server URL set.';
    }
}
