import type { PluginDetail, PluginSummary } from '@deadair/sdk';

/** A plausible plugin as the catalogue sees it. Override only what a case is actually about. */
export function pluginSummary(overrides: Partial<PluginSummary> = {}): PluginSummary {
    return {
        id: 'deadair.spotify',
        name: 'Spotify',
        version: '0.0.1',
        kind: 'music-provider',
        capabilities: ['catalog', 'oauth'],
        status: 'active',
        enabled: true,
        description: 'Search Spotify and pull tracks into the rotation.',
        configFields: [{ key: 'clientId', label: 'Client ID', type: 'string', required: true }],
        secretsConfigured: {},
        ...overrides,
    };
}

export function pluginDetail(overrides: Partial<PluginDetail> = {}): PluginDetail {
    return {
        ...pluginSummary(overrides),
        config: {},
        logLevel: 'info',
        ...overrides,
    };
}
