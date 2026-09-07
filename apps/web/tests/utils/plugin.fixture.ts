import type { PluginDetail, PluginSummary } from '@deadair/sdk';
import { DateTime } from 'luxon';

/** A plausible plugin as the catalogue sees it. Override only what a case is actually about. */
export function pluginSummary(overrides: Partial<PluginSummary> = {}): PluginSummary {
    return {
        id: 'deadair.spotify',
        name: 'Spotify',
        version: '0.0.1',
        capabilities: ['catalog', 'oauth'],
        status: 'active',
        enabled: true,
        // A plugin that is on has necessarily been enabled before, so the default fixture carries
        // the stamp. A case about the FIRST enable overrides it to undefined and says so.
        firstEnabledAt: DateTime.fromISO('2026-08-01T12:00:00.000Z'),
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
