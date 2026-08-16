/**
 * The capabilities a plugin may ask the operator for, and what each one opens up.
 *
 * The vocabulary is the HOST's, which is the load-bearing half. A capability only means anything
 * where this app enforces it, so an id nothing here recognises is ignored rather than becoming a row
 * an operator can allow: a permission for a door that does not exist is worse than no permission,
 * because it reads on the settings page as though it were protecting something.
 *
 * ## What earns an entry
 *
 * Not everything a plugin declares. `permissions.storage`, `oauth` and `trackFetcher` stay plain
 * manifest booleans, because **a declaration is disclosure and a grant is a decision**: the host
 * holds a plugin to what it declared without asking anybody, and only a capability wide enough that
 * a person should weigh it per install belongs here. The line matters in one direction in
 * particular — a table long enough to skim is a table that trains an operator to click Allow without
 * reading it, at which point the whole mechanism has been spent.
 *
 * ## Each entry names where it is enforced
 *
 * `enforcedAt` is documentation rather than wiring, and it exists because the failure it prevents is
 * silent: a capability with no guard behind it grants nothing and forbids nothing, and nothing about
 * the row on the page would say so. Anything added here comes with the guard in the same commit.
 */

/** One capability the host publishes. Ids are dotted and stable: they are stored in a row. */
export interface HostCapability {
    id: string;
    /** What the console calls it, in a table cell. */
    label: string;
    /** What allowing it actually opens up, in the station's own words rather than the plugin's. */
    describes: string;
    /** Where the host checks it, named so a reader can go and look. */
    enforcedAt: string;
}

/**
 * Reaching hosts nobody named in advance.
 *
 * The first capability, and the one the mechanism was built around. A manifest's `network` allowlist
 * is written at authoring time or resolved from a setting, and one shape of plugin cannot be honest
 * either way: a reader of feeds is pointed at addresses the operator pasted, and the PAGES those
 * feeds link to are on hosts only the feed knows.
 */
export const NETWORK_OPEN = 'network.open';

export const HOST_CAPABILITIES: readonly HostCapability[] = [
    {
        id: NETWORK_OPEN,
        label: 'The open web',
        // Says what survives the grant as well as what it removes. The private-address guard is not
        // a footnote: it is the difference between "this plugin may read the public internet" and
        // "this plugin may reach your router", and an operator deciding needs the first sentence to
        // be true.
        describes:
            'Lets this plugin fetch any public address, not only the ones its manifest names or that you gave it. Private, loopback and link-local addresses stay refused either way, and every new host it reaches is written to its log the first time.',
        enforcedAt: 'PluginHostFactory.assertAllowed',
    },
];

/** One capability by id, or `undefined` for an id this host does not publish. */
export const capabilityOf = (id: string): HostCapability | undefined => HOST_CAPABILITIES.find(capability => capability.id === id);

/**
 * Addresses that are refused whatever the operator granted.
 *
 * Lives beside the capability registry rather than inside the host factory because it is a property
 * of the `network.open` capability itself: allowing it means the PUBLIC internet, and this is the
 * sentence that makes that true. `HOST_CAPABILITIES` says so to the operator in the same words.
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

/** What an operator can have said about one. Absent from the store is a third state; see `PluginGrantsService`. */
export type GrantDecision = 'allowed' | 'denied';
