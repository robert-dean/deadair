import { z } from 'zod';

/**
 * What a plugin is allowed to do. Declared up front in the manifest so the
 * host (and the operator installing the plugin) can see the full blast radius
 * before any plugin code runs.
 */
export interface PluginPermissions {
    /**
     * Hostname allowlist for `host.fetch()`. This is the ONLY way a plugin
     * reaches the internet: any request to a host not listed here is rejected
     * by the host before it leaves the process.
     *
     * Entries are bare hostnames (`api.spotify.com`), no scheme and no path.
     * A leading `*.` marks a wildcard subdomain match (`*.example.com`).
     */
    network: string[];

    /** Whether the plugin may use `host.storage` (namespaced key/value state). */
    storage: boolean;

    /** Whether the plugin may use `host.oauth` (redirect URI + token vault). */
    oauth: boolean;
}

export const pluginPermissionsSchema = z.object({
    network: z.array(z.string().min(1)),
    storage: z.boolean(),
    oauth: z.boolean(),
});
