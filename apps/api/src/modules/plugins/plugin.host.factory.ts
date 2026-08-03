import { Injectable } from 'injectkit';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import type {
    HostFetchInit,
    HostFetchMethod,
    HostFetchResponse,
    PluginConfigAccess,
    PluginEvents,
    PluginHost,
    PluginLogger,
    PluginManifest,
    PluginOAuth,
    PluginSecrets,
    PluginStorage,
} from '@deadair/plugin-sdk';
import { PluginConfigService } from './plugin.config.service.js';
import { PluginEchoTracker } from './plugin.echo.tracker.js';
import { OAUTH_SECRET_FIELD, PLUGIN_OAUTH_SECRET_KEY } from './plugin.oauth.secret.js';
import { PluginStorageRepository } from './plugin.storage.repository.js';

export { PLUGIN_OAUTH_SECRET_KEY, OAUTH_SECRET_FIELD } from './plugin.oauth.secret.js';

/** Tunables for `host.fetch`. Every field has a default; the module may override any of them. */
export interface PluginFetchLimits {
    /** Requests allowed per {@link PluginFetchLimits.windowSeconds}, per plugin. */
    requestsPerWindow?: number;
    windowSeconds?: number;
    /** Applied when the plugin does not ask for a timeout. */
    timeoutMs?: number;
    /** Ceiling the plugin's own `timeoutMs` is clamped to. */
    maxTimeoutMs?: number;
    /** Longest `Retry-After` the host is willing to sit out before giving up on the retry. */
    maxRetryAfterMs?: number;
    /** Longest the host will park a call waiting for rate-limit headroom. */
    maxRateLimitWaitMs?: number;
    /**
     * Largest response body the host will buffer, in bytes. Bodies cross the
     * boundary as one string, so without this an upstream that streams
     * indefinitely is an OOM with extra steps: the deadline bounds how long a
     * body takes to arrive, not how big it is.
     */
    maxBodyBytes?: number;
}

export const PLUGIN_FETCH_DEFAULTS: Required<PluginFetchLimits> = {
    requestsPerWindow: 10,
    windowSeconds: 1,
    timeoutMs: 10_000,
    maxTimeoutMs: 60_000,
    maxRetryAfterMs: 30_000,
    maxRateLimitWaitMs: 5_000,
    // Generous for the catalog JSON these plugins actually fetch (a 50-track
    // Spotify page is low hundreds of KB), small enough that a runaway body
    // fails fast rather than eating the process.
    maxBodyBytes: 5 * 1024 * 1024,
};

/**
 * How many server-directed hops a single `host.fetch` will follow before giving
 * up. Redirects are not charged against the plugin's rate limit, so this cap is
 * the only thing bounding a redirect loop.
 */
export const MAX_PLUGIN_FETCH_REDIRECTS = 5;

/**
 * Where the host's own OAuth redirect endpoint lives, plus the fetch tunables.
 * Constructor-injected exactly like the loader's options so the factory never
 * touches `AppConfig`.
 */
@Injectable()
export class PluginHostFactoryOptions {
    constructor(
        readonly baseUrl: string,
        readonly fetchLimits: PluginFetchLimits = {},
    ) {}
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

/** The statuses that carry a `location` worth following. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Dropped when a hop crosses an origin, so a bearer token cannot ride a 302 to a third party. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie'] as const;

/** Dropped when a redirect rewrites the method to GET and discards the body. */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'] as const;

/** Header names are case-insensitive; the plugin's record keys are whatever it typed. */
const withoutHeaders = (headers: Record<string, string>, drop: readonly string[]): Record<string, string> =>
    Object.fromEntries(Object.entries(headers).filter(([key]) => !drop.includes(key.toLowerCase())));

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
 */
@Injectable()
export class PluginHostFactory {
    constructor(
        private readonly options: PluginHostFactoryOptions,
        private readonly pluginConfigService: PluginConfigService,
        private readonly pluginStorageRepository: PluginStorageRepository,
        private readonly pluginEchoTracker: PluginEchoTracker,
        private readonly logger: Logger,
    ) {}

    /** One host per plugin. Cheap: the only per-host state is its rate limiter. */
    createHost(manifest: PluginManifest): PluginHost {
        const limits = { ...PLUGIN_FETCH_DEFAULTS, ...this.options.fetchLimits };
        const logger = this.createLogger(manifest.id);
        const limiter = new RateLimiterMemory({ points: limits.requestsPerWindow, duration: limits.windowSeconds });

        return {
            logger,
            fetch: (url, init) => this.hostFetch(manifest, limiter, limits, logger, url, init),
            storage: this.createStorage(manifest),
            secrets: this.createSecrets(manifest),
            config: this.createConfig(manifest),
            oauth: this.createOAuth(manifest),
            events: this.createEvents(manifest, logger),
        };
    }

    /**
     * The host `Logger` has no child-logger facility, so every line is stamped
     * with `{ plugin: <id> }` here: plugin output is always attributable without
     * the plugin being able to spoof (or omit) the tag.
     */
    private createLogger(pluginId: string): PluginLogger {
        const meta = (extra?: Record<string, unknown>): Record<string, unknown> => ({ ...extra, plugin: pluginId });
        return {
            debug: (message, extra) => this.logger.debug(message, meta(extra)),
            info: (message, extra) => this.logger.info(message, meta(extra)),
            warn: (message, extra) => this.logger.warn(message, meta(extra)),
            error: (message, extra) => this.logger.error(message, meta(extra)),
        };
    }

    private createStorage(manifest: PluginManifest): PluginStorage {
        const guard = (): void => {
            if (!manifest.permissions.storage) {
                throw httpError(403).withDetails({ message: `plugin "${manifest.id}" does not declare the "storage" permission` });
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
        const guard = (): void => {
            if (!manifest.permissions.oauth) {
                throw httpError(403).withDetails({ message: `plugin "${manifest.id}" does not declare the "oauth" permission` });
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
                        throw httpError(422).withDetails({ message: `oauth token "${key}" must be a string` });
                    }
                    flat[key] = value;
                }
                // This is the hourly token-refresh path, and the write fires the
                // `plugin_configs` notify trigger exactly once (one upsert, one
                // row). Announcing it keeps the listener from reinitializing the
                // plugin in the middle of its own refresh call, which would
                // dispose the instance out from under it.
                this.pluginEchoTracker.expectEcho(manifest.id);
                try {
                    // Passing the manifest's own fields alongside the reserved one is
                    // deliberate: saveConfig rebuilds the whole `config` object from
                    // the descriptors it is given, so omitting them would blank the
                    // plugin's operator-entered settings on every token refresh.
                    await this.pluginConfigService.saveConfig(manifest.id, [...manifest.configFields, OAUTH_SECRET_FIELD], {
                        [PLUGIN_OAUTH_SECRET_KEY]: JSON.stringify(flat),
                    });
                } catch (error) {
                    // No write happened, so no notification is coming; a left-over
                    // expectation would swallow the next genuine config change.
                    this.pluginEchoTracker.retractEcho(manifest.id);
                    throw error;
                }
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
     */
    private async hostFetch(
        manifest: PluginManifest,
        limiter: RateLimiterMemory,
        limits: Required<PluginFetchLimits>,
        logger: PluginLogger,
        url: string,
        init?: HostFetchInit,
    ): Promise<HostFetchResponse> {
        const target = this.assertAllowed(manifest, logger, url);
        const hostname = target.hostname.toLowerCase();

        const timeoutMs = Math.min(init?.timeoutMs ?? limits.timeoutMs, limits.maxTimeoutMs);

        await this.consumeRateLimit(manifest, limiter, limits);
        const first = await this.send(manifest, logger, target, init, timeoutMs, limits.maxBodyBytes);

        // One retry, and only when the server itself asked for one. Anything
        // more belongs to the plugin, which knows whether the call is idempotent.
        if (first.status !== 429 && first.status !== 503) return first;
        const retryAfterMs = parseRetryAfter(first.headers['retry-after'], Date.now());
        if (retryAfterMs === undefined || retryAfterMs > limits.maxRetryAfterMs) return first;

        logger.info('plugin fetch backing off on Retry-After', { hostname, status: first.status, retryAfterMs });
        await sleep(retryAfterMs);
        await this.consumeRateLimit(manifest, limiter, limits);
        return this.send(manifest, logger, target, init, timeoutMs, limits.maxBodyBytes);
    }

    /**
     * The single place the egress policy lives: parseable, http(s), and a
     * hostname the manifest declared. Both the plugin's own URL and every
     * redirect target the server hands back go through here, so an upstream
     * cannot bounce a plugin somewhere its manifest never asked for.
     *
     * `from` is the URL the hop came from: present only for a redirect, where it
     * doubles as the base a relative `location` resolves against. A hop that
     * fails the policy is refused with a 403 either way, since at that point the
     * offending URL is the server's doing rather than bad plugin input.
     */
    private assertAllowed(manifest: PluginManifest, logger: PluginLogger, url: string, from?: URL): URL {
        let target: URL;
        try {
            target = new URL(url, from);
        } catch {
            if (from !== undefined) {
                throw httpError(502).withDetails({
                    message: `plugin "${manifest.id}" got an unparseable redirect target "${url}" from "${from.hostname.toLowerCase()}"`,
                });
            }
            throw httpError(400).withDetails({ message: `plugin "${manifest.id}" requested an unparseable URL` });
        }

        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop is not an http(s) URL', {
                    protocol: target.protocol,
                    from: from.hostname.toLowerCase(),
                });
                throw httpError(403).withDetails({
                    message: `plugin "${manifest.id}" was redirected by "${from.hostname.toLowerCase()}" to a non-http(s) URL ("${target.protocol}")`,
                });
            }
            throw httpError(400).withDetails({ message: `plugin "${manifest.id}" may only fetch http(s) URLs, got "${target.protocol}"` });
        }

        const hostname = target.hostname.toLowerCase();
        if (!manifest.permissions.network.some(pattern => matchesHost(hostname, pattern))) {
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop hostname not in permissions.network', {
                    hostname,
                    from: from.hostname.toLowerCase(),
                });
            } else {
                logger.warn('plugin fetch denied: hostname not in permissions.network', { hostname });
            }
            throw httpError(403).withDetails({
                message: `plugin "${manifest.id}" is not allowed to reach "${hostname}"; add it to permissions.network`,
            });
        }

        return target;
    }

    /**
     * Waits for headroom rather than failing outright: a plugin that bursts is
     * usually doing something legitimate (a paged catalog walk), and pacing it
     * is friendlier to the upstream API than making the plugin implement its own
     * back-off. Only a plugin that stays over budget past the parking limit gets
     * a rejection.
     */
    private async consumeRateLimit(manifest: PluginManifest, limiter: RateLimiterMemory, limits: Required<PluginFetchLimits>): Promise<void> {
        try {
            await limiter.consume(manifest.id, 1);
            return;
        } catch (rejection) {
            const waitMs = rateLimitWaitMs(rejection);
            if (waitMs === undefined) throw rejection;
            if (waitMs > limits.maxRateLimitWaitMs) {
                throw httpError(429).withDetails({
                    message: `plugin "${manifest.id}" is over its fetch rate limit (${limits.requestsPerWindow} per ${limits.windowSeconds}s)`,
                });
            }
            await sleep(waitMs);
        }

        try {
            await limiter.consume(manifest.id, 1);
        } catch (rejection) {
            if (rateLimitWaitMs(rejection) === undefined) throw rejection;
            throw httpError(429).withDetails({
                message: `plugin "${manifest.id}" is over its fetch rate limit (${limits.requestsPerWindow} per ${limits.windowSeconds}s)`,
            });
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
     * The whole chain shares one deadline. A per-hop timer would let a server
     * multiply the plugin's timeout by the hop cap just by redirecting slowly.
     */
    private async send(
        manifest: PluginManifest,
        logger: PluginLogger,
        target: URL,
        init: HostFetchInit | undefined,
        timeoutMs: number,
        maxBodyBytes: number,
    ): Promise<HostFetchResponse> {
        // A controller on a plain timer rather than `AbortSignal.timeout`: that
        // one's timer is unref'd and invisible to fake timers, so the deadline
        // would be neither reliable nor testable.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            let current = target;
            let method: HostFetchMethod = init?.method ?? 'GET';
            let headers: Record<string, string> = { ...init?.headers };
            let body = init?.body;

            for (let hop = 0; ; hop++) {
                const response = await this.roundTrip(manifest, current, method, headers, body, controller, timeoutMs, maxBodyBytes);

                const location = response.headers.location;
                // A 3xx with nothing to follow is just a response; hand it back
                // and let the plugin decide what it means.
                if (!REDIRECT_STATUSES.has(response.status) || location === undefined) return { ...response, redirected: hop > 0 };

                if (hop >= MAX_PLUGIN_FETCH_REDIRECTS) {
                    const hostname = current.hostname.toLowerCase();
                    logger.warn('plugin fetch denied: too many redirects', { hostname, hops: hop + 1 });
                    throw httpError(502).withDetails({
                        message: `plugin "${manifest.id}" fetch to "${hostname}" failed: too many redirects (over ${MAX_PLUGIN_FETCH_REDIRECTS})`,
                    });
                }

                const next = this.assertAllowed(manifest, logger, location, current);

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
        } finally {
            clearTimeout(timer);
        }
    }

    /** One HTTP round trip, flattened to the JSON-safe shape the SDK promises. */
    private async roundTrip(
        manifest: PluginManifest,
        target: URL,
        method: HostFetchMethod,
        headers: Record<string, string>,
        body: string | undefined,
        controller: AbortController,
        timeoutMs: number,
        maxBodyBytes: number,
    ): Promise<HostFetchResponse> {
        const hostname = target.hostname.toLowerCase();

        try {
            const response = await fetch(target, {
                method,
                headers,
                body,
                signal: controller.signal,
                // 'manual', so the allowlist gets a say on every hop; `send`
                // does the following.
                redirect: 'manual',
            });

            // `set-cookie` is the one header iteration does not join, so it
            // would otherwise arrive here as whichever cookie happened to be
            // last. It gets its own array instead of silently losing the rest.
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                const name = key.toLowerCase();
                if (name !== 'set-cookie') responseHeaders[name] = value;
            });

            return {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                setCookie: response.headers.getSetCookie(),
                body: await this.readBody(response, maxBodyBytes),
                ok: response.ok,
                url: target.toString(),
                // `send` overwrites this once it knows how many hops it took.
                redirected: false,
            };
        } catch (error) {
            const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : errorText(error);
            this.logger.warn('plugin fetch failed', { plugin: manifest.id, hostname, method, error: reason });
            throw httpError(502).withDetails({ message: `plugin "${manifest.id}" fetch to "${hostname}" failed: ${reason}` });
        }
    }

    /**
     * The body as text, capped at `maxBodyBytes`.
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
    private async readBody(response: Response, maxBodyBytes: number): Promise<string> {
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
