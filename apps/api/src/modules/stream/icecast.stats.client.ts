import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Reads Icecast's own account of who is connected.
 *
 * Icecast is the one thing that knows: Liquidsoap sees a socket it writes to and
 * nothing about the far end, and the app never touches audio at all.
 *
 * Two endpoints answer with that document, and which one an install has depends
 * on its Icecast rather than on anything the operator chose, so both are spoken
 * here. `/admin/publicstats.json` is 2.5's, and `/status-json.xsl` is the 2.4
 * endpoint it deprecates — kept, because a 2.4 server serves only the latter and
 * will keep serving it.
 *
 * They carry the same FACTS in two different SHAPES, which is the trap: the
 * envelope, the wrapper and the form of `source` all differ, and reading
 * upstream's source suggests otherwise. {@link listenersForMount} handles both,
 * measured against 2.4.4 and 2.5.0 rather than inferred, and it is where anything
 * about either document belongs. 2.5's lives under `/admin/`, so unlike the
 * endpoint it replaces it is read as the admin user; see {@link isAdminEndpoint}.
 *
 * Best-effort throughout. An Icecast that is down, starting, or answering
 * something other than a stats document resolves to `undefined` rather than
 * throwing: the caller is a poll loop, and a stream that is not up is an
 * ordinary state.
 */

/** Both candidates are local; a live Icecast answers in milliseconds and a dead one fails at once. */
const STATS_TIMEOUT_MS = 1500;

/**
 * The endpoints that carry the stats document, in preference order.
 *
 * 2.5's first, so an upgraded station moves off the deprecated endpoint the
 * moment it can rather than when somebody remembers to change this. An Icecast
 * that does not have it answers 401 or 404 in a millisecond on a local socket,
 * and the answer is cached (see {@link IcecastStatsClient.resolved}), so a 2.4
 * install pays that probe once per re-probe and not once per poll.
 */
export const STATS_PATHS = ['/admin/publicstats.json', '/status-json.xsl'] as const;

/** One address to ask: a base that answered, and the path on it that did. */
export interface StatsEndpoint {
    base: string;
    path: string;
}

/**
 * What the last stats document said, beyond the listener count.
 *
 * Both fields exist for `stream.staleness.ts` and are readings of the SERVER
 * rather than of the audience, which is why they are separate from
 * {@link listenersForMount}: a mount with no source and a mount with a source
 * nobody is listening to are both zero listeners, and telling them apart is the
 * whole of the second failure this reading was added for.
 */
export interface IcecastServerReading {
    /** When Icecast started, in unix epoch millis, or `undefined` when it did not say. */
    startedAt?: number;
    /** Whether anything is connected as a source on the watched mount. */
    sourceConnected: boolean;
}

/**
 * Whether an endpoint is Icecast's admin namespace, and so has to be asked as
 * the admin user.
 *
 * `/admin/publicstats` publishes only what a listener could discover anyway, and
 * measured against 2.5.0 it does answer an anonymous request — but it lives under
 * `/admin/` all the same, where 2.5 decides access by role, and a station whose
 * roles are tightened would lose the reading with no way back that is not a code
 * change. So it is asked as the admin user, which costs nothing and cannot be
 * refused by a config the operator is entitled to write. `/admin/eventfeed` is
 * NOT anonymous on the same server, which is the same point made loudly.
 * The deprecated `status-json.xsl` is not under it and never gets the header:
 * sending a password to an endpoint that does not want one is how it ends up in
 * somebody's proxy log.
 */
export const isAdminEndpoint = (path: string): boolean => path.startsWith('/admin/');

/**
 * Where to look, in preference order: the compose service name, then the
 * host-published loopback port.
 *
 * The same two-address problem `LiquidsoapEndpoint` has, for the same reason —
 * the app runs either inside the compose network or on the host against it — and
 * solved the same way, by probing rather than making the operator configure it.
 */
export function statsCandidates(host: string, port: string): string[] {
    const candidates = [`http://${host}:${port}`];
    const loopback = `http://127.0.0.1:${port}`;
    if (!candidates.includes(loopback)) candidates.push(loopback);
    return candidates;
}

/**
 * Every address worth asking, in the order to ask them: each base against each
 * endpoint, with the pair that last answered brought to the front.
 *
 * The resolved pair is moved rather than copied, so a probe that comes back to
 * the front does not leave a duplicate behind it further down the list.
 */
export function statsEndpoints(bases: string[], resolved?: StatsEndpoint): StatsEndpoint[] {
    return resolvedFirst(
        bases.flatMap(base => STATS_PATHS.map(path => ({ base, path }))),
        resolved,
    );
}

/**
 * The pair that last answered at the head of the list, and nowhere else in it.
 *
 * A resolved pair the list does not contain is dropped rather than prepended:
 * the addresses are built from settings and an env override that can both change
 * under a running process, and an endpoint nobody offers any more is not worth a
 * request per poll.
 */
export function resolvedFirst(all: StatsEndpoint[], resolved?: StatsEndpoint): StatsEndpoint[] {
    if (!resolved) return all;

    const rest = all.filter(endpoint => endpoint.base !== resolved.base || endpoint.path !== resolved.path);
    return rest.length === all.length ? all : [resolved, ...rest];
}

/**
 * `ICECAST_STATS_URL` as the endpoints it names.
 *
 * An operator usually points this at an Icecast (a base), and both paths are
 * tried against it exactly as they are against the probed addresses. One who
 * wrote a whole endpoint — a reverse proxy exposing one document at a path of
 * its own choosing — is taken at their word, because there is nothing to probe
 * there and guessing a sibling path would ask for a URL that was never offered.
 */
export function overrideEndpoints(raw: string): StatsEndpoint[] | undefined {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) return undefined;

    for (const path of STATS_PATHS) {
        if (trimmed.endsWith(path)) return [{ base: trimmed.slice(0, -path.length), path }];
    }
    // Some other whole document, named by a proxy that rewrote the path.
    if (/\.(json|xsl|xml)$/i.test(trimmed)) {
        const cut = trimmed.lastIndexOf('/');
        return [{ base: trimmed.slice(0, cut), path: trimmed.slice(cut) }];
    }

    return STATS_PATHS.map(path => ({ base: trimmed, path }));
}

@Injectable()
export class IcecastStatsClient {
    /** The base URL and endpoint that last answered. Cleared when nothing does. */
    private resolved?: StatsEndpoint;
    /** Icecast's host and port, pushed in at boot. See {@link useMount}. */
    private host = 'icecast';
    private port = '8000';
    /** The mount whose listeners are the station's audience. */
    private mount = '/live.mp3';
    /** Icecast's admin password, for the admin endpoint only. Unset until a station has one. */
    private adminPassword?: string;
    /** What the last document said about the server itself. Cleared when nothing answers. */
    private server?: IcecastServerReading;
    /** Whether "nothing answered" has already been said, so a poll loop cannot fill the log. */
    private reportedMissing = false;
    /** The same discipline for "the admin endpoint refused us". See {@link noteRefusal}. */
    private reportedDenied = false;
    /** Told when the endpoint changes. See {@link onResolved}. */
    private readonly resolvedListeners = new Set<() => void>();

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Install the mount, the address it lives at, and the admin password to read
     * the admin endpoint with.
     *
     * Pushed in rather than read per call for the reason the bridge secret is:
     * these are settings behind a scoped repository, and the caller polls every
     * few seconds from a singleton that has no request scope to borrow. The
     * password arrives decrypted, from the same resolved settings the rendered
     * `icecast.xml` was built from, so the two cannot disagree about it.
     */
    useMount(args: { host: string; port: string; mount: string; adminPassword?: string }): void {
        this.host = args.host || this.host;
        this.port = args.port || this.port;
        this.mount = args.mount || this.mount;
        this.adminPassword = args.adminPassword || undefined;
        // The address may have changed with it, so stop trusting the old one, and a
        // station that has just been given a password deserves to be told afresh if
        // this one is refused too.
        this.resolved = undefined;
        this.reportedDenied = false;
    }

    /** The mount being watched, for a caller that has to name it in a log line. */
    mountPath(): string {
        return this.mount;
    }

    /**
     * What the last answered poll said about the server, or `undefined` when the
     * last one was not answered.
     *
     * `undefined` is not a neutral default here and callers must treat it as
     * "no evidence": every reading built on this concludes something is WRONG,
     * and an Icecast that is merely down would otherwise be reported as one
     * running stale config.
     */
    serverReading(): IcecastServerReading | undefined {
        return this.server;
    }

    /**
     * The server this client has actually been talking to, and how to talk to it.
     *
     * For the event feed, which is a second admin endpoint on the same Icecast:
     * this poll is what discovers the address that answers and whether the server
     * is new enough to have an admin API at all, and discovering it twice would be
     * two sets of probes disagreeing about the same server. `undefined` until the
     * poll has resolved one, and `undefined` for a server whose answer came from
     * the deprecated endpoint, which has no feed to read.
     */
    /**
     * Be told when the poll settles on a different endpoint. Returns the
     * unsubscribe.
     *
     * The event feed is the subscriber, and this is what makes it attach on the
     * poll that discovers a 2.5 server rather than on its own retry: the two are
     * asking about the same server, and the poll is the one that finds out. Fired
     * on any change, including to an endpoint with no feed behind it, because
     * "this is a 2.4 now" is news of the same kind.
     */
    onResolved(listener: () => void): () => void {
        this.resolvedListeners.add(listener);
        return () => this.resolvedListeners.delete(listener);
    }

    adminApi(): { base: string; password: string } | undefined {
        if (!this.resolved || !isAdminEndpoint(this.resolved.path) || !this.adminPassword) return undefined;

        return { base: this.resolved.base, password: this.adminPassword };
    }

    /**
     * How many clients are attached to the station's mount, or `undefined` when
     * Icecast did not answer.
     *
     * `undefined` is deliberately not `0`: one means "nobody is listening" and the
     * other means "we do not know", and the audience gate must not take the mount
     * away on the strength of a failed request.
     */
    async listeners(): Promise<number | undefined> {
        for (const endpoint of this.endpoints()) {
            const body = await this.read(endpoint);
            if (body === undefined) continue;

            this.remember(endpoint);
            this.server = serverReadingFrom(body, this.mount);
            return listenersForMount(body, this.mount);
        }

        this.resolved = undefined;
        // Nothing answered, so there is nothing to say about the server either. Dropped
        // rather than kept, because a stale "it started at 12:17" outlives the Icecast it
        // described and would go on accusing a container that has since been restarted.
        this.server = undefined;
        if (!this.reportedMissing) {
            this.reportedMissing = true;
            const asked = this.endpoints().map(endpoint => endpoint.base + endpoint.path);
            this.logger.info(`icecast: no stats on ${asked.join(' or ')} — the audience reads as unknown until it answers`);
        }
        return undefined;
    }

    /** The endpoint that last answered first, then the rest. */
    private endpoints(): StatsEndpoint[] {
        const override = overrideEndpoints(this.config.get('ICECAST_STATS_URL', ''));
        if (override) return resolvedFirst(override, this.resolved);

        return statsEndpoints(statsCandidates(this.host, this.port), this.resolved);
    }

    /**
     * Note the endpoint that answered, and say so the first time it changes.
     *
     * Which one it is tells an operator which Icecast they are actually talking
     * to, which is the thing that will have moved under them after an upgrade,
     * and it is said once rather than every five seconds.
     */
    private remember(endpoint: StatsEndpoint): void {
        const changed = this.resolved?.base !== endpoint.base || this.resolved.path !== endpoint.path;
        this.resolved = endpoint;
        this.reportedMissing = false;
        if (!changed) return;

        this.logger.info(`icecast: reading the audience from ${endpoint.base}${endpoint.path}`);
        for (const listener of this.resolvedListeners) {
            try {
                listener();
            } catch (error) {
                // A subscriber that throws must not stop the poll that found this out.
                this.logger.warn(`icecast: a listener threw on the resolved endpoint (${message(error)})`);
            }
        }
    }

    /** One read of a stats endpoint. `undefined` for anything that is not a stats document. */
    private async read(endpoint: StatsEndpoint): Promise<unknown> {
        try {
            const response = await fetch(`${endpoint.base}${endpoint.path}`, {
                signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
                headers: this.headers(endpoint),
            });
            if (!response.ok) {
                this.noteRefusal(endpoint, response.status);
                return undefined;
            }

            const body = (await response.json()) as unknown;
            // Probing several paths means something other than Icecast can answer one of
            // them with perfectly good JSON — a proxy's error document, an SPA's index.
            // Accepting that would pin `resolved` to an address that reads zero listeners
            // forever, which is silence the gate would never explain.
            return isStatsDocument(body) ? body : undefined;
        } catch {
            // Unresolvable host (the compose name off-network), refused, timed out, or a
            // body that is not JSON. All the same thing here: this address did not answer.
            return undefined;
        }
    }

    /** The admin credentials, on the admin endpoint and nowhere else. */
    private headers(endpoint: StatsEndpoint): Record<string, string> {
        if (!this.adminPassword || !isAdminEndpoint(endpoint.path)) return {};

        return { authorization: `Basic ${Buffer.from(`admin:${this.adminPassword}`).toString('base64')}` };
    }

    /**
     * Say once when the admin endpoint is there but will not answer us.
     *
     * A 401 or 403 is not "Icecast is down" and not "this server is 2.4": it is a
     * server that has the endpoint and disagrees about the password or the role
     * allowed to read it. The poll falls through to the deprecated endpoint and
     * keeps working, so the only cost is that nobody would ever know why the
     * station is still on the old one — hence the line, said once per resolve.
     */
    private noteRefusal(endpoint: StatsEndpoint, status: number): void {
        if (!isAdminEndpoint(endpoint.path) || (status !== 401 && status !== 403) || this.reportedDenied) return;

        this.reportedDenied = true;
        this.logger.info(
            this.adminPassword
                ? `icecast: ${endpoint.base}${endpoint.path} refused the admin password (${status}); falling back to the deprecated stats endpoint`
                : `icecast: ${endpoint.base}${endpoint.path} needs credentials and the station has no admin password; falling back to the deprecated stats endpoint`,
        );
    }
}

/** Whether a parsed body is Icecast's stats document rather than something else that parsed. */
function isStatsDocument(body: unknown): boolean {
    return statsOf(body) !== undefined;
}

/**
 * The stats object itself, out of whichever envelope this endpoint wraps it in.
 *
 * The two endpoints disagree, and NOT in the way reading upstream's source
 * suggested. `status-json.xsl` is `{ icestats: { … } }`. `/admin/publicstats.json`
 * is an ARRAY whose first element is a namespace header (`{ name: 'icestats',
 * ns: … }`) and whose second is the stats with no wrapper at all — measured
 * against Icecast 2.5.0, not inferred.
 *
 * Recognised by content rather than by position: an object carrying `source` or
 * `server_id` is the stats, and anything else in the envelope is not. That is
 * also what keeps the probe honest, since it is the same test that decides
 * whether an endpoint answered with a stats document or with a proxy's error
 * page.
 */
function statsOf(body: unknown): Record<string, unknown> | undefined {
    if (Array.isArray(body)) {
        for (const element of body) {
            const stats = statsOf(element);
            if (stats) return stats;
        }
        return undefined;
    }

    if (typeof body !== 'object' || body === null) return undefined;
    const record = body as Record<string, unknown>;

    // The legacy wrapper, which nests one level deeper.
    if (typeof record.icestats === 'object' && record.icestats !== null) return statsOf(record.icestats) ?? {};

    return 'source' in record || 'server_id' in record ? record : undefined;
}

/**
 * Pull one mount's listener count out of a stats body, from either endpoint.
 *
 * Three shapes for `source`, all real, and this is the whole reason this function
 * is separate and tested:
 *
 * - an ARRAY, when 2.4 has several mounts connected;
 * - a bare OBJECT, when 2.4 has exactly one, which is the shape most consumers of
 *   that document get wrong;
 * - a MAP KEYED BY MOUNT PATH, which is what 2.5's publicstats sends whatever the
 *   number of sources.
 *
 * So a source is matched on its key where it has one and on its `listenurl`
 * otherwise, and anything else reads as no listeners rather than throwing. With
 * no source connected at all the document has no `source` key, which is `0` and
 * not "unknown": Icecast answered, and it says nobody is there.
 *
 * Exported for tests: this is the whole compatibility boundary with Icecast.
 */
export function listenersForMount(body: unknown, mount: string): number {
    const stats = statsOf(body);
    if (!stats) return 0;

    let total = 0;
    for (const [key, source] of sourceEntries(stats.source)) {
        if (!source || typeof source !== 'object') continue;

        const record = source as { listenurl?: unknown; listeners?: unknown };
        const listenUrl = typeof record.listenurl === 'string' ? record.listenurl : '';
        if (!matchesMount(key ?? listenUrl, mount)) continue;

        const listeners = Number(record.listeners);
        if (Number.isFinite(listeners) && listeners > 0) total += listeners;
    }
    return total;
}

/**
 * When Icecast started, and whether the station's mount has a source on it.
 *
 * The start time is the whole of the icecast half of `stream.staleness.ts`:
 * Icecast reads `icecast.xml` once and never again, so a server that started
 * before the file last changed is running credentials the app has replaced, and
 * nothing else it says will ever mention that. `server_start_iso8601` is
 * present on both documents; `server_start` is the human-readable sibling, read
 * only as a fallback because its format is the server's locale rather than a
 * standard.
 *
 * `sourceConnected` is deliberately not `listeners > 0`. A refused source
 * password and a mount nobody is listening to are both zero listeners, and the
 * first is a station that cannot broadcast at all.
 *
 * Exported for tests: this lives on the same compatibility boundary as
 * {@link listenersForMount} and is measured, not inferred.
 */
export function serverReadingFrom(body: unknown, mount: string): IcecastServerReading {
    const stats = statsOf(body) ?? {};
    const started = parseServerStart(stats.server_start_iso8601) ?? parseServerStart(stats.server_start);

    return {
        ...(started === undefined ? {} : { startedAt: started }),
        sourceConnected: sourceEntries(stats.source).some(([key, source]) => {
            if (!source || typeof source !== 'object') return false;

            const listenUrl = (source as { listenurl?: unknown }).listenurl;
            return matchesMount(key ?? (typeof listenUrl === 'string' ? listenUrl : ''), mount);
        }),
    };
}

/** One date field of the stats document as epoch millis, or `undefined` for anything unreadable. */
function parseServerStart(value: unknown): number | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;

    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : undefined;
}

/**
 * The connected sources, as `[mount or undefined, source]` pairs.
 *
 * The map form is told from the single-source form by whether the object looks
 * like a source itself: one carrying `listeners` or `listenurl` IS the source,
 * and one carrying neither is a map of them.
 */
function sourceEntries(source: unknown): [string | undefined, unknown][] {
    if (source === undefined || source === null) return [];
    if (Array.isArray(source)) return source.map(entry => [undefined, entry]);
    if (typeof source !== 'object') return [];

    const record = source as Record<string, unknown>;
    if ('listeners' in record || 'listenurl' in record) return [[undefined, record]];

    return Object.entries(record).map(([mount, entry]) => [mount, entry]);
}

/** Whether a mount key or a `listenurl` names this mount. Tolerant of either written without its slash. */
function matchesMount(nameOrUrl: string, mount: string): boolean {
    if (!nameOrUrl) return false;

    const path = mount.startsWith('/') ? mount : `/${mount}`;
    try {
        return new URL(nameOrUrl).pathname === path;
    } catch {
        // A mount key, or a url Icecast did not build; either way it is the path itself,
        // and the tail is what a path always is.
        return (nameOrUrl.startsWith('/') ? nameOrUrl : `/${nameOrUrl}`) === path || nameOrUrl.endsWith(path);
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
