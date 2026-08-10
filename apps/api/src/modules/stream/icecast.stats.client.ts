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
 * endpoint it deprecates — kept, because the deprecated one is what the pinned
 * image serves and will keep serving. Both render the same public stats tree
 * through the same xml2json convention, which is why {@link listenersForMount}
 * reads either without knowing which it got. 2.5's lives under `/admin/`, so
 * unlike the endpoint it replaces it is read as the admin user; see
 * {@link isAdminEndpoint}.
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
 * Whether an endpoint is Icecast's admin namespace, and so has to be asked as
 * the admin user.
 *
 * `/admin/publicstats` publishes only what a listener could discover anyway, but
 * it lives under `/admin/` all the same, where 2.5 decides access by role and the
 * roles Icecast ships deny anonymous. Authenticating is what makes the endpoint
 * work on a default config rather than on one every operator was told to edit.
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
    /** Whether "nothing answered" has already been said, so a poll loop cannot fill the log. */
    private reportedMissing = false;
    /** The same discipline for "the admin endpoint refused us". See {@link noteRefusal}. */
    private reportedDenied = false;

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
            return listenersForMount(body, this.mount);
        }

        this.resolved = undefined;
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
        if (changed) this.logger.info(`icecast: reading the audience from ${endpoint.base}${endpoint.path}`);
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
    const stats = (body as { icestats?: unknown } | undefined)?.icestats;
    return typeof stats === 'object' && stats !== null;
}

/**
 * Pull one mount's listener count out of a stats body, from either endpoint.
 *
 * `icestats.source` is an ARRAY when several mounts are connected and a bare
 * OBJECT when exactly one is, which is the shape most consumers of this document
 * get wrong. Both are handled, and anything else reads as no listeners rather
 * than throwing.
 *
 * A source is matched on its `listenurl` ending in the mount path. Icecast does
 * not report the mount as its own field, and the url is the only place the path
 * appears. With no source connected at all the document has no `source` key,
 * which is `0` and not "unknown": Icecast answered, and it says nobody is there.
 *
 * Exported for tests: this is the whole compatibility boundary with Icecast.
 */
export function listenersForMount(body: unknown, mount: string): number {
    const stats = (body as { icestats?: { source?: unknown } } | undefined)?.icestats;
    if (!stats) return 0;

    const sources = Array.isArray(stats.source) ? stats.source : stats.source === undefined ? [] : [stats.source];

    let total = 0;
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;

        const record = source as { listenurl?: unknown; listeners?: unknown };
        const listenUrl = typeof record.listenurl === 'string' ? record.listenurl : '';
        if (!matchesMount(listenUrl, mount)) continue;

        const listeners = Number(record.listeners);
        if (Number.isFinite(listeners) && listeners > 0) total += listeners;
    }
    return total;
}

/** Whether a `listenurl` names this mount. Tolerant of a mount written with or without its slash. */
function matchesMount(listenUrl: string, mount: string): boolean {
    if (!listenUrl) return false;

    const path = mount.startsWith('/') ? mount : `/${mount}`;
    try {
        return new URL(listenUrl).pathname === path;
    } catch {
        // Not a url Icecast built; fall back to the tail, which is what it always is.
        return listenUrl.endsWith(path);
    }
}
