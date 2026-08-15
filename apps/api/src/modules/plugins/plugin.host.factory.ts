import { Container, Injectable } from 'injectkit';
import { RateLimiterMemory, RateLimiterQueue, RateLimiterQueueError } from 'rate-limiter-flexible';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';
import type {
    HostFetchInit,
    HostFetchMethod,
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
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';

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
 * How many server-directed hops a single `host.fetch` will follow before giving
 * up. Redirects are not charged against the plugin's rate limit, so this cap is
 * the only thing bounding a redirect loop.
 */
export const MAX_PLUGIN_FETCH_REDIRECTS = 5;

/**
 * How long a response body may produce nothing before the host gives up on it.
 *
 * A stalled body is just as effective a hang as a stalled connect, and the
 * fetch deadline cannot cover it: that one ends when the response arrives, and
 * a large body is read long afterwards, sometimes from later invocations
 * entirely. Generous, because it bounds silence rather than total time, and an
 * upstream generating audio genuinely does pause.
 */
export const PLUGIN_BODY_IDLE_TIMEOUT_MS = 30_000;

/**
 * The longest a response body may stay open at all, from the moment the
 * response is handed to the plugin to its last byte.
 *
 * The load-bearing bound of the three, and the reason the other two are not
 * enough. Reading a body is deliberately NOT capped by the invocation that
 * started the request, because a legitimate large body outlives it, so without
 * this a body would be a way to escape the per-invocation deadline entirely and
 * hold a socket forever. The deadline is not removed, it is replaced by a
 * strictly-enforced longer one.
 *
 * Sized above a slow synthesis on CPU rather than above a request, which is
 * what the caller that needs it (speech) actually does.
 */
export const PLUGIN_BODY_LIFETIME_MS = 5 * 60_000;

/**
 * Most bytes one response body may carry.
 *
 * One cap rather than the two this used to have. There was a 5 MiB ceiling on
 * `host.fetch`, which buffered every body into a string, and a 64 MiB one on
 * the separate byte protocol for bodies that could not fit in it. That protocol
 * is gone: a plugin now decides for itself whether to buffer, with
 * `response.text()`, so the only place a single cap can sit is the wire.
 *
 * Unbounded is how a plugin fills a disk, and this is comfortably above a
 * long-form audio render at any bitrate anyone would stream.
 */
export const PLUGIN_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Where the host's own OAuth redirect endpoint lives. Constructor-injected
 * exactly like the loader's options so the factory never touches `AppConfig`.
 */
@Injectable()
export class PluginHostFactoryOptions {
    constructor(readonly baseUrl: string) {}
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * How many calls may be waiting on one bucket before the next is refused outright.
 *
 * A queue is a promise to serve everyone eventually, and without a cap that promise outlives any
 * upstream worth making it to: a plugin bursting against a one-per-second limit would accumulate
 * waiters faster than they drain and each would sit there until its own deadline expired. Well
 * above what the station's own subsystems can produce at once, so it only ever catches a runaway.
 */
const MAX_RATE_LIMIT_QUEUE = 200;

/**
 * One upstream's pacing: the limiter that counts, and the FIFO queue that waits on it.
 *
 * Paired rather than kept apart because both are needed per call — the queue admits the waiters in
 * order, and the limiter is what can still say how long a refusal should back off for, which the
 * queue's own error does not carry.
 */
interface RateBucket {
    limiter: RateLimiterMemory;
    queue: RateLimiterQueue;
}

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
 * Every hostname one setting names, which is usually one and is sometimes many.
 *
 * A `fromConfig` entry was written for a setting holding one address — a
 * mirror, a self-hosted server — and one shape of plugin cannot express itself
 * that way: a reader of feeds is pointed at a LIST the operator pasted, and
 * there is no honest number of `url` fields to give it. So a value holding
 * several addresses contributes several entries, whether it arrived as the
 * lines of a `text` field or as the JSON array a `multiselect` stores.
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
const hostnamesFromSetting = (value: unknown): string[] => {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? readAddressLines(value) : [value];

    return [...new Set(raw.flatMap(one => hostnameFromSetting(one) ?? []))];
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

        // One address or twenty, the same loop: a setting that names several
        // contributes several entries, and one that names none contributes
        // nothing at all. Where the entry declared a `bucket`, every hostname
        // out of it shares that one limiter — which is what an operator's list
        // of feeds actually wants, since the rate being paced is this station's
        // own and not any one publisher's.
        for (const hostname of hostnamesFromSetting(config[entry.fromConfig])) {
            entries.push({ pattern: hostname, bucket: entry.bucket ?? hostname, ratePerSecond: entry.ratePerSecond });
        }
    }

    return entries;
};

/** Whether any entry needs the plugin's config read before the allowlist is known. */
const needsConfig = (network: PluginPermissions['network']): boolean => network.some(entry => typeof entry !== 'string' && 'fromConfig' in entry);

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
 * Releases whatever a response body is still holding. Registered per plugin so
 * a body cannot outlive the instance that opened it.
 */
type BodyRelease = (failure?: PluginError) => void;

/** The failure the lifetime cap records when it fires. */
const lifetimeExpired = (manifest: PluginManifest): PluginError =>
    new PluginError(`plugin "${manifest.id}" held a response body open for more than ${PLUGIN_BODY_LIFETIME_MS}ms`).withCode('timeout');

/** The failure the idle deadline records. */
const idleExpired = (manifest: PluginManifest, url: string): PluginError =>
    new PluginError(`plugin "${manifest.id}" response body from ${url} produced nothing for ${PLUGIN_BODY_IDLE_TIMEOUT_MS}ms`).withCode('timeout');

/**
 * The plugin's response body, bounded.
 *
 * This is what is left of the byte protocol. The handles, the sequence numbers,
 * the base64 and the stream table are gone with it, because a `ReadableStream`
 * already is a pull-based stream with backpressure and a cancel. What did NOT
 * go is the reason any of it existed: a body is read outside the deadline that
 * fetched it, so something has to stop it being an unbounded socket. That is
 * the three caps here.
 *
 * Failures reject the read rather than ending the stream quietly, so a caller
 * that ignores errors truncates loudly instead of silently. The first failure
 * wins: a lifetime expiry that fired while a read was parked is the real cause,
 * and the abort landing afterwards is only its echo.
 */
const guardBody = (
    manifest: PluginManifest,
    url: string,
    source: ReadableStream<Uint8Array>,
    controller: AbortController,
    open: Set<BodyRelease>,
): ReadableStream<Uint8Array> => {
    const reader = source.getReader();
    let total = 0;
    let failure: PluginError | undefined;
    let released = false;
    let out: ReadableStreamDefaultController<Uint8Array> | undefined;

    const release: BodyRelease = reason => {
        failure ??= reason;
        if (released) return;
        released = true;
        clearTimeout(lifetimeTimer);
        open.delete(release);
        // Both, because they answer different halves: cancelling the reader
        // ends this stream, and aborting the controller ends the request behind
        // it. Without the abort a cancelled body leaves the socket to time out
        // on its own.
        controller.abort();
        reader.cancel().catch(() => {});

        // Errored rather than merely left to fail on the next pull. A stream
        // keeps a chunk queued ahead of its consumer, so without this a body
        // killed by the lifetime cap or by a dispose hands over one more stale
        // chunk first and only then reports what happened.
        if (failure !== undefined) {
            try {
                out?.error(failure);
            } catch {
                // Already closed or errored, which is not news on a path whose
                // whole job is to make sure it ends up that way.
            }
        }
    };

    // Declared after `release` and referenced from inside it, which is safe
    // because nothing calls `release` until this line has run.
    const lifetimeTimer = setTimeout(() => release(lifetimeExpired(manifest)), PLUGIN_BODY_LIFETIME_MS);
    // Nothing is waiting on this timer; without unref a process holding an idle
    // body would refuse to exit for up to the whole lifetime cap.
    lifetimeTimer.unref?.();
    open.add(release);

    return new ReadableStream<Uint8Array>({
        start(controller) {
            out = controller;
        },
        async pull(controller) {
            // Recorded by whatever killed it: the lifetime timer, or a dispose.
            if (failure !== undefined) throw failure;

            let result: ReadableStreamReadResult<Uint8Array>;
            try {
                result = await withIdleDeadline(reader.read(), PLUGIN_BODY_IDLE_TIMEOUT_MS, () => idleExpired(manifest, url));
            } catch (error) {
                const thrown = isPluginError(error)
                    ? error
                    : new PluginError(`plugin "${manifest.id}" response body from ${url} failed: ${errorText(error)}`, { cause: error }).withCode(
                          'upstream',
                      );
                release(thrown);
                throw failure ?? thrown;
            }

            if (result.done) {
                release();
                controller.close();
                return;
            }

            total += result.value.byteLength;
            if (total > PLUGIN_RESPONSE_MAX_BYTES) {
                const over = new PluginError(
                    `plugin "${manifest.id}" response body from ${url} is over the ${PLUGIN_RESPONSE_MAX_BYTES} byte limit`,
                ).withCode('upstream');
                release(over);
                throw failure ?? over;
            }

            controller.enqueue(result.value);
        },
        cancel() {
            release();
        },
    });
};

/**
 * The response the plugin actually gets: the upstream's status and headers,
 * with its body wrapped in {@link guardBody}.
 *
 * A fresh `Response` rather than the upstream one, because a body cannot be
 * swapped on an existing response. `url` and `redirected` are read-only and
 * blank on a constructed response, so they are redefined: both are part of the
 * contract (`url` is the last hop of the redirect chain, which is what a plugin
 * resolves relative links against) and losing them to a construction detail
 * would be a silent regression.
 *
 * A status that cannot carry a body (204, 304) arrives with `body` already
 * null, and passing null through is also what keeps the `Response` constructor
 * from throwing on exactly those.
 */
const guardedResponse = (manifest: PluginManifest, sent: SentResponse, controller: AbortController, open: Set<BodyRelease>): Response => {
    const url = sent.url.toString();
    const body = sent.response.body === null ? null : guardBody(manifest, url, sent.response.body, controller, open);

    const response = new Response(body, {
        status: sent.response.status,
        statusText: sent.response.statusText,
        headers: sent.response.headers,
    });

    Object.defineProperty(response, 'url', { value: url });
    Object.defineProperty(response, 'redirected', { value: sent.redirected });

    return response;
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
 * It is not what stops a badly-behaved one, and it never will be.
 * `PluginLoader` imports plugin code into this process with a plain dynamic
 * `import()`, permanently (`docs/decisions/plugin-trust.md`), so a plugin that
 * wants global `fetch`, `fs`, or `process.env` has them and gating the methods
 * here does not take them away. This is the reliability and disclosure layer,
 * which is all it was ever actually doing.
 *
 * So what crosses back to a plugin is whatever suits the job: `host.fetch`
 * hands over a real `Response` and `host.signal` a real `AbortSignal`. The
 * JSON-safe rule still governs the payloads that are stored or sent, which is
 * most of `capabilities/`, and `boundary.json.safe.ts` still fails `tsc` over
 * those.
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
     * Every response body any plugin still has open, by plugin id.
     *
     * Here rather than only in the closure `createHost` builds, because somebody
     * outside the host has to be able to let go of these: a plugin is disposed by
     * `PluginLifecycleManager`, which holds the record and not the host object.
     * See {@link cancelOpenBodies}.
     */
    private readonly openBodies = new Map<string, Set<BodyRelease>>();

    constructor(
        private readonly options: PluginHostFactoryOptions,
        private readonly container: Container,
        private readonly pluginLog: PluginLog,
        private readonly spotifyShimClient: SpotifyShimClient,
    ) {}

    // `PluginConfigService` and `PluginStorageRepository` are scoped, so every capability call
    // below opens its own scope (see `#modules/shared/scoped.work.js`). InjectKit's rejection of
    // a captured scoped instance at `build()` is how that used to surface: before the check, it
    // was `Transaction is already committed` thrown into whichever plugin happened to read its
    // own config.

    /** One host per plugin. Cheap: the only per-host state is its rate buckets. */
    createHost(manifest: PluginManifest): PluginHost {
        const logger = this.pluginLog.for(manifest.id);
        const entries = this.networkEntries(manifest, logger);
        // Per bucket, not per plugin: a plugin talking to two upstreams was
        // sharing one allowance between them, which paced it against a limit
        // neither of them published. Built lazily, so a declared-but-unused
        // upstream costs nothing.
        const buckets = new Map<string, RateBucket>();

        // Per plugin instance, and the reason `cancelOpenBodies` exists: a body
        // outlives the invocation that fetched it, so nothing else would ever
        // release one belonging to a plugin that is being disposed.
        const bodies = new Set<BodyRelease>();
        this.openBodies.set(manifest.id, bodies);

        return {
            logger,
            fetch: (url, init) => this.hostFetch(manifest, entries, buckets, logger, bodies, url, init),
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
            resolved ??= inScope(this.container, scope => scope.get(PluginConfigService).getConfig(manifest.id)).then(config => {
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
                return inScope(this.container, scope => scope.get(PluginStorageRepository).get(manifest.id, key));
            },
            set: async (key, value) => {
                guard();
                await inScope(this.container, scope => scope.get(PluginStorageRepository).set(manifest.id, key, value));
            },
            delete: async key => {
                guard();
                await inScope(this.container, scope => scope.get(PluginStorageRepository).delete(manifest.id, key));
            },
            list: async prefix => {
                guard();
                return inScope(this.container, scope => scope.get(PluginStorageRepository).listKeys(manifest.id, prefix));
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
                const secrets = await inScope(this.container, scope => scope.get(PluginConfigService).getSecrets(manifest.id));
                return secrets[key];
            },
        };
    }

    private createConfig(manifest: PluginManifest): PluginConfigAccess {
        return {
            get: async () => inScope(this.container, scope => scope.get(PluginConfigService).getConfig(manifest.id)),
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
                await inScope(this.container, scope =>
                    scope.get(PluginConfigService).saveConfig(manifest.id, [...manifest.configFields, OAUTH_SECRET_FIELD], {
                        [PLUGIN_OAUTH_SECRET_KEY]: JSON.stringify(flat),
                    }),
                );
            },
            getTokens: async () => {
                guard();
                const secrets = await inScope(this.container, scope => scope.get(PluginConfigService).getSecrets(manifest.id));
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
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        bodies: Set<BodyRelease>,
        url: string,
        init?: HostFetchInit,
    ): Promise<Response> {
        const entries = await networkEntries();
        const { url: target, entry } = this.assertAllowed(manifest, entries, logger, url);
        const { deadlineAt, budgetMs } = this.budgetFor(manifest, target, init);

        const { controller, dispose } = egressController(deadlineAt, init?.signal);

        let sent: SentResponse;
        try {
            sent = await this.sendWithRetry(manifest, entries, buckets, logger, entry, target, init, controller, deadlineAt, budgetMs);
        } catch (error) {
            // Nothing was registered, so nothing else will ever abort this.
            controller.abort();
            throw this.transportFailure(manifest, target.hostname.toLowerCase(), controller, budgetMs, error);
        } finally {
            // The fetch deadline is done with either way: it covered connect,
            // headers and the redirect chain, and from here the body's own
            // bounds apply. Leaving the timer armed would abort a perfectly
            // healthy body mid-read.
            dispose();
        }

        // Refused before a byte is read, when the server was honest about the
        // size. The running count in the guard is what catches a server that
        // understates the header or omits it entirely, which is exactly what one
        // streaming forever would do.
        this.assertDeclaredSizeFits(manifest, sent, controller);

        return guardedResponse(manifest, sent, controller, bodies);
    }

    /**
     * Refuses an over-cap body on its `content-length` alone.
     *
     * Cheap and early, and not sufficient on its own: a chunked response has no
     * `content-length` at all, so the guard counts as it reads. Both, because
     * either alone is wrong.
     */
    private assertDeclaredSizeFits(manifest: PluginManifest, sent: SentResponse, controller: AbortController): void {
        const declared = Number(sent.response.headers.get('content-length') ?? Number.NaN);
        if (!Number.isFinite(declared) || declared <= PLUGIN_RESPONSE_MAX_BYTES) return;

        controller.abort();
        void cancelBody(sent.response);
        throw new PluginError(
            `plugin "${manifest.id}" response body from ${sent.url.toString()} declares ${declared} bytes, over the ${PLUGIN_RESPONSE_MAX_BYTES} byte limit`,
        ).withCode('upstream');
    }

    /**
     * How long one egress call gets, and when it runs out.
     *
     * This bounds getting the RESPONSE only: connect, headers and the whole
     * redirect chain. Reading the body is bounded separately, by the guard's
     * own idle, lifetime and byte caps, which is the point. A legitimate large
     * body outlives the call that asked for it.
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
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        entry: NetworkEntry,
        target: URL,
        init: HostFetchInit | undefined,
        controller: AbortController,
        deadlineAt: number,
        budgetMs: number,
    ): Promise<SentResponse> {
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
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
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
        return this.sendRaw(manifest, entries, logger, target, init, controller, budgetMs);
    }

    /**
     * Let go of every response body a plugin still holds.
     *
     * Called when a plugin is disposed, so a body cannot outlive the instance
     * that fetched it. That is a backstop for a plugin that crashed or forgot,
     * not the sanctioned way to finish with one: a well-behaved plugin reads its
     * body to the end or cancels it, and the lifetime cap catches the rest long
     * before shutdown.
     *
     * Safe to call for a plugin that never opened one, and safe to call twice.
     */
    cancelOpenBodies(pluginId: string): void {
        const bodies = this.openBodies.get(pluginId);
        this.openBodies.delete(pluginId);
        if (bodies === undefined) return;

        const disposed = new PluginError(`plugin "${pluginId}" was disposed while a response body was still open`).withCode('unavailable');
        // A copy, because releasing a body removes it from this very set.
        for (const release of [...bodies]) release(disposed);
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
        buckets: Map<string, RateBucket>,
        entry: NetworkEntry,
        deadlineAt: number,
    ): Promise<void> {
        let bucket = buckets.get(entry.bucket);
        if (bucket === undefined) {
            const limiter = limiterFor(entry.ratePerSecond);
            bucket = { limiter, queue: new RateLimiterQueue(limiter, { maxQueueSize: MAX_RATE_LIMIT_QUEUE }) };
            buckets.set(entry.bucket, bucket);
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

        // Refused before queueing when the window will not refill inside the budget, which is the
        // one thing the queue cannot do for us: its own `expiresUnixAt` is in whole SECONDS and is
        // only swept when the queue next ticks, so a call with 50ms left would otherwise sit there
        // for the best part of a second before being told no. This keeps a doomed call cheap and is
        // what carries the real `Retry-After`.
        const state = await bucket.limiter.get(manifest.id);
        if (state !== null && state.remainingPoints <= 0 && state.msBeforeNext >= deadlineAt - Date.now()) {
            overQuota(state.msBeforeNext);
        }

        // Otherwise queue, FIFO. This used to be a hand-rolled consume-sleep-retry, which was two
        // things wrong at once: it slept exactly once, so under contention everyone woke together
        // and raced for the same refilled points and the losers failed outright — and even with the
        // retry looped, a race has no order, so a caller could be starved indefinitely while others
        // won. `RateLimiterQueue` is the library's answer to both: one waiter is admitted at a time,
        // in arrival order, woken by the limiter's own timer rather than by polling.
        //
        // `expiresUnixAt` is the backstop for a call that outlives its budget while queued. Ceiled
        // rather than floored, because flooring a deadline that is 200ms away lands it in the
        // current second and the sweep would drop the request before it ever had a turn.
        try {
            await bucket.queue.removeTokens(1, manifest.id, Math.ceil(deadlineAt / 1000));
        } catch (rejection) {
            if (!(rejection instanceof RateLimiterQueueError)) throw rejection;
            // Expired in the queue, or the queue is full. Neither carries a wait, so it is read back
            // off the limiter: the caller still deserves a real number to back off by.
            const after = await bucket.limiter.get(manifest.id);
            overQuota(after?.msBeforeNext ?? 0);
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
}
