/**
 * The wire format of Icecast's client list, and nothing else.
 *
 * Split out from the client for the reason `icecast.eventfeed.parse.ts` is: this is
 * the compatibility boundary with another project's output, it is the part that will
 * be wrong first, and it can be tested without a socket or a server.
 *
 * What is read is `/admin/listclients.json?mount=…`, measured on 2.5.0 rather than
 * taken from the docs, which describe only the XML form. The JSON is a mechanical
 * rendering of that XML and looks it: a two-element array whose first element names
 * the document and whose second holds `source`, keyed by mount path, each with a
 * `listeners` count and a `listener` array. Three things about it are worth knowing
 * before changing anything here:
 *
 * - `listener` is an ARRAY even for one client, unlike `source` in the stats
 *   document, which collapses to a bare object for one mount. It is absent, not
 *   empty, when nobody is connected.
 * - `id` is a string and `connected` is a number of whole seconds.
 * - Anything the converter has no rule for lands in `unhandled-child` as a raw node
 *   tree (`history` does, today). Nothing here reads it.
 */

/** One client connected to a mount, in the terms the station uses for it. */
export interface IcecastConnection {
    /** Icecast's own id for the connection, unique for the life of the server. */
    id: string;
    /**
     * The address Icecast recorded. A listener's own only where the edge is trusted to
     * say so; see the listen sockets in `stream/icecast.xml.tmpl`.
     */
    address: string;
    /** What the player said it was. Absent when it sent nothing. */
    agent?: string;
    /** How long it has been connected, in milliseconds, at the resolution Icecast keeps (a second). */
    connectedMs: number;
}

/**
 * The clients a listclients document lists for one mount, or `undefined` when the
 * body is not such a document.
 *
 * `undefined` is not an empty room: the empty room is `[]`, which is what a real
 * document for a mount with nobody on it says. A body of some other shape (a
 * proxy's error page, a future version's new envelope) is "could not tell", and
 * the caller reports it as that rather than as nobody listening.
 *
 * A listener entry without an id or an address is dropped rather than invented,
 * so one malformed row costs that row and not the rest of the list.
 */
export function connectionsFromListClients(body: unknown, mount: string): IcecastConnection[] | undefined {
    if (!Array.isArray(body)) return undefined;

    const stats = body.find(part => isRecord(part) && isRecord(part.source)) as { source: Record<string, unknown> } | undefined;
    if (!stats) return undefined;

    const entry = stats.source[mountKey(mount)];
    if (!isRecord(entry)) return undefined;
    if (entry.listener === undefined) return [];
    if (!Array.isArray(entry.listener)) return undefined;

    const connections: IcecastConnection[] = [];
    for (const row of entry.listener) {
        const connection = connectionFrom(row);
        if (connection) connections.push(connection);
    }
    return connections;
}

function connectionFrom(row: unknown): IcecastConnection | undefined {
    if (!isRecord(row)) return undefined;

    const id = typeof row.id === 'number' ? String(row.id) : row.id;
    if (typeof id !== 'string' || !id || typeof row.ip !== 'string' || !row.ip) return undefined;

    const seconds = typeof row.connected === 'number' && Number.isFinite(row.connected) ? Math.max(0, Math.trunc(row.connected)) : 0;
    const agent = typeof row.useragent === 'string' && row.useragent ? row.useragent : undefined;

    return { id, address: row.ip, ...(agent ? { agent } : {}), connectedMs: seconds * 1000 };
}

/** The key Icecast files a mount under, which always has its leading slash. */
function mountKey(mount: string): string {
    return mount.startsWith('/') ? mount : `/${mount}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
