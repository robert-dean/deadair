/**
 * How a manifest's `network` list, and the operator's `fromConfig` settings it points at, become the
 * allowlist entries `PluginHostFactory` matches every egress against.
 *
 * Split out of `plugin.host.factory.ts` unchanged. See `packages/plugin-sdk/CLAUDE.md` § "Trust and
 * egress" for why an operator-supplied address is treated differently from a `network.open` one.
 */
import { parseRows } from '@deadair/plugin-sdk';
import type { ConfigField, PluginPermissions } from '@deadair/plugin-sdk';
import { columnAppliesToRow } from '#modules/shared/config.rows.js';

/**
 * Hostname match against one allowlist entry. A leading `*.` matches any
 * subdomain but NOT the bare apex, so `*.example.com` cannot be used to smuggle
 * in `example.com` itself.
 */
export const matchesHost = (hostname: string, pattern: string): boolean => {
    const entry = pattern.trim().toLowerCase();
    if (entry.length === 0) return false;
    if (entry.startsWith('*.')) return hostname.endsWith(entry.slice(1)) && hostname.length > entry.length - 1;
    return hostname === entry;
};

/** A manifest allowlist entry, with the shorthand expanded and the defaults filled in. */
export interface NetworkEntry {
    pattern: string;
    /** Which limiter this entry draws from. Several entries may name the same one. */
    bucket: string;
    /** Absent means the host default. */
    ratePerSecond?: number;
    /**
     * Whether the address came from the operator's config (a `fromConfig` entry) rather than the
     * manifest. Only such an address may be reached by `host.tls` without verifying its certificate:
     * the operator typed in a device on their own network, which is what the exemption is for.
     */
    operator?: true;
}

/**
 * The hostname an operator-supplied address points at, or `undefined` when the
 * setting cannot name one.
 *
 * Accepts both a URL and a bare hostname, because either is a reasonable thing
 * for an operator to have typed into a "server address" field. Anything that
 * does not resolve to a plain hostname contributes no entry at all rather than
 * a permissive one: a blank setting must not widen the allowlist, and a
 * wildcard must never arrive from data, only from a manifest an operator read
 * before installing.
 */
const hostnameFromSetting = (value: unknown): string | undefined => addressFromSetting(value)?.hostname.toLowerCase();

/**
 * The address an operator-supplied value names, parsed, or `undefined` under every refusal
 * {@link hostnameFromSetting} documents. The one parser both it and {@link operatorHosts} read, so
 * the allowlist and the art fetch cannot disagree about what a setting names.
 */
const addressFromSetting = (value: unknown): URL | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    try {
        const address = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        const hostname = address.hostname.toLowerCase();
        return hostname.length > 0 && !hostname.includes('*') ? address : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Every hostname one setting names, which is usually one and is sometimes many.
 *
 * A `fromConfig` entry was written for a setting holding one address — a
 * mirror, a self-hosted server — and one shape of plugin cannot express itself
 * that way: a reader of feeds is pointed at a LIST the operator pasted, and
 * there is no honest number of `url` fields to give it. So a value holding
 * several addresses contributes several entries, whether it arrived as the
 * lines of a `text` field, as the JSON array a `multiselect` stores, or as the
 * ROWS of a `list` — which is the only one of the three whose addresses cannot
 * be found by looking at the value alone, and is why the field descriptor is
 * passed in. See {@link addressCells}.
 *
 * Nothing about a single-address setting changes, deliberately: one line in,
 * one entry out, and every refusal {@link hostnameFromSetting} makes is made
 * per address rather than over the whole value. So one mistyped line among five
 * costs its own feed and not the other four — the same treatment the clock
 * bands and the break templates give a line an operator got wrong — and a
 * wildcard still cannot arrive from data.
 *
 * Deduplicated because two feeds at one publisher are two lines and one host,
 * and a repeated pattern would otherwise install a second limiter that quietly
 * doubles the rate the entry asked to be paced at.
 */
const hostnamesFromSetting = (value: unknown, field?: ConfigField): string[] => [
    ...new Set(rawAddresses(value, field).flatMap(one => hostnameFromSetting(one) ?? [])),
];

/** The unparsed addresses in one setting, by the three encodings {@link hostnamesFromSetting} names. */
const rawAddresses = (value: unknown, field?: ConfigField): unknown[] =>
    field?.type === 'list'
        ? addressCells(value, field)
        : Array.isArray(value)
          ? value
          : typeof value === 'string'
            ? readAddressLines(value)
            : [value];

/**
 * The addresses in a `list` field: the cells of the columns that declared themselves `url`.
 *
 * By the COLUMN rather than by looking at every cell, which is the one thing that cannot be
 * loosened here: {@link hostnameFromSetting} accepts a bare hostname, so a cell holding a category
 * called `sport` would install `sport` on the allowlist — harmless in itself, and exactly the kind
 * of quiet widening this whole path exists to refuse. A field that declared no `url` column names
 * no addresses, which is a plugin asking for an allowlist it cannot fill rather than a permissive
 * default.
 *
 * `parseRows` is the SDK's own reader, so the host and the plugin read one encoding: a list the
 * plugin serves and the allowlist refuses is a plugin that looks broken rather than a row somebody
 * got wrong.
 *
 * And by the ROW as well as by the column, wherever a `url` column declared which rows it applies
 * to. A providers table holding one row reached at an address the operator runs and another reached
 * where its vendor lives has an address cell that means nothing on the second, and an address left
 * in it — typed before the row's kind was changed, or hand-edited into `plugin_configs` — would
 * otherwise put a host on the allowlist that the plugin can never call. The console declines to
 * send such a cell, but the console is not what decides this: a row can reach here without ever
 * having been through it.
 */
const addressCells = (value: unknown, field: ConfigField): unknown[] => {
    const columns = field.columns ?? [];
    const urls = columns.filter(column => column.type === 'url');

    return parseRows(value).flatMap(row => urls.filter(column => columnAppliesToRow(column, columns, row)).map(column => row[column.key]));
};

/**
 * The addresses in a multi-line setting: one per line, and the address is the
 * last `|`-separated field of its line.
 *
 * That format is the HOST's, not any plugin's, which is the whole point of it
 * being here. A list of addresses is rarely just addresses — an operator wants
 * to name the things they pasted — so a plugin will invent somewhere to put a
 * label whether or not this makes room for one. Fixing the shape means the
 * hostnames an entry resolves to are readable from the operator's own text by
 * anything, rather than being whatever a plugin's private line parser decided.
 *
 * Split on newlines and nothing else. A comma and a space are both legal inside
 * a URL, and splitting on either would turn one address into two hostnames that
 * reach nothing — silently, since a request to a host the allowlist does not
 * hold is refused rather than reported back to the form.
 */
const readAddressLines = (value: string): string[] =>
    value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.slice(line.lastIndexOf('|') + 1).trim());

/**
 * Expands the manifest's allowlist into what the egress path actually needs,
 * reading `fromConfig` entries out of `config`.
 *
 * Done once per host rather than per call: neither the manifest nor the config
 * can change under a running plugin, because a config write reinitializes it
 * and builds a whole new host.
 */
export const normalizeNetwork = (
    network: PluginPermissions['network'],
    config: Record<string, unknown>,
    fields: ConfigField[] = [],
): NetworkEntry[] => {
    const entries: NetworkEntry[] = [];

    for (const entry of network) {
        if (typeof entry === 'string') {
            entries.push({ pattern: entry, bucket: entry });
            continue;
        }

        if ('host' in entry) {
            entries.push({ pattern: entry.host, bucket: entry.bucket ?? entry.host, ratePerSecond: entry.ratePerSecond });
            continue;
        }

        // One address or twenty, the same loop: a setting that names several
        // contributes several entries, and one that names none contributes
        // nothing at all. Where the entry declared a `bucket`, every hostname
        // out of it shares that one limiter — which is what an operator's list
        // of feeds actually wants, since the rate being paced is this station's
        // own and not any one publisher's.
        for (const hostname of hostnamesFromSetting(
            config[entry.fromConfig],
            fields.find(field => field.key === entry.fromConfig),
        )) {
            entries.push({ pattern: hostname, bucket: entry.bucket ?? hostname, ratePerSecond: entry.ratePerSecond, operator: true });
        }
    }

    return entries;
};

/**
 * The `host` (hostname, and port where one was given) of every address a manifest's `fromConfig`
 * entries name in one config: the servers the OPERATOR pointed this plugin at.
 *
 * For callers outside the host that need the question `PluginHostFactory.assertAllowed` answers for a plugin's
 * own fetches (is this somewhere the operator chose, and so allowed to be on the LAN?) about a URL
 * that is merely data. `ArtCacheService` is the one: a Navidrome cover URL is on the operator's own
 * server, and every other art URL is whatever an upstream said.
 *
 * The host rather than the hostname, which is the one place this is narrower than the allowlist. A
 * plugin reaching its configured hostname is the plugin doing its job; an art URL naming that
 * hostname is data, and a Navidrome at `http://localhost:4533` vouches for port 4533 and not for
 * whatever else answers on that machine. Manifest literals are not included: a host the plugin's
 * author wrote down is public, and nothing is gained by exempting it from a check it passes.
 */
export const operatorHosts = (network: PluginPermissions['network'], config: Record<string, unknown>, fields: ConfigField[] = []): string[] => {
    const hosts = network.flatMap(entry =>
        typeof entry !== 'string' && 'fromConfig' in entry
            ? rawAddresses(
                  config[entry.fromConfig],
                  fields.find(field => field.key === entry.fromConfig),
              ).flatMap(one => addressFromSetting(one)?.host.toLowerCase() ?? [])
            : [],
    );

    return [...new Set(hosts)];
};

/** Whether any entry needs the plugin's config read before the allowlist is known. */
export const needsConfig = (network: PluginPermissions['network']): boolean =>
    network.some(entry => typeof entry !== 'string' && 'fromConfig' in entry);
