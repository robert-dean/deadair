import { randomUUID } from 'node:crypto';
import { Injectable } from 'injectkit';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';
import type {
    HostFetchInit,
    HostFetchMethod,
    HostFetchResponse,
    HostStreamChunk,
    HostStreamOpen,
    PluginConfigAccess,
    PluginEvents,
    PluginHost,
    PluginLogger,
    PluginManifest,
    PluginOAuth,
    PluginPermissions,
    PluginSecrets,
    PluginStorage,
    PluginTrackFetcher,
} from '@deadair/plugin-sdk';
import { SpotifyShimClient } from '#modules/stream/spotify.shim.client.js';
import { PluginConfigService } from './plugin.config.service.js';
import { invocationRemainingMs, invocationSignal } from './plugin.invocation.deadline.js';
import { PLUGIN_INVOKE_TIMEOUT_MS } from './plugin.invoker.js';
import { PluginLog } from './plugin.log.js';
import { OAUTH_SECRET_FIELD, PLUGIN_OAUTH_SECRET_KEY } from './plugin.oauth.secret.js';
import { PluginStorageRepository } from './plugin.storage.repository.js';

export { PLUGIN_OAUTH_SECRET_KEY, OAUTH_SECRET_FIELD } from './plugin.oauth.secret.js';

/** Requests one plugin may start per {@link PLUGIN_FETCH_WINDOW_SECONDS} before `host.fetch` paces it. */
export const PLUGIN_FETCH_REQUESTS_PER_WINDOW = 10;
export const PLUGIN_FETCH_WINDOW_SECONDS = 1;

/**
 * The wall-clock budget for one `host.fetch`, used when the plugin does not ask
 * for its own. Everything the call does spends from it: waiting for rate-limit
 * headroom, the request itself, a `Retry-After` back-off, and the retry.
 *
 * A plugin may ask for less, or for more up to whatever the invocation it is
 * running inside has left ({@link PLUGIN_INVOKE_TIMEOUT_MS} when there is no
 * invocation to ask). That ceiling is not arbitrary: the call into plugin code
 * is already abandoned by `PluginInvoker` at that deadline, so a fetch budget
 * above it describes time the plugin will never be given.
 */
export const PLUGIN_FETCH_TIMEOUT_MS = 10_000;

/**
 * Largest response body the host will buffer, in bytes. Bodies cross the
 * boundary as one string, so without this an upstream that streams
 * indefinitely is an OOM with extra steps: the deadline bounds how long a body
 * takes to arrive, not how big it is.
 *
 * Generous for the catalog JSON these plugins actually fetch (a 50-track
 * Spotify page is low hundreds of KB), small enough that a runaway body fails
 * fast rather than eating the process.
 */
export const PLUGIN_FETCH_MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * How many server-directed hops a single `host.fetch` will follow before giving
 * up. Redirects are not charged against the plugin's rate limit, so this cap is
 * the only thing bounding a redirect loop.
 */
export const MAX_PLUGIN_FETCH_REDIRECTS = 5;

/**
 * How long one `host.streams.read` waits for the socket to produce anything.
 *
 * A stalled stream is just as effective a hang as a stalled connect, and the
 * open deadline cannot cover it: reads happen in invocations that had not
 * started when the stream was opened. Generous, because it bounds silence rather
 * than total time — an upstream generating audio genuinely does pause.
 */
export const PLUGIN_STREAM_IDLE_TIMEOUT_MS = 30_000;

/**
 * The longest a stream may stay open at all, from `open` to the terminal chunk.
 *
 * The load-bearing bound of the four, and the reason the other three are not
 * enough. A stream is deliberately NOT capped by the invocation that opened it —
 * that is the whole point, since a plugin returns a handle from one call and the
 * host drains it across later ones — so without this, streaming would be a way
 * to escape the per-invocation deadline entirely and hold a socket forever. The
 * deadline is not removed here, it is replaced by a strictly-enforced longer one.
 *
 * Sized above a slow synthesis on CPU rather than above a request, which is what
 * the first caller (speech) actually needs.
 */
export const PLUGIN_STREAM_LIFETIME_MS = 5 * 60_000;

/**
 * Most bytes one stream may carry.
 *
 * Far above {@link PLUGIN_FETCH_MAX_BODY_BYTES} because this is the path that
 * exists for bodies that do not fit in that one, and still a bound: unbounded is
 * how a plugin fills a disk. Comfortably above a long-form audio render at any
 * bitrate anyone would stream.
 */
export const PLUGIN_STREAM_MAX_BYTES = 64 * 1024 * 1024;

/**
 * How many streams one plugin may hold open at once.
 *
 * Not in the protocol specification, and added anyway: the lifetime cap alone
 * bounds a leaked stream to five minutes, which for a plugin opening them in a
 * loop is five minutes of unbounded sockets. Low, because a plugin needing more
 * than a handful of concurrent streams is doing something the byte protocol was
 * not meant for. Only live streams count, so a failed one a plugin has not
 * cleaned up yet cannot wedge it out of opening more.
 */
export const PLUGIN_STREAM_MAX_OPEN = 4;

/**
 * Where the host's own OAuth redirect endpoint lives. Constructor-injected
 * exactly like the loader's options so the factory never touches `AppConfig`.
 */
@Injectable()
export class PluginHostFactoryOptions {
    constructor(readonly baseUrl: string) {}
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Hostname match against one allowlist entry. A leading `*.` matches any
 * subdomain but NOT the bare apex, so `*.example.com` cannot be used to smuggle
 * in `example.com` itself.
 */
const matchesHost = (hostname: string, pattern: string): boolean => {
    const entry = pattern.trim().toLowerCase();
    if (entry.length === 0) return false;
    if (entry.startsWith('*.')) return hostname.endsWith(entry.slice(1)) && hostname.length > entry.length - 1;
    return hostname === entry;
};

/** A manifest allowlist entry, with the shorthand expanded and the defaults filled in. */
interface NetworkEntry {
    pattern: string;
    /** Which limiter this entry draws from. Several entries may name the same one. */
    bucket: string;
    /** Absent means the host default. */
    ratePerSecond?: number;
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
const hostnameFromSetting = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    try {
        const { hostname } = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        const normalized = hostname.toLowerCase();
        return normalized.length > 0 && !normalized.includes('*') ? normalized : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Expands the manifest's allowlist into what the egress path actually needs,
 * reading `fromConfig` entries out of `config`.
 *
 * Done once per host rather than per call: neither the manifest nor the config
 * can change under a running plugin, because a config write reinitializes it
 * and builds a whole new host.
 */
const normalizeNetwork = (network: PluginPermissions['network'], config: Record<string, unknown>): NetworkEntry[] => {
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

        const hostname = hostnameFromSetting(config[entry.fromConfig]);
        if (hostname === undefined) continue;
        entries.push({ pattern: hostname, bucket: entry.bucket ?? hostname, ratePerSecond: entry.ratePerSecond });
    }

    return entries;
};

/** Whether any entry needs the plugin's config read before the allowlist is known. */
const needsConfig = (network: PluginPermissions['network']): boolean =>
    network.some(entry => typeof entry !== 'string' && 'fromConfig' in entry);

/**
 * The limiter shape for a declared rate, capped at the host's ceiling: a plugin
 * may ask to be paced more slowly than the host would, never faster.
 *
 * Under one request per second there are no fractional points to hand out, so
 * the window stretches instead of the allowance shrinking: one request per
 * `ceil(1 / rate)` seconds. Rounding the window up rather than down keeps the
 * effective rate at or under what was asked for, which is the direction that
 * cannot get a station blocked.
 */
const limiterFor = (ratePerSecond: number | undefined): RateLimiterMemory => {
    if (ratePerSecond === undefined) {
        return new RateLimiterMemory({ points: PLUGIN_FETCH_REQUESTS_PER_WINDOW, duration: PLUGIN_FETCH_WINDOW_SECONDS });
    }

    const capped = Math.min(ratePerSecond, PLUGIN_FETCH_REQUESTS_PER_WINDOW / PLUGIN_FETCH_WINDOW_SECONDS);
    if (capped >= 1) return new RateLimiterMemory({ points: Math.floor(capped), duration: 1 });
    return new RateLimiterMemory({ points: 1, duration: Math.ceil(1 / capped) });
};

/** The statuses that carry a `location` worth following. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Dropped when a hop crosses an origin, so a bearer token cannot ride a 302 to a third party. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie'] as const;

/** Dropped when a redirect rewrites the method to GET and discards the body. */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'] as const;

/** Header names are case-insensitive; the plugin's record keys are whatever it typed. */
const withoutHeaders = (headers: Record<string, string>, drop: readonly string[]): Record<string, string> =>
    Object.fromEntries(Object.entries(headers).filter(([key]) => !drop.includes(key.toLowerCase())));

/**
 * Says who is calling, when the plugin has not said so itself.
 *
 * Without this the request goes out under undici's default, which a fair number
 * of APIs refuse outright: MusicBrainz requires a User-Agent that identifies
 * the application, and answers a generic one with a 403. Naming the plugin
 * rather than just the station also means an upstream complaining about traffic
 * can say which plugin to turn off.
 *
 * `baseUrl` is deliberately not in here. Some upstreams want a contact URL, and
 * a plugin whose policy requires one should set the whole header itself (a
 * `contact` config field is the usual shape), because the station's own base
 * URL is frequently an internal or loopback address and does not belong in a
 * header sent to every third party.
 */
const withUserAgent = (headers: Record<string, string>, manifest: PluginManifest): Record<string, string> => {
    if (Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) return headers;
    return { ...headers, 'user-agent': `${manifest.id}/${manifest.version} (deadair)` };
};

/** `Retry-After` is either delta-seconds or an HTTP-date. Unparseable values mean "do not retry". */
const parseRetryAfter = (value: string | undefined, nowMs: number): number | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : seconds * 1000;

    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, date - nowMs);
};

/** A live response, plus the two things about the chain that produced it the response cannot say. */
interface SentResponse {
    response: Response;
    /** The last hop's URL, which is where the response actually came from. */
    url: URL;
    redirected: boolean;
}

/** Everything a `HostFetchResponse` is except its body, which only the caller knows how to read. */
const flattenResponse = (response: Response, url: URL, redirected: boolean): Omit<HostFetchResponse, 'body'> => {
    // `set-cookie` is the one header iteration does not join, so it would
    // otherwise arrive as whichever cookie happened to be last. It gets its own
    // array instead of silently losing the rest.
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        const name = key.toLowerCase();
        if (name !== 'set-cookie') headers[name] = value;
    });

    return {
        status: response.status,
        statusText: response.statusText,
        headers,
        setCookie: response.headers.getSetCookie(),
        ok: response.ok,
        url: url.toString(),
        redirected,
    };
};

/**
 * Let go of a body nobody is going to read.
 *
 * Swallows its own failure on purpose: this is always cleanup on a path that is
 * already returning or already throwing something more interesting, and a cancel
 * that fails because the peer hung up first is the ordinary case rather than
 * news.
 */
const cancelBody = async (response: Response): Promise<void> => {
    await response.body?.cancel().catch(() => {});
};

/**
 * The controller bounding one egress call: the host's own deadline, plus
 * whatever the plugin passed in.
 *
 * A plain timer rather than `AbortSignal.timeout`, because that one's timer is
 * unref'd and invisible to fake timers, so the deadline would be neither
 * reliable nor testable. One controller rather than `AbortSignal.any` for the
 * same reason the timer is explicit: the caller aborts this itself on a
 * transport failure, and a derived signal has no such handle.
 *
 * `dispose` drops the listener as well as the timer. A plugin's own signal is
 * routinely the invocation's, which outlives any single fetch, so leaving one
 * behind per call is a listener leak on a long background job rather than a
 * theoretical one.
 */
const egressController = (deadlineAt: number, external?: AbortSignal): { controller: AbortController; dispose: () => void } => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));

    const onExternalAbort = (): void => controller.abort(external?.reason);
    if (external?.aborted) onExternalAbort();
    else external?.addEventListener('abort', onExternalAbort, { once: true });

    return {
        controller,
        dispose: () => {
            clearTimeout(timer);
            external?.removeEventListener('abort', onExternalAbort);
        },
    };
};

/**
 * Races `work` against an idle timer, failing with `onTimeout` if nothing
 * arrives in time.
 *
 * `work` is left running when the timer wins — there is no way to un-issue a
 * pending `reader.read()` — so its eventual rejection is swallowed here. The
 * caller aborts the stream's controller, which is what actually makes that read
 * reject; without the pre-attached catch that rejection would surface as an
 * unhandled one, on a path that has already reported the failure properly.
 */
const withIdleDeadline = async <T>(work: Promise<T>, idleMs: number, onTimeout: () => Error): Promise<T> => {
    work.catch(() => {});

    let timer: NodeJS.Timeout | undefined;
    const idle = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), idleMs);
    });

    try {
        return await Promise.race([work, idle]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * One open response body, and everything bounding it.
 *
 * Held per plugin instance rather than per invocation, because that asymmetry is
 * the entire reason this protocol exists: a stream is opened inside one call
 * into plugin code and read from later ones.
 */
interface OpenStream {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    /** Aborting this is what actually kills the request behind the stream. */
    controller: AbortController;
    /** Fires {@link PLUGIN_STREAM_LIFETIME_MS}. Cleared when the stream ends any other way. */
    lifetimeTimer: NodeJS.Timeout;
    /** Next chunk number to hand out. */
    seq: number;
    totalBytes: number;
    /**
     * Read off the socket but not handed over, because the caller asked for less
     * than arrived. A small `maxBytes` therefore costs round trips and never
     * bytes.
     */
    pending?: Uint8Array;
    /**
     * Why this stream died. Set instead of dropping the entry, so the next read
     * is told what happened rather than being told the stream never existed.
     */
    failure?: PluginError;
}

/** A body for a response that had none, so a finished stream reads exactly like an empty one. */
const emptyStream = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
        start(controller) {
            controller.close();
        },
    });

/** The failure the lifetime cap records when it fires. */
const lifetimeExpired = (manifest: PluginManifest, lifetimeMs: number): PluginError =>
    new PluginError(`plugin "${manifest.id}" held a stream open for more than ${lifetimeMs}ms`).withCode('timeout');

/**
 * Hands over up to `limit` bytes of what has already been read, keeping any
 * remainder for the next call.
 *
 * The whole reason `maxBytes` costs round trips rather than bytes: a caller that
 * asks for less than the socket produced gets the rest next time instead of
 * losing it.
 */
const takePending = (stream: OpenStream, streamId: string, limit: number | undefined): HostStreamChunk => {
    const available = stream.pending ?? new Uint8Array(0);
    const take = limit === undefined ? available.length : Math.min(limit, available.length);

    const chunk = available.subarray(0, take);
    stream.pending = take < available.length ? available.subarray(take) : undefined;

    return { streamId, seq: stream.seq++, data: Buffer.from(chunk).toString('base64'), done: false };
};

/**
 * Kill a stream and remember why, so the next read is told what happened rather
 * than that the stream never existed.
 *
 * Returns the failure so a caller can `throw failStream(...)` and have the
 * recording and the throwing be one statement, which is what stops the two
 * drifting apart on a path with several exits.
 */
const failStream = (streams: Map<string, OpenStream>, streamId: string, failure: PluginError): PluginError => {
    const stream = streams.get(streamId);
    if (stream === undefined) return failure;

    // First failure wins. A lifetime expiry that fired while a read was parked
    // is the real cause, and the abort landing afterwards is only its echo.
    stream.failure ??= failure;
    clearTimeout(stream.lifetimeTimer);
    stream.pending = undefined;
    stream.controller.abort();
    stream.reader.cancel().catch(() => {});

    return stream.failure;
};

/**
 * Release a stream outright: its timer, its socket, and its entry.
 *
 * Idempotent by construction, because the SDK promises `close` can always be
 * called from a `finally` and will therefore routinely be called on a stream
 * that already ended normally.
 */
const closeStream = (streams: Map<string, OpenStream>, streamId: string): void => {
    const stream = streams.get(streamId);
    if (stream === undefined) return;

    streams.delete(streamId);
    clearTimeout(stream.lifetimeTimer);
    stream.controller.abort();
    stream.reader.cancel().catch(() => {});
};

/** Duck-typed: `rate-limiter-flexible` rejects with a `RateLimiterRes`, not an `Error`. */
const rateLimitWaitMs = (rejection: unknown): number | undefined => {
    if (typeof rejection !== 'object' || rejection === null) return undefined;
    const msBeforeNext = (rejection as { msBeforeNext?: unknown }).msBeforeNext;
    return typeof msBeforeNext === 'number' ? msBeforeNext : undefined;
};

/**
 * Builds the one object a plugin is allowed to touch the outside world through.
 *
 * Everything a plugin could otherwise reach directly (the network, the database,
 * the environment, the encryption key) is behind a method here, and every method
 * is gated on the manifest permission that covers it. So a plugin that goes
 * through its `PluginHost` does exactly what its manifest declared, which is
 * what makes the manifest an honest description of a well-behaved plugin's
 * blast radius.
 *
 * It is not what stops a badly-behaved one. `PluginLoader` imports plugin code
 * into this process with a plain dynamic `import()`, so a plugin that wants
 * global `fetch`, `fs`, or `process.env` has them, and gating the methods here
 * does not take them away. Treat this factory as the reliability and
 * disclosure layer it currently is; containment needs an isolate, and the
 * JSON-safe boundary below is what leaves room for one.
 *
 * Nothing that crosses back to the plugin is anything but JSON-safe: no
 * `Response`, no `Buffer`, no kysely row objects. That keeps the boundary
 * movable behind a subprocess later without touching a signature; see
 * `docs/decisions/plugin-isolation.md` for why a subprocess and not a worker.
 *
 * Failures included. Everything thrown from here is thrown INTO plugin code,
 * so it is a `PluginError` and never a `ServerkitError`: the SDK deliberately
 * does not depend on the server's error framework (see the note atop
 * `plugin.error.ts`), and a plugin catching its own fetch rejection should be
 * branching on `error.code`, not pattern-matching a framework class it should
 * never have been handed. The status each code answers with lives in
 * `plugin.error.http.ts`, which is also what makes it reach the client:
 * `PluginInvoker` funnels every throw through `toPluginError`, and anything
 * that is not already a `PluginError` lands on `internal` and flattens to 500.
 */
@Injectable()
export class PluginHostFactory {
    /**
     * Every stream any plugin currently holds open, by plugin id.
     *
     * Here rather than only in the closure `createHost` builds, because somebody
     * outside the host has to be able to let go of these: a plugin is disposed by
     * `PluginLifecycleManager`, which holds the record and not the host object.
     * See {@link closeStreamsFor}.
     */
    private readonly openStreams = new Map<string, Map<string, OpenStream>>();

    constructor(
        private readonly options: PluginHostFactoryOptions,
        private readonly pluginConfigService: PluginConfigService,
        private readonly pluginStorageRepository: PluginStorageRepository,
        private readonly pluginLog: PluginLog,
        private readonly spotifyShimClient: SpotifyShimClient,
    ) {}

    /** One host per plugin. Cheap: the only per-host state is its rate limiters. */
    createHost(manifest: PluginManifest): PluginHost {
        const logger = this.pluginLog.for(manifest.id);
        const entries = this.networkEntries(manifest, logger);
        // Per bucket, not per plugin: a plugin talking to two upstreams was
        // sharing one allowance between them, which paced it against a limit
        // neither of them published. Built lazily, so a declared-but-unused
        // upstream costs nothing.
        const limiters = new Map<string, RateLimiterMemory>();

        // Per plugin instance, and the reason `closeStreamsFor` exists: these
        // outlive the invocation that opened them, so nothing else would ever
        // close one belonging to a plugin that is being disposed.
        const streams: Map<string, OpenStream> = new Map();
        this.openStreams.set(manifest.id, streams);

        return {
            logger,
            fetch: (url, init) => this.hostFetch(manifest, entries, limiters, logger, url, init),
            streams: {
                open: (url, init) => this.openStream(manifest, entries, limiters, logger, streams, url, init),
                read: (streamId, maxBytes) => this.readStream(manifest, streams, streamId, maxBytes),
                close: async (streamId) => {
                    closeStream(streams, streamId);
                },
            },
            // A getter, not a captured value: the host object outlives every
            // invocation made through it, so it has to read the ambient one at
            // the moment the plugin asks rather than whichever was running when
            // `createHost` was called.
            get signal() {
                return invocationSignal();
            },
            // Never negative: a plugin reading this is deciding whether to
            // start more work, and "-40" and "0" are the same answer to that
            // question. `hostFetch` reads the raw value instead, because it
            // does need to tell "expired" apart from "expiring".
            remainingMs: () => Math.max(0, invocationRemainingMs() ?? PLUGIN_INVOKE_TIMEOUT_MS),
            storage: this.createStorage(manifest),
            secrets: this.createSecrets(manifest),
            config: this.createConfig(manifest),
            oauth: this.createOAuth(manifest),
            events: this.createEvents(manifest, logger),
            trackFetcher: this.createTrackFetcher(manifest),
        };
    }

    /**
     * The allowlist for one host, resolved at most once and then reused.
     *
     * Lazy because a `fromConfig` entry needs a database read, and doing it in
     * `createHost` would put a query in front of every plugin's initialization
     * whether or not it has one. Memoized as the promise rather than the result
     * so concurrent first calls share the one read.
     *
     * Reusing it cannot go stale: `PluginConfigService.getConfig` has no cache,
     * but every write to a plugin's config reinitializes it
     * ({@link PluginLifecycleManager.reinitPlugin}), and that builds a new host
     * with a fresh memo. A manifest with no `fromConfig` entry never reads the
     * database at all.
     */
    private networkEntries(manifest: PluginManifest, logger: PluginLogger): () => Promise<NetworkEntry[]> {
        const declared = manifest.permissions.network;
        if (!needsConfig(declared)) {
            const fixed = normalizeNetwork(declared, {});
            return async () => fixed;
        }

        let resolved: Promise<NetworkEntry[]> | undefined;
        return () => {
            resolved ??= this.pluginConfigService.getConfig(manifest.id).then(config => {
                const entries = normalizeNetwork(declared, config);
                // An entry that resolved to nothing is a setting the operator
                // has not filled in (or filled in wrongly), and the symptom is
                // a `forbidden` per request naming a host they thought they had
                // configured. Say so once, here, where the cause is visible.
                if (entries.length < declared.length) {
                    logger.warn('plugin network entry could not be resolved from config', {
                        declared: declared.length,
                        resolved: entries.length,
                    });
                }
                return entries;
            });
            return resolved;
        };
    }

    private createStorage(manifest: PluginManifest): PluginStorage {
        // `internal`, not `config` or `forbidden`: the manifest is the plugin's
        // own code, so calling a capability it never declared is a bug in the
        // plugin rather than something the operator can fix or the upstream did.
        const guard = (): void => {
            if (!manifest.permissions.storage) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "storage" permission`).withCode('internal');
            }
        };

        return {
            get: async key => {
                guard();
                return this.pluginStorageRepository.get(manifest.id, key);
            },
            set: async (key, value) => {
                guard();
                await this.pluginStorageRepository.set(manifest.id, key, value);
            },
            delete: async key => {
                guard();
                await this.pluginStorageRepository.delete(manifest.id, key);
            },
            list: async prefix => {
                guard();
                return this.pluginStorageRepository.listKeys(manifest.id, prefix);
            },
        };
    }

    /**
     * The station's track fetcher, for the one provider shape that cannot mint a
     * URL of its own: audio that is reachable, but only to a process speaking a
     * protocol the plugin does not.
     *
     * Wired straight to the Spotify shim rather than to a registry of fetchers,
     * because there is exactly one and inventing a lookup for it would describe a
     * generality the station does not have. The SDK's side is general because it
     * is a published contract; this side is a binary in a sibling container.
     *
     * The session the plugin hands over goes to the shim and nowhere else: it is
     * not stored, not logged, and not readable back.
     */
    private createTrackFetcher(manifest: PluginManifest): PluginTrackFetcher {
        // `internal` for the same reason as the storage guard above.
        const guard = (): void => {
            if (!manifest.permissions.trackFetcher) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "trackFetcher" permission`).withCode('internal');
            }
        };

        return {
            serve: async request => {
                guard();
                return this.spotifyShimClient.serve(request.trackId, request.session);
            },
        };
    }

    private createSecrets(manifest: PluginManifest): PluginSecrets {
        return {
            get: async key => {
                const secrets = await this.pluginConfigService.getSecrets(manifest.id);
                return secrets[key];
            },
        };
    }

    private createConfig(manifest: PluginManifest): PluginConfigAccess {
        return {
            get: async () => this.pluginConfigService.getConfig(manifest.id),
        };
    }

    /**
     * The token vault. Tokens are stored as one encrypted secret under
     * {@link PLUGIN_OAUTH_SECRET_KEY}, which means they ride the same encryption
     * path as operator-entered secrets and are just as invisible to the settings
     * read model (which only ever asks about the manifest's own fields).
     */
    private createOAuth(manifest: PluginManifest): PluginOAuth {
        // `internal` for the same reason as the storage guard above.
        const guard = (): void => {
            if (!manifest.permissions.oauth) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "oauth" permission`).withCode('internal');
            }
        };

        return {
            getRedirectUri: async () => {
                guard();
                return `${this.options.baseUrl.replace(/\/+$/, '')}/plugins/${encodeURIComponent(manifest.id)}/oauth/callback`;
            },
            saveTokens: async tokens => {
                guard();
                const flat: Record<string, string> = {};
                for (const [key, value] of Object.entries(tokens ?? {})) {
                    if (typeof value !== 'string') {
                        throw new PluginError(`oauth token "${key}" must be a string`).withCode('internal');
                    }
                    flat[key] = value;
                }
                // This is the hourly token-refresh path. Nothing reinitializes
                // the plugin off this write: it is the plugin's own call, and
                // reloading it here would dispose the instance mid-refresh.
                //
                // Passing the manifest's own fields alongside the reserved one is
                // deliberate: saveConfig rebuilds the whole `config` object from
                // the descriptors it is given, so omitting them would blank the
                // plugin's operator-entered settings on every token refresh.
                await this.pluginConfigService.saveConfig(manifest.id, [...manifest.configFields, OAUTH_SECRET_FIELD], {
                    [PLUGIN_OAUTH_SECRET_KEY]: JSON.stringify(flat),
                });
            },
            getTokens: async () => {
                guard();
                const secrets = await this.pluginConfigService.getSecrets(manifest.id);
                const raw = secrets[PLUGIN_OAUTH_SECRET_KEY];
                if (raw === undefined) return undefined;
                try {
                    const parsed: unknown = JSON.parse(raw);
                    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
                    const tokens: Record<string, string> = {};
                    for (const [key, value] of Object.entries(parsed)) {
                        if (typeof value === 'string') tokens[key] = value;
                    }
                    return tokens;
                } catch {
                    // Corrupt vault reads as "never authorized" rather than as a
                    // hard failure: the plugin's recovery for both is the same.
                    return undefined;
                }
            },
        };
    }

    /** Log-only for now. The seam is typed so a real bus can slot in without a plugin change. */
    private createEvents(manifest: PluginManifest, logger: PluginLogger): PluginEvents {
        return {
            emit: async (event, payload) => {
                logger.info('plugin event', { event, payload });
            },
        };
    }

    /**
     * The sanctioned network egress: the path a plugin is meant to take, and
     * the one every first-party plugin does take.
     *
     * Order matters: the allowlist check happens before anything touches the
     * network stack, so a denied request costs a DNS lookup of exactly zero and
     * leaves an audit line behind.
     *
     * The whole call runs against ONE deadline, and every part of it spends
     * from the same budget: parking for rate-limit headroom, the request, the
     * `Retry-After` back-off, the retry. Separate caps per phase is how a call
     * ends up promising a 10s timeout and taking 40s, and how a limit gets
     * written down that the invoker's own deadline means can never be reached.
     *
     * The ceiling is what the invocation this runs inside has left, not
     * `PLUGIN_INVOKE_TIMEOUT_MS`. That constant is only the invoker's default,
     * and clamping to it was wrong in both directions: a caller that asked for
     * a shorter invocation got a fetch that outlived it and was killed
     * mid-flight, and one that asked for a longer background budget could not
     * spend it. Outside any invocation (a plugin fetching from a timer of its
     * own) there is nothing to inherit, so the constant is the fallback.
     */
    private async hostFetch(
        manifest: PluginManifest,
        networkEntries: () => Promise<NetworkEntry[]>,
        limiters: Map<string, RateLimiterMemory>,
        logger: PluginLogger,
        url: string,
        init?: HostFetchInit,
    ): Promise<HostFetchResponse> {
        const entries = await networkEntries();
        const { url: target, entry } = this.assertAllowed(manifest, entries, logger, url);
        const { deadlineAt, budgetMs } = this.budgetFor(manifest, target, init);

        const { controller, dispose } = egressController(deadlineAt, init?.signal);

        try {
            const sent = await this.sendWithRetry(manifest, entries, limiters, logger, entry, target, init, controller, deadlineAt, budgetMs);

            // Read here rather than inside the chain, because the chain now hands
            // back a live response for `host.streams` to hold on to. The classifier
            // is shared so an over-cap body is still the `upstream` PluginError it
            // was when this was one try block.
            let body: string;
            try {
                body = await this.readBody(sent.response);
            } catch (error) {
                throw this.transportFailure(manifest, target.hostname.toLowerCase(), controller, budgetMs, error);
            }

            return { ...flattenResponse(sent.response, sent.url, sent.redirected), body };
        } finally {
            dispose();
        }
    }

    /**
     * How long one egress call gets, and when it runs out.
     *
     * Shared by `host.fetch` and `host.streams.open` so the two cannot drift on
     * the one number that decides whether a plugin's work fits. For a stream
     * this bounds the OPEN only — connect, headers and the redirect chain — and
     * the reads that follow are bounded by their own idle and lifetime caps,
     * which is the whole reason a stream exists.
     *
     * @throws {PluginError} `timeout` when the invocation is already over.
     *   Issuing the request anyway would spend a round trip on a response nobody
     *   is left to receive, and report it as a transport failure when the truth
     *   is that the call was over.
     */
    private budgetFor(manifest: PluginManifest, target: URL, init: HostFetchInit | undefined): { deadlineAt: number; budgetMs: number } {
        const ceilingMs = invocationRemainingMs() ?? PLUGIN_INVOKE_TIMEOUT_MS;
        if (ceilingMs <= 0) {
            const hostname = target.hostname.toLowerCase();
            throw new PluginError(`plugin "${manifest.id}" fetch to "${hostname}" failed: the call's deadline had already passed`).withCode(
                'timeout',
            );
        }

        const budgetMs = Math.min(init?.timeoutMs ?? PLUGIN_FETCH_TIMEOUT_MS, ceilingMs);
        return { deadlineAt: Date.now() + budgetMs, budgetMs };
    }

    /**
     * The rate limit, the request chain, and one `Retry-After` back-off.
     *
     * Everything both egress paths must agree on, in one place: a stream that
     * paced itself differently from a fetch, or skipped the back-off, would be a
     * second egress policy wearing the first one's manifest.
     *
     * The retry is the server's idea, never ours — one attempt, only on a 429 or
     * 503 that named a delay. Anything more belongs to the plugin, which knows
     * whether the call is idempotent. It applies to opening a stream for the
     * same reason it applies to a fetch: a 429 is a response status and arrives
     * before any body, so there is nothing half-read to unwind. It has no
     * meaning for a `read`, where the body is already flowing.
     */
    private async sendWithRetry(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        limiters: Map<string, RateLimiterMemory>,
        logger: PluginLogger,
        entry: NetworkEntry,
        target: URL,
        init: HostFetchInit | undefined,
        controller: AbortController,
        deadlineAt: number,
        budgetMs: number,
    ): Promise<SentResponse> {
        await this.consumeRateLimit(manifest, limiters, entry, deadlineAt);
        const first = await this.sendRaw(manifest, entries, logger, target, init, controller, budgetMs);

        if (first.response.status !== 429 && first.response.status !== 503) return first;
        const retryAfterMs = parseRetryAfter(first.response.headers.get('retry-after') ?? undefined, Date.now());
        // A back-off longer than what is left would be slept through only to
        // have the retry abandoned on arrival, so the first response is the
        // answer: the plugin gets the 429 and its `Retry-After` to act on.
        if (retryAfterMs === undefined || retryAfterMs >= deadlineAt - Date.now()) return first;

        const hostname = target.hostname.toLowerCase();
        logger.info('plugin fetch backing off on Retry-After', { hostname, status: first.response.status, retryAfterMs });
        // The first answer is being thrown away, so let go of its socket rather
        // than leaving a body dangling until the GC notices.
        await cancelBody(first.response);

        await sleep(retryAfterMs);
        await this.consumeRateLimit(manifest, limiters, entry, deadlineAt);
        return this.sendRaw(manifest, entries, logger, target, init, controller, budgetMs);
    }

    /**
     * Let go of every stream a plugin still holds.
     *
     * Called when a plugin is disposed, so a stream cannot outlive the instance
     * that opened it. That is a backstop for a plugin that crashed or forgot,
     * not the sanctioned way to finish with one: a well-behaved plugin closes in
     * a `finally`, and the lifetime cap catches the rest long before shutdown.
     *
     * Safe to call for a plugin that never opened one, and safe to call twice.
     */
    closeStreamsFor(pluginId: string): void {
        const streams = this.openStreams.get(pluginId);
        this.openStreams.delete(pluginId);
        if (streams === undefined) return;

        for (const streamId of [...streams.keys()]) closeStream(streams, streamId);
    }

    /**
     * Start a request and keep its body open.
     *
     * Everything up to the first byte is an ordinary fetch and goes through the
     * identical path: same allowlist, same per-hop redirect checks, same one
     * rate-limit point, same `Retry-After` back-off. What differs begins after
     * that — the response is registered instead of read, and from here on it is
     * bounded by bytes and by wall-clock rather than by the invocation, which no
     * longer has anything to do with it.
     */
    private async openStream(
        manifest: PluginManifest,
        networkEntries: () => Promise<NetworkEntry[]>,
        limiters: Map<string, RateLimiterMemory>,
        logger: PluginLogger,
        streams: Map<string, OpenStream>,
        url: string,
        init?: HostFetchInit,
    ): Promise<HostStreamOpen> {
        const entries = await networkEntries();
        const { url: target, entry } = this.assertAllowed(manifest, entries, logger, url);

        // Only live streams count. A failed one the plugin has not cleaned up
        // yet is a few bytes of bookkeeping, and counting it would let one dead
        // stream lock a plugin out of opening another.
        const live = [...streams.values()].filter(stream => stream.failure === undefined).length;
        if (live >= PLUGIN_STREAM_MAX_OPEN) {
            logger.warn('plugin stream refused: too many open', { open: live });
            throw new PluginError(
                `plugin "${manifest.id}" already holds ${live} open streams (limit ${PLUGIN_STREAM_MAX_OPEN}); close one first`,
            ).withCode('unavailable');
        }

        const { deadlineAt, budgetMs } = this.budgetFor(manifest, target, init);

        const { controller, dispose } = egressController(deadlineAt, init?.signal);

        let sent: SentResponse;
        try {
            sent = await this.sendWithRetry(manifest, entries, limiters, logger, entry, target, init, controller, deadlineAt, budgetMs);
        } catch (error) {
            // Nothing was registered, so nothing else will ever abort this.
            controller.abort();
            throw error;
        } finally {
            // The open deadline is done with either way. From here the stream's
            // own bounds apply, and leaving the timer armed would abort a
            // perfectly healthy stream mid-read.
            dispose();
        }

        const streamId = randomUUID();
        const flattened = flattenResponse(sent.response, sent.url, sent.redirected);

        // A 204, a HEAD, or an error status the server sent no body with. There
        // is nothing to stream, so the handle is born finished: the plugin still
        // gets the status and headers, and its first read says `done`.
        const body = sent.response.body;
        const lifetimeTimer = setTimeout(() => failStream(streams, streamId, lifetimeExpired(manifest, PLUGIN_STREAM_LIFETIME_MS)), PLUGIN_STREAM_LIFETIME_MS);
        // Nothing is waiting on this timer; without unref a process with an idle
        // stream would refuse to exit for up to the whole lifetime cap.
        lifetimeTimer.unref?.();

        streams.set(streamId, {
            reader: (body ?? emptyStream()).getReader(),
            controller,
            lifetimeTimer,
            seq: 0,
            totalBytes: 0,
        });

        logger.debug('plugin stream opened', { streamId, status: flattened.status, url: flattened.url });

        return {
            streamId,
            status: flattened.status,
            headers: flattened.headers,
            ok: flattened.ok,
            url: flattened.url,
        };
    }

    /**
     * The next chunk of an open stream.
     *
     * Three of the four bounds land here. The idle deadline bounds one read, the
     * byte cap bounds the whole stream, and the lifetime cap has already fired by
     * the time this sees it (as a recorded {@link OpenStream.failure}) rather
     * than being checked on the way past.
     *
     * A stream that ends normally is dropped from the map as its terminal chunk
     * is handed out, so reading past `done` is answered as a stream that does not
     * exist — which is exactly what it is.
     */
    private async readStream(
        manifest: PluginManifest,
        streams: Map<string, OpenStream>,
        streamId: string,
        maxBytes?: number,
    ): Promise<HostStreamChunk> {
        const stream = streams.get(streamId);
        if (stream === undefined) {
            throw new PluginError(`plugin "${manifest.id}" has no open stream "${streamId}"`).withCode('not_found');
        }
        // Recorded by whatever killed it: the lifetime timer, or an earlier read.
        if (stream.failure !== undefined) throw stream.failure;

        const limit = maxBytes !== undefined && Number.isFinite(maxBytes) && maxBytes >= 1 ? Math.floor(maxBytes) : undefined;

        // Left over from a read that asked for less than arrived. No socket
        // involved, so none of the deadlines apply.
        if (stream.pending !== undefined) return takePending(stream, streamId, limit);

        let result: ReadableStreamReadResult<Uint8Array>;
        try {
            result = await withIdleDeadline(stream.reader.read(), PLUGIN_STREAM_IDLE_TIMEOUT_MS, () =>
                new PluginError(
                    `plugin "${manifest.id}" stream "${streamId}" produced nothing for ${PLUGIN_STREAM_IDLE_TIMEOUT_MS}ms`,
                ).withCode('timeout'),
            );
        } catch (error) {
            // The lifetime timer may have fired while this read was parked, in
            // which case its reason is the true one and this is just the abort
            // landing. Prefer whatever was recorded first.
            const failure =
                stream.failure ??
                (isPluginError(error)
                    ? error
                    : new PluginError(`plugin "${manifest.id}" stream "${streamId}" failed: ${errorText(error)}`, { cause: error }).withCode(
                          'upstream',
                      ));
            throw failStream(streams, streamId, failure);
        }

        if (result.done) {
            // Everything is released here, including the map entry: the stream is
            // over, and a plugin's `finally` calling close on it must be a no-op
            // rather than an error.
            closeStream(streams, streamId);
            return { streamId, seq: stream.seq++, done: true };
        }

        stream.totalBytes += result.value.byteLength;
        if (stream.totalBytes > PLUGIN_STREAM_MAX_BYTES) {
            throw failStream(
                streams,
                streamId,
                new PluginError(
                    `plugin "${manifest.id}" stream "${streamId}" is over the ${PLUGIN_STREAM_MAX_BYTES} byte limit`,
                ).withCode('upstream'),
            );
        }

        stream.pending = result.value;
        return takePending(stream, streamId, limit);
    }

    /**
     * The single place the egress policy lives: parseable, http(s), and a
     * hostname the manifest declared. Both the plugin's own URL and every
     * redirect target the server hands back go through here, so an upstream
     * cannot bounce a plugin somewhere its manifest never asked for.
     *
     * `from` is the URL the hop came from: present only for a redirect, where it
     * doubles as the base a relative `location` resolves against. It also
     * decides how the refusal is classified, because who caused it differs:
     * a URL the plugin built is `config` (the operator has a setting to fix, or
     * the plugin has a bug), while a redirect target is `upstream`, since at
     * that point the offending URL is the server's doing rather than bad plugin
     * input. A hostname the manifest never declared is the third case,
     * `forbidden`: the request is refused, but the plugin is healthy and the
     * next call for something it did declare will succeed.
     *
     * Returns the entry that matched as well as the URL, because which one it
     * was decides how the call is paced. First match wins, so a manifest that
     * lists a canonical host before a broader pattern keeps the stricter rate
     * for it.
     */
    private assertAllowed(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        logger: PluginLogger,
        url: string,
        from?: URL,
    ): { url: URL; entry: NetworkEntry } {
        let target: URL;
        try {
            target = new URL(url, from);
        } catch {
            if (from !== undefined) {
                throw new PluginError(
                    `plugin "${manifest.id}" got an unparseable redirect target "${url}" from "${from.hostname.toLowerCase()}"`,
                ).withCode('upstream');
            }
            throw new PluginError(`plugin "${manifest.id}" requested an unparseable URL`).withCode('config');
        }

        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop is not an http(s) URL', {
                    protocol: target.protocol,
                    from: from.hostname.toLowerCase(),
                });
                throw new PluginError(
                    `plugin "${manifest.id}" was redirected by "${from.hostname.toLowerCase()}" to a non-http(s) URL ("${target.protocol}")`,
                ).withCode('upstream');
            }
            throw new PluginError(`plugin "${manifest.id}" may only fetch http(s) URLs, got "${target.protocol}"`).withCode('config');
        }

        const hostname = target.hostname.toLowerCase();
        const matched = entries.find(entry => matchesHost(hostname, entry.pattern));
        if (matched === undefined) {
            const message = `plugin "${manifest.id}" is not allowed to reach "${hostname}"; add it to permissions.network`;
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop hostname not in permissions.network', {
                    hostname,
                    from: from.hostname.toLowerCase(),
                });
                // The plugin asked for an allowlisted host and the server sent
                // it elsewhere, so this is the upstream misbehaving and it
                // counts against the plugin's health as such.
                throw new PluginError(`${message} (redirected there by "${from.hostname.toLowerCase()}")`).withCode('upstream');
            }

            logger.warn('plugin fetch denied: hostname not in permissions.network', { hostname });
            throw new PluginError(message).withCode('forbidden');
        }

        return { url: target, entry: matched };
    }

    /**
     * Waits for headroom rather than failing outright: a plugin that bursts is
     * usually doing something legitimate (a paged catalog walk), and pacing it
     * is friendlier to the upstream API than making the plugin implement its own
     * back-off. Parking is paid for out of the call's budget, so a plugin that
     * is over quota by more time than it has left is rejected instead.
     *
     * The bucket comes from the allowlist entry that matched, so an upstream
     * that publishes a limit gets paced at it and the plugin does not have to
     * carry a pacer of its own.
     */
    private async consumeRateLimit(
        manifest: PluginManifest,
        limiters: Map<string, RateLimiterMemory>,
        entry: NetworkEntry,
        deadlineAt: number,
    ): Promise<void> {
        let limiter = limiters.get(entry.bucket);
        if (limiter === undefined) {
            limiter = limiterFor(entry.ratePerSecond);
            limiters.set(entry.bucket, limiter);
        }

        // The limiter knows exactly how long the wait would have been, so the
        // refusal carries it: `pluginHttpError` turns `retryAfterMs` into a real
        // `Retry-After` header, which is the difference between a client that
        // backs off correctly and one that hammers.
        const rate =
            entry.ratePerSecond === undefined
                ? `${PLUGIN_FETCH_REQUESTS_PER_WINDOW} per ${PLUGIN_FETCH_WINDOW_SECONDS}s`
                : `${entry.ratePerSecond} per second`;
        const overQuota = (waitMs: number): never => {
            throw new PluginError(`plugin "${manifest.id}" is over its fetch rate limit for "${entry.bucket}" (${rate})`)
                .withCode('rate_limited')
                .withRetry(waitMs);
        };

        try {
            await limiter.consume(manifest.id, 1);
            return;
        } catch (rejection) {
            const waitMs = rateLimitWaitMs(rejection);
            if (waitMs === undefined) throw rejection;
            if (waitMs >= deadlineAt - Date.now()) overQuota(waitMs);
            await sleep(waitMs);
        }

        try {
            await limiter.consume(manifest.id, 1);
        } catch (rejection) {
            const waitMs = rateLimitWaitMs(rejection);
            if (waitMs === undefined) throw rejection;
            overQuota(waitMs);
        }
    }

    /**
     * One logical request, including any redirects the server asks for.
     *
     * The chain is followed by hand rather than by `redirect: 'follow'`: undici
     * would happily chase a 302 from an allowlisted API into 169.254.169.254 or
     * a loopback port, and by the time the response came back the request the
     * manifest forbids would already have been made. Following it here means
     * every hop clears {@link PluginHostFactory.assertAllowed} first.
     *
     * The whole chain shares the call's remaining budget. A per-hop timer would
     * let a server multiply the plugin's timeout by the hop cap just by
     * redirecting slowly. `budgetMs` is carried alongside for the timeout
     * message only: what the plugin asked for is what it should be told it
     * exceeded, not whatever fraction of it this attempt was given.
     */
    private async sendRaw(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        logger: PluginLogger,
        target: URL,
        init: HostFetchInit | undefined,
        controller: AbortController,
        budgetMs: number,
    ): Promise<SentResponse> {
        {
            let current = target;
            let method: HostFetchMethod = init?.method ?? 'GET';
            // Set once, outside the hop loop, so every hop in the chain is
            // identified the same way rather than only the first.
            let headers: Record<string, string> = withUserAgent({ ...init?.headers }, manifest);
            let body = init?.body;

            for (let hop = 0; ; hop++) {
                const response = await this.roundTrip(manifest, current, method, headers, body, controller, budgetMs);

                const location = response.headers.get('location') ?? undefined;
                // A 3xx with nothing to follow is just a response; hand it back
                // and let the plugin decide what it means.
                if (!REDIRECT_STATUSES.has(response.status) || location === undefined) return { response, url: current, redirected: hop > 0 };

                // This hop is being left behind either way, so release its socket
                // now. `hostFetch` used to read every hop's body on its way past;
                // handing the live response back means somebody has to say when a
                // body is finished with, and for an abandoned hop that is here.
                await cancelBody(response);

                if (hop >= MAX_PLUGIN_FETCH_REDIRECTS) {
                    const hostname = current.hostname.toLowerCase();
                    logger.warn('plugin fetch denied: too many redirects', { hostname, hops: hop + 1 });
                    throw new PluginError(
                        `plugin "${manifest.id}" fetch to "${hostname}" failed: too many redirects (over ${MAX_PLUGIN_FETCH_REDIRECTS})`,
                    ).withCode('upstream');
                }

                // Hops are checked, but not charged: the redirect cap is what
                // bounds a chain, and spending the plugin's allowance on moves
                // it did not ask for would pace it for the server's choices.
                const { url: next } = this.assertAllowed(manifest, entries, logger, location, current);

                // Method rewriting per the fetch spec: 303 means "go look at
                // this other thing", and 301/302 after a POST is what every
                // client has done since Netscape. 307/308 exist precisely to
                // preserve the method, so they do.
                if ((response.status === 303 && method !== 'HEAD') || ((response.status === 301 || response.status === 302) && method === 'POST')) {
                    method = 'GET';
                    body = undefined;
                    headers = withoutHeaders(headers, BODY_HEADERS);
                }

                // Crossing an origin drops credentials even when the new host is
                // itself allowlisted: being allowed to talk to a host is not the
                // same as being allowed to hand it another host's bearer token.
                if (next.origin !== current.origin) headers = withoutHeaders(headers, CREDENTIAL_HEADERS);

                current = next;
            }
        }
    }

    /** One HTTP round trip, live. Flattening and reading the body are the caller's. */
    private async roundTrip(
        manifest: PluginManifest,
        target: URL,
        method: HostFetchMethod,
        headers: Record<string, string>,
        body: string | undefined,
        controller: AbortController,
        budgetMs: number,
    ): Promise<Response> {
        const hostname = target.hostname.toLowerCase();

        try {
            return await fetch(target, {
                method,
                headers,
                body,
                signal: controller.signal,
                // 'manual', so the allowlist gets a say on every hop; `sendRaw`
                // does the following.
                redirect: 'manual',
            });
        } catch (error) {
            throw this.transportFailure(manifest, hostname, controller, budgetMs, error, { method });
        }
    }

    /**
     * What a failure on the wire means, in the vocabulary a plugin branches on.
     *
     * Shared by the request and the body read, which used to be one try block and
     * are now two calls: the response is handed back live so a stream can hold
     * it, which means the body is read after {@link roundTrip} has returned. A
     * second copy of this classification is how "body over the cap" quietly stops
     * being an `upstream` PluginError and starts being a bare `Error` nothing
     * knows what to do with.
     *
     * A deadline the host imposed and an upstream that could not be reached are
     * different answers (504 vs 502), and a caller deciding whether to retry
     * needs them apart: the timeout may just need a bigger budget, the connection
     * failure will not care.
     */
    private transportFailure(
        manifest: PluginManifest,
        hostname: string,
        controller: AbortController,
        budgetMs: number,
        error: unknown,
        meta: Record<string, unknown> = {},
    ): unknown {
        // Something upstream of here may already have classified itself.
        // Re-wrapping it would relabel a precise failure as a generic transport
        // one and lose the code the caller was meant to branch on.
        if (isPluginError(error)) return error;

        const aborted = controller.signal.aborted;
        const reason = aborted ? `timed out after ${budgetMs}ms` : errorText(error);
        this.pluginLog.for(manifest.id).warn('plugin fetch failed', { hostname, ...meta, error: reason });

        return new PluginError(`plugin "${manifest.id}" fetch to "${hostname}" failed: ${reason}`, { cause: error }).withCode(
            aborted ? 'timeout' : 'upstream',
        );
    }

    /**
     * The body as text, capped at {@link PLUGIN_FETCH_MAX_BODY_BYTES}.
     *
     * Two checks, because either alone is wrong: `content-length` refuses an
     * oversized body before a byte of it is read, and the running count catches
     * a server that understates the header or omits it entirely (chunked
     * encoding, which is exactly what a server streaming forever would use).
     *
     * Read under the caller's deadline, and incrementally: a stalled stream is
     * just as effective a hang as a stalled connect, and a body that only
     * reveals its size as it arrives has to be measured as it arrives.
     *
     * Over-budget cancels the stream rather than aborting the controller. Both
     * kill the connection, but aborting would make {@link roundTrip} report the
     * failure as a timeout, which it is not.
     */
    private async readBody(response: Response): Promise<string> {
        const maxBodyBytes = PLUGIN_FETCH_MAX_BODY_BYTES;
        const tooLarge = (bytes: number): Error => new Error(`response body is ${bytes} bytes, over the ${maxBodyBytes} byte limit`);

        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
            await response.body?.cancel();
            throw tooLarge(declared);
        }

        // 204s and HEAD responses have no stream at all.
        if (response.body === null) return '';

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;

        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            total += value.byteLength;
            if (total > maxBodyBytes) {
                await reader.cancel();
                throw tooLarge(total);
            }
            chunks.push(value);
        }

        return Buffer.concat(chunks).toString('utf8');
    }
}
