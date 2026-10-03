import { createSocket } from 'node:dgram';
import multicastDns from 'multicast-dns';
import type { DiscoveredService, DiscoveryQuery } from '@deadair/plugin-sdk';

/** The longest one `host.discover` listens for. Devices answer within a second or two, or not at all. */
export const DISCOVERY_MAX_TIMEOUT_MS = 5_000;

/** How long `host.discover` listens when the plugin does not say. */
export const DISCOVERY_DEFAULT_TIMEOUT_MS = 2_500;

/** The most devices one query answers with. A home has a handful; a flood is a network to stop reading. */
export const DISCOVERY_MAX_RESULTS = 64;

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

/** Looks for devices on the network. The system's own unless a test says otherwise. */
export interface NetworkDiscoverer {
    discover(query: DiscoveryQuery, timeoutMs: number): Promise<DiscoveredService[]>;
    /**
     * Whether discovery has been tried and has never found anything. On a container's bridge
     * network multicast does not reach the station at all, and this is how the host says so once,
     * rather than every plugin reporting no devices as though there were none.
     */
    seesNothing(): boolean;
}

/**
 * The station's one owner of multicast: mDNS on 5353 and SSDP on 1900, opened for the length of a
 * query and closed after it, so no plugin ever binds either port itself.
 *
 * Two plugins asking the same question at once share one query rather than sending two, since a
 * device answers a query once whoever asked it.
 */
export class SystemDiscoverer implements NetworkDiscoverer {
    private readonly inFlight = new Map<string, Promise<DiscoveredService[]>>();
    private browsed = 0;
    private found = false;

    discover(query: DiscoveryQuery, timeoutMs: number): Promise<DiscoveredService[]> {
        const key = query.protocol === 'mdns' ? `mdns:${query.service}` : `ssdp:${query.searchTarget}`;
        const pending = this.inFlight.get(key);
        if (pending !== undefined) return pending;

        const asking = (query.protocol === 'mdns' ? browseMdns(query.service, timeoutMs) : searchSsdp(query.searchTarget, timeoutMs))
            .then(services => {
                this.browsed += 1;
                if (services.length > 0) this.found = true;
                return services;
            })
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, asking);
        return asking;
    }

    seesNothing(): boolean {
        return this.browsed > 0 && !this.found;
    }
}

/**
 * Asks for every instance of an mDNS service type and gathers what answers: PTR for the instance,
 * SRV for its host and port, TXT for its details, A for its address. A device usually sends all four
 * in one answer; when it leaves the address out, the address it answered from stands in.
 */
export function browseMdns(service: string, timeoutMs: number): Promise<DiscoveredService[]> {
    const type = `${service.replace(/\.$/, '')}.local`;

    return new Promise(resolve => {
        let mdns: ReturnType<typeof multicastDns>;
        try {
            mdns = multicastDns();
        } catch {
            resolve([]);
            return;
        }

        const instances = new Set<string>();
        const from = new Map<string, string>();
        const srv = new Map<string, { target: string; port: number }>();
        const txt = new Map<string, Record<string, string>>();
        const addresses = new Map<string, string>();

        mdns.on('response', (packet, rinfo) => {
            for (const record of [...(packet.answers ?? []), ...(packet.additionals ?? [])]) {
                if (record.type === 'PTR' && record.name.toLowerCase() === type.toLowerCase()) {
                    instances.add(record.data);
                    from.set(record.data, rinfo.address);
                } else if (record.type === 'SRV') {
                    srv.set(record.name, { target: record.data.target, port: record.data.port });
                } else if (record.type === 'TXT') {
                    txt.set(record.name, readTxt(record.data));
                } else if (record.type === 'A') {
                    addresses.set(record.name, record.data);
                }
            }
        });
        // A socket error (no multicast route, the port refused) is a network that cannot see
        // anything, which is an empty answer rather than a failure.
        mdns.on('error', () => undefined);

        mdns.query({ questions: [{ name: type, type: 'PTR' }] }, () => undefined);

        setTimeout(() => {
            mdns.destroy();
            const services: DiscoveredService[] = [];
            for (const instance of instances) {
                const where = srv.get(instance);
                const address = (where === undefined ? undefined : addresses.get(where.target)) ?? from.get(instance);
                if (address === undefined) continue;
                const details = txt.get(instance);
                services.push({
                    name: instance.endsWith(`.${type}`) ? instance.slice(0, -type.length - 1) : instance,
                    address,
                    ...(where === undefined ? {} : { port: where.port }),
                    ...(details === undefined || Object.keys(details).length === 0 ? {} : { txt: details }),
                });
            }
            resolve(services.slice(0, DISCOVERY_MAX_RESULTS));
        }, timeoutMs);
    });
}

/** Sends one SSDP M-SEARCH and gathers every answer, one per unique service name. */
export function searchSsdp(searchTarget: string, timeoutMs: number): Promise<DiscoveredService[]> {
    return new Promise(resolve => {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        const found = new Map<string, DiscoveredService>();
        let done = false;
        const finish = (): void => {
            if (done) return;
            done = true;
            try {
                socket.close();
            } catch {
                // Already closed.
            }
            resolve([...found.values()].slice(0, DISCOVERY_MAX_RESULTS));
        };

        socket.on('error', finish);
        socket.on('message', (message, rinfo) => {
            const headers = readSsdpHeaders(message.toString('utf8'));
            if (headers.st !== undefined && headers.st.toLowerCase() !== searchTarget.toLowerCase()) return;
            const name = headers.usn ?? `${rinfo.address}:${headers.location ?? ''}`;
            if (found.has(name)) return;
            found.set(name, {
                name,
                address: rinfo.address,
                ...(headers.location === undefined ? {} : { location: headers.location }),
                ...(headers.server === undefined ? {} : { server: headers.server }),
            });
        });

        socket.bind(0, () => {
            const search = [
                'M-SEARCH * HTTP/1.1',
                `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
                'MAN: "ssdp:discover"',
                `MX: ${Math.max(1, Math.min(3, Math.floor(timeoutMs / 1000)))}`,
                `ST: ${searchTarget}`,
                '',
                '',
            ].join('\r\n');
            socket.send(search, SSDP_PORT, SSDP_ADDRESS, error => {
                if (error) finish();
            });
        });

        setTimeout(finish, timeoutMs);
    });
}

/** The headers of an SSDP answer, lower-cased by name. */
export function readSsdpHeaders(message: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of message.split(/\r?\n/).slice(1)) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return headers;
}

/** A TXT record's strings, `key=value` each, as a record. */
export function readTxt(data: unknown): Record<string, string> {
    const entries = Array.isArray(data) ? data : [data];
    const out: Record<string, string> = {};
    for (const entry of entries) {
        const text = Buffer.isBuffer(entry) ? entry.toString('utf8') : String(entry ?? '');
        const equals = text.indexOf('=');
        if (equals > 0) out[text.slice(0, equals)] = text.slice(equals + 1);
    }
    return out;
}
