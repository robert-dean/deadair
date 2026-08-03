import type { PluginHost } from './plugin.host.js';

/** Result of a "does this configuration actually work?" probe. */
export interface PluginConnectionResult {
    ok: boolean;
    /** Short operator-facing explanation, shown in the settings UI either way. */
    message?: string;
}

/**
 * The part of a plugin every plugin implements, whatever its kind.
 *
 * The host calls `init` exactly once per instance, before any capability
 * method. `dispose` is called on unload, config change, or shutdown.
 */
export interface PluginLifecycle {
    init(host: PluginHost): Promise<void>;

    /** Called from the settings UI's "Test connection" button. */
    testConnection?(): Promise<PluginConnectionResult>;

    dispose?(): Promise<void>;
}
