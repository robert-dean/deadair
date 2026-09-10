/**
 * Whether the whole audience looks like one address, held for the length of this process.
 *
 * `clientAddress` already answers "who called" for the rate limiter, and the same answer is what a
 * second proxy hop breaks: `REAL_IP_FROM` unset (or wrong) behind a tunnel or another reverse proxy
 * makes nginx report `$remote_addr` as ITS OWN address for every caller on the internet, while
 * `X-Forwarded-For` still names the real one a hop further out. That is a fact about the deployment
 * rather than about any one request, so it is answered the way `plugin.selection.ts`'s
 * `reportedDefaults` answers "did this process already say so": module-level memory rather than a
 * table, because nothing about it needs to survive a restart and a row would be one more thing to
 * migrate for a question this cheap.
 *
 * The middleware is a plain factory rather than a DI object (see its own doc), so this is where the
 * state has to live rather than on a service instance.
 */

/** One resolved address, how many requests have looked like it, and when this process last saw one. */
export interface ForwardedHopReading {
    address: string;
    count: number;
    lastSeenAt: string;
}

let reading: { address: string; count: number; lastSeenAt: number } | undefined;

/**
 * A request whose resolved caller was a private/loopback hop naming a different forwarded address.
 *
 * Counted against the RESOLVED address rather than the forwarded one: the resolved address is the
 * one bucket every such request shares, which is the fact worth reporting, while the forwarded
 * address is whichever real caller happened to be behind it that time and would make the count
 * restart on every new visitor.
 */
export function noteSingleHop(address: string, now: number = Date.now()): void {
    reading = { address, count: (reading?.address === address ? reading.count : 0) + 1, lastSeenAt: now };
}

/** The current reading, JSON-safe, or `undefined` where nothing has been noted this process. */
export function readForwardedHop(): ForwardedHopReading | undefined {
    if (reading === undefined) return undefined;

    return { address: reading.address, count: reading.count, lastSeenAt: new Date(reading.lastSeenAt).toISOString() };
}

/** Forget what has been noted. For tests, which must not inherit another test's reading. */
export function resetForwardedHop(): void {
    reading = undefined;
}

/**
 * Whether an address is one nginx could plausibly be reporting as itself rather than as a caller:
 * loopback, or one of the three RFC 1918 private ranges, in either IPv4 or IPv6 form.
 *
 * This is the ONLY gate a single-hop reading is worth trusting on. A resolved address that is
 * already public is a real caller behind a proxy working as intended, and reporting a mismatch there
 * would flag ordinary multi-hop traffic (a client's own stated `X-Forwarded-For`, since the resolved
 * address never came from that header when `TRUST_PROXY` is on and `X-Real-IP` was set) as the fault
 * this exists to catch.
 */
export function isPrivateOrLoopback(address: string): boolean {
    const v4 = ipv4MappedV4(address) ?? address;

    if (isIPv4(v4)) return isPrivateOrLoopbackV4(v4);
    return isPrivateOrLoopbackV6(address);
}

function isIPv4(address: string): boolean {
    const parts = address.split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateOrLoopbackV4(address: string): boolean {
    const octets = address.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];

    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16

    return false;
}

function isPrivateOrLoopbackV6(address: string): boolean {
    const lower = address.toLowerCase();
    if (lower === '::1') return true; // loopback

    // fc00::/7: the first 7 bits are 1111 110, i.e. the first hextet is fc00-fdff.
    const firstHextet = lower.split(':')[0] ?? '';
    if (/^[0-9a-f]{1,4}$/.test(firstHextet)) {
        const value = Number.parseInt(firstHextet, 16);
        if (value >= 0xfc00 && value <= 0xfdff) return true;
    }

    return false;
}

/** The IPv4 address inside an IPv4-mapped IPv6 literal (`::ffff:a.b.c.d`), or `undefined` for anything else. */
function ipv4MappedV4(address: string): string | undefined {
    const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address.trim());
    return match?.[1];
}
