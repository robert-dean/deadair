import { z } from 'zod';

/** The pacing knobs, shared by both kinds of entry. */
interface NetworkPermissionPacing {
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
     * bucket share one limiter; the default is the hostname the entry resolves
     * to.
     *
     * For when a published limit covers a service rather than a hostname.
     * `musicbrainz.org` and `*.musicbrainz.org` are two entries against one
     * 1 req/s policy, and without a shared bucket declaring both would quietly
     * buy 2 req/s and get the station blocked.
     */
    bucket?: string;
}

/**
 * One upstream a plugin may reach, named outright.
 *
 * The bare string shorthand means exactly this with no pacing set. Reach for
 * the object form when the upstream publishes a limit of its own: MusicBrainz
 * allows roughly one request per second to anonymous clients, a tenth of what
 * the host would otherwise let through.
 */
export interface NetworkPermissionHost extends NetworkPermissionPacing {
    /**
     * Bare hostname (`api.spotify.com`), no scheme and no path. A leading `*.`
     * marks a wildcard subdomain match (`*.example.com`) and does NOT match the
     * bare apex.
     */
    host: string;
}

/**
 * One upstream the operator names, not the plugin: the hostname comes from one
 * of your own config fields, resolved when the plugin is initialized.
 *
 * For anything self-hosted or mirrored, where there is no hostname to write
 * down at authoring time. A MusicBrainz mirror, a Navidrome server, an internal
 * API: the plugin declares which setting holds the address and the host reads
 * the hostname out of it.
 *
 * The value is read as a URL, or as a bare hostname if it does not look like
 * one. Empty, unparseable, or wildcard-bearing values simply contribute no
 * entry, so an unconfigured plugin is refused exactly as if it had asked for
 * an undeclared host. Because it resolves at init, changing the setting
 * reinitializes the plugin and the new address takes effect with it.
 *
 * ## One setting, several addresses
 *
 * A setting holding SEVERAL addresses contributes one entry each. That is for
 * the plugin whose upstreams are a list the operator pasted rather than one
 * server they run — a reader of feeds — where there is no honest number of
 * `url` fields to offer.
 *
 * The shape is one address per line (a `text` field), or the JSON array a
 * `multiselect` stores. Where a line carries more than the address, the address
 * is its last `|`-separated field, so `world|World news|https://…/feed.xml`
 * resolves to that host: a list wants labels, and fixing where they go keeps
 * the hostnames readable out of the operator's own text instead of out of a
 * plugin's private parser.
 *
 * Every rule above is applied per address rather than to the value as a whole,
 * so one mistyped line costs its own upstream and not the rest, and a wildcard
 * still cannot arrive from data. Repeats collapse: two feeds at one publisher
 * are one entry, or the second would install a limiter that doubles the rate
 * this entry asked to be paced at.
 */
export interface NetworkPermissionFromConfig extends NetworkPermissionPacing {
    /** Key of the config field holding the address, e.g. `baseUrl`. */
    fromConfig: string;
}

/** A hostname at the host's default rate, or an entry that says more. */
export type NetworkPermission = string | NetworkPermissionHost | NetworkPermissionFromConfig;

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
     * Entries are bare hostnames, {@link NetworkPermissionHost} objects when
     * the upstream needs pacing, or {@link NetworkPermissionFromConfig} when
     * the operator is the one who names it. Order matters only for pacing: the
     * first entry a hostname matches supplies its rate and bucket.
     */
    network: NetworkPermission[];

    /** Whether the plugin may use `host.storage` (namespaced key/value state). */
    storage: boolean;

    /** Whether the plugin may use `host.oauth` (redirect URI + token vault). */
    oauth: boolean;

    /**
     * Whether the plugin may use `host.trackFetcher` (lend the station's
     * fetcher a login, get back a URL).
     *
     * Optional, unlike the two above, because almost no plugin wants it: a
     * provider whose audio can be fetched with a URL mints one itself. Making
     * it required would put a `false` in every manifest to disclaim something
     * only one provider has ever needed.
     */
    trackFetcher?: boolean;
}

// Finite and positive: a zero or a NaN would compute a limiter window of
// Infinity, which is a plugin that never gets to make a request.
const pacingShape = {
    ratePerSecond: z.number().positive().finite().optional(),
    bucket: z.string().min(1).optional(),
};

export const networkPermissionSchema: z.ZodType<NetworkPermission> = z.union([
    z.string().min(1),
    z.object({ host: z.string().min(1), ...pacingShape }),
    z.object({ fromConfig: z.string().min(1), ...pacingShape }),
]);

export const pluginPermissionsSchema = z.object({
    network: z.array(networkPermissionSchema),
    storage: z.boolean(),
    oauth: z.boolean(),
    trackFetcher: z.boolean().optional(),
});
