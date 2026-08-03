import { z } from 'zod';

/**
 * What a plugin is allowed to do. Declared up front in the manifest so the
 * host (and the operator installing the plugin) can see the full blast radius
 * before any plugin code runs.
 */
export interface PluginPermissions {
    /**
     * Hostname allowlist for `host.fetch()`: any request to a host not listed
     * here is rejected before it leaves the process.
     *
     * This describes what a plugin says it needs, and it is enforced on every
     * call (and every redirect hop) that goes through `host.fetch`. It is not
     * yet enforced against a plugin that reaches for global `fetch` instead,
     * because the host still imports plugin code into its own realm. Read this
     * field as a disclosure an operator can weigh before installing, not as a
     * containment guarantee.
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
