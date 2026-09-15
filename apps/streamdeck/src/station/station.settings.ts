/**
 * The plugin's global settings: which station, and the key it asks with.
 *
 * Global rather than per action, for two reasons. Every key on the deck talks to the same station, so
 * asking each one for the address would be asking one question six times. And Elgato keeps an
 * action's settings in plain text inside every profile somebody exports, where the global ones stay on
 * the machine; an API key acts as the account that issued it, so it belongs in the second.
 *
 * A type alias rather than an interface, because the SDK's settings calls take a JSON object and an
 * interface does not satisfy an index signature.
 */
export type StationSettings = {
    /** The station's address as the operator typed it: the same one the console opens at. */
    address?: string;
    /** A key issued in the console under Settings, Security, API keys. */
    apiKey?: string;
};

/** A station the plugin can talk to: both settings present, and the address read. */
export interface Station {
    /** Scheme, host and any path, with no trailing slash. */
    origin: string;
    /** Where the SDK is pointed. The station's edge serves the API under this prefix and strips it. */
    apiBase: string;
    apiKey: string;
}

/** Why what was typed is not an address. */
export type AddressProblem = 'empty' | 'notHttp' | 'malformed';

export type ParsedAddress = { origin: string } | { problem: AddressProblem };

/**
 * Reads what somebody typed as a station's address, by the rules the listener apps use.
 *
 * A bare host gets `https://`, because that is what a station on the internet is; `http://` is kept
 * as typed, because a station on a home network has no certificate and upgrading it silently would
 * leave a key that cannot connect and no reason why. A trailing slash goes, a query and a fragment
 * go, and a path stays, since a station can be mounted under one.
 *
 * One forgiveness the apps do not need: a trailing `/api` is taken off. The console's address is the
 * one to type, but the SDK's documentation names the API root, and an address pasted from there would
 * otherwise become `/api/api` on every request.
 */
export function parseAddress(input: string | undefined): ParsedAddress {
    const trimmed = (input ?? '').trim();
    if (trimmed === '') return { problem: 'empty' };

    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    if (withScheme.slice(withScheme.indexOf('://') + 3).trim() === '') return { problem: 'empty' };

    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return { problem: 'malformed' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { problem: 'notHttp' };
    if (url.hostname === '') return { problem: 'empty' };

    // Built from its parts rather than `url.href`, which would carry a user and password along.
    let path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/api')) path = path.slice(0, -'/api'.length);
    return { origin: `${url.protocol}//${url.host}${path}` };
}

/** The station the settings describe, or `undefined` while either half is missing or unreadable. */
export function stationFrom(settings: StationSettings): Station | undefined {
    const parsed = parseAddress(settings.address);
    const apiKey = settings.apiKey?.trim();
    if (!('origin' in parsed) || !apiKey) return undefined;
    return { origin: parsed.origin, apiBase: `${parsed.origin}/api`, apiKey };
}

/**
 * A key as the console lists it: its first eight characters and an ellipsis.
 *
 * Eight is the length the station stores as a key's hint (ServerKit's `API_KEY_HINT_LENGTH`), which
 * the contract calls enough to recognise a key and far too few to use. So a log line carrying this
 * tells the operator WHICH key without handing it to whoever reads the log, and it matches what the
 * console's list of keys shows beside the same key.
 */
export function keyHint(apiKey: string): string {
    return `${apiKey.trim().slice(0, KEY_HINT_LENGTH)}…`;
}

const KEY_HINT_LENGTH = 8;

/** The settings as a log line may carry them. The only form of the key that ever reaches a log. */
export function redact(settings: StationSettings): string {
    const parsed = parseAddress(settings.address);
    const address = 'origin' in parsed ? parsed.origin : parsed.problem === 'empty' ? 'no address' : 'an address that does not read';
    const apiKey = settings.apiKey?.trim();
    return `${address}, ${apiKey ? `key ${keyHint(apiKey)}` : 'no key'}`;
}
