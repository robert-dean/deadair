import { z } from 'zod';

/**
 * One upstream a plugin may reach, and how hard it may lean on it.
 *
 * The bare string is the common case and means "this hostname, at the host's
 * default rate". Reach for the object form when the upstream publishes a limit
 * of its own: MusicBrainz allows roughly one request per second to anonymous
 * clients, which is a tenth of what the host would otherwise let through.
 */
export interface NetworkPermissionEntry {
    /**
     * Bare hostname (`api.spotify.com`), no scheme and no path. A leading `*.`
     * marks a wildcard subdomain match (`*.example.com`) and does NOT match the
     * bare apex.
     */
    host: string;

    /**
     * Requests per second the host will let through to this entry, capped by
     * the host's own ceiling. You can ask to be slower, never faster.
     *
     * Omit it and the host's default applies. Set it and `host.fetch` paces you
     * automatically, parking each call until there is headroom rather than
     * failing it, so there is nothing left for the plugin to implement. The
     * wait is spent from the call's budget, so see `host.remainingMs()` for
     * deciding whether the work still fits.
     */
    ratePerSecond?: number;

    /**
     * Name of the rate-limit bucket this entry draws from. Entries sharing a
     * bucket share one limiter; the default is the entry's own `host`.
     *
     * For when a published limit covers a service rather than a hostname.
     * `musicbrainz.org` and `*.musicbrainz.org` are two entries against one
     * 1 req/s policy, and without a shared bucket declaring both would quietly
     * buy 2 req/s and get the station blocked.
     */
    bucket?: string;
}

/** A hostname at the host's default rate, or an entry that says more. */
export type NetworkPermission = string | NetworkPermissionEntry;

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
     * Entries are bare hostnames, or {@link NetworkPermissionEntry} objects
     * when the upstream needs pacing. Order matters only for pacing: the first
     * entry a hostname matches supplies its rate and bucket.
     */
    network: NetworkPermission[];

    /** Whether the plugin may use `host.storage` (namespaced key/value state). */
    storage: boolean;

    /** Whether the plugin may use `host.oauth` (redirect URI + token vault). */
    oauth: boolean;
}

export const networkPermissionSchema: z.ZodType<NetworkPermission> = z.union([
    z.string().min(1),
    z.object({
        host: z.string().min(1),
        // Finite and positive: a zero or a NaN would compute a limiter window
        // of Infinity, which is a plugin that never gets to make a request.
        ratePerSecond: z.number().positive().finite().optional(),
        bucket: z.string().min(1).optional(),
    }),
]);

export const pluginPermissionsSchema = z.object({
    network: z.array(networkPermissionSchema),
    storage: z.boolean(),
    oauth: z.boolean(),
});
