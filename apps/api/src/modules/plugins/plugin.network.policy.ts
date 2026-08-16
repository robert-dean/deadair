import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * The operator's own answer to "this plugin needs the open web".
 *
 * A manifest's `permissions.network` is written at authoring time, and one shape
 * of plugin cannot be honest that way: a reader of feeds is pointed at addresses
 * the operator pasted, and the pages those feeds LINK to are on hosts nobody
 * knew about when the plugin was written. The station's own feed is the example
 * that produced this — the entries live on `feeds.npr.org` and every story they
 * point at is on `www.npr.org`, so `{ fromConfig: 'feeds' }` resolves to exactly
 * the one hostname that does not hold the news.
 *
 * The alternatives were both worse. A second "article sites" setting makes the
 * operator discover and maintain a list the feed already contains, and a
 * same-site rule in the host would widen every `fromConfig` allowlist by
 * inference off a registrable-domain guess nothing in this app can make
 * correctly. This is the honest version of the same permission: the operator
 * says which plugin, in their own settings, and can see it there afterwards.
 *
 * ## What it is consistent with, and what it costs
 *
 * `docs/decisions/plugin-trust.md`: plugins are trusted code that already reach
 * `fs`, `process.env` and the pg pool, so the allowlist was never containing a
 * hostile plugin and does not start here. What it genuinely buys is DISCLOSURE
 * (a manifest that describes where a plugin goes) and protection of an honest
 * plugin from a hostile upstream. The first is why turning this on is an
 * operator's explicit act with an audit line behind it, and the second is why
 * {@link isPrivateAddress} survives the bypass.
 *
 * Read live rather than captured, so the setting takes effect on the next fetch
 * instead of on the next plugin reload. `AppConfig` is a live view over
 * `deadair.settings` and needs no DI scope, which is what makes that free.
 */

/** The `deadair.settings` key. In `plugins`, which is the group this created. */
export const PLUGIN_NETWORK_KEYS = {
    unrestricted: 'plugins.unrestrictedNetwork',
} as const;

/**
 * Addresses the escape hatch does NOT cover, however it is configured.
 *
 * The one protection worth keeping, and it is not about the plugin. `sendRaw`
 * follows redirects by hand precisely so an allowlisted API cannot bounce an
 * honest plugin into `169.254.169.254` or a loopback port, and "the operator
 * said the open web" is not a reason to hand that back. A station that really
 * does want a plugin talking to a service on its own LAN still says so the way
 * it always could: name the host in the manifest, or in a `fromConfig` setting
 * the operator fills in. This only ever widens the allowlist to the PUBLIC
 * internet.
 *
 * Literal-only, deliberately. A hostname that RESOLVES to a private address is
 * not caught here and cannot be without a resolve-then-connect path this app
 * does not have; what is caught is the shape an upstream actually redirects to.
 */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateAddress(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (LOOPBACK_NAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;

    // IPv6, in the two forms that matter: the loopback itself and the
    // unique-local / link-local prefixes.
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
    // An IPv4 address written as an IPv6 one reaches the same place.
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    if (mapped) return isPrivateAddress(mapped[1]!);

    const octets = IPV4.exec(host);
    if (!octets) return false;

    const [first, second] = [Number(octets[1]), Number(octets[2])];
    if (first === 10 || first === 127 || first === 0) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    // Carrier-grade NAT, which is where a router's own admin interface lives on
    // a fair number of home connections.
    if (first === 100 && second >= 64 && second <= 127) return true;

    return false;
}

@Injectable()
export class PluginNetworkPolicy {
    constructor(private readonly config: AppConfig) {}

    /**
     * Whether the operator has taken this plugin off the allowlist.
     *
     * Matched against the plugin's id, one per line, ignoring blanks and
     * `#` comments — the shape every other multi-line setting in
     * `settings.registry.ts` uses, so an operator who has met one has met this.
     */
    isUnrestricted(pluginId: string): boolean {
        const listed = this.config.get(PLUGIN_NETWORK_KEYS.unrestricted, '');
        if (typeof listed !== 'string' || listed.trim().length === 0) return false;

        const wanted = pluginId.trim().toLowerCase();
        return listed
            .split('\n')
            .map(line => line.trim().toLowerCase())
            .some(line => line.length > 0 && !line.startsWith('#') && line === wanted);
    }
}
