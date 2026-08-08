import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Reads Icecast's own account of who is connected.
 *
 * `GET /status-json.xsl` is the one thing that knows: Liquidsoap sees a socket it
 * writes to and nothing about the far end, and the app never touches audio at
 * all. It needs no credentials — it says exactly what any listener can already
 * discover by connecting — so `stream.adminPassword` stays out of this path
 * entirely.
 *
 * Best-effort throughout. An Icecast that is down, starting, or answering
 * something other than JSON resolves to `undefined` rather than throwing: the
 * caller is a poll loop, and a stream that is not up is an ordinary state.
 */

/** Both candidates are local; a live Icecast answers in milliseconds and a dead one fails at once. */
const STATS_TIMEOUT_MS = 1500;

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

@Injectable()
export class IcecastStatsClient {
    /** The base URL that last answered, without a trailing slash. */
    private resolved?: string;
    /** Icecast's host and port, pushed in at boot. See {@link useMount}. */
    private host = 'icecast';
    private port = '8000';
    /** The mount whose listeners are the station's audience. */
    private mount = '/live.mp3';
    /** Whether "nothing answered" has already been said, so a poll loop cannot fill the log. */
    private reportedMissing = false;

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Install the mount and the address it lives at.
     *
     * Pushed in rather than read per call for the reason the bridge secret is:
     * these are settings behind a scoped repository, and the caller polls every
     * few seconds from a singleton that has no request scope to borrow.
     */
    useMount(args: { host: string; port: string; mount: string }): void {
        this.host = args.host || this.host;
        this.port = args.port || this.port;
        this.mount = args.mount || this.mount;
        // The address may have changed with it, so stop trusting the old one.
        this.resolved = undefined;
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
        for (const base of this.candidates()) {
            const body = await this.read(base);
            if (body === undefined) continue;

            this.resolved = base;
            this.reportedMissing = false;
            return listenersForMount(body, this.mount);
        }

        this.resolved = undefined;
        if (!this.reportedMissing) {
            this.reportedMissing = true;
            this.logger.info(`icecast: no stats on ${this.candidates().join(' or ')} — the audience reads as unknown until it answers`);
        }
        return undefined;
    }

    /** The resolved address first, then the rest. A working one is tried again before anything else. */
    private candidates(): string[] {
        const override = this.override();
        if (override) return [override];

        const all = statsCandidates(this.host, this.port);
        return this.resolved ? [this.resolved, ...all.filter(candidate => candidate !== this.resolved)] : all;
    }

    /** One read of `status-json.xsl`. `undefined` for anything that is not usable JSON. */
    private async read(base: string): Promise<unknown> {
        try {
            const response = await fetch(`${base}/status-json.xsl`, { signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
            if (!response.ok) return undefined;
            return (await response.json()) as unknown;
        } catch {
            // Unresolvable host (the compose name off-network), refused, timed out, or a
            // body that is not JSON. All the same thing here: this address did not answer.
            return undefined;
        }
    }

    /** `ICECAST_STATS_URL`, normalised. `undefined` when unset. */
    private override(): string | undefined {
        const raw = this.config.get('ICECAST_STATS_URL', '');
        return raw ? raw.replace(/\/+$/, '') : undefined;
    }
}

/**
 * Pull one mount's listener count out of a `status-json.xsl` body.
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
