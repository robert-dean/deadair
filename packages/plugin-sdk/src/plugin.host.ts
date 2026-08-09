/**
 * What the host lends a plugin. Everything here is an ordinary in-process call:
 * the host and the plugin share a realm, permanently, so `fetch` hands back a
 * real `Response` and `signal` is a real `AbortSignal`. See
 * `docs/decisions/plugin-trust.md`.
 *
 * The JSON-safe rule that used to govern this file has not gone away, it has
 * moved to where it pays for itself: `boundary.json.safe.ts` still asserts it
 * over every payload that is stored in Postgres or sent over HTTP, which is
 * most of `capabilities/` plus the manifest. What is no longer asserted is the
 * arguments and return values of the methods below, because nothing serializes
 * them. `TrackFetchSession` and `TrackFetchRequest` are the exceptions in this
 * file: they go over HTTP to the track fetcher, so they stay asserted.
 */

import type { MusicProviderStream, ProviderStream } from './capabilities/music.provider.js';

/** Structured logging. Goes to the host's logger, tagged with the plugin id. */
export interface PluginLogger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

export type HostFetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** JSON-safe subset of `RequestInit`. */
export interface HostFetchInit {
    method?: HostFetchMethod;

    headers?: Record<string, string>;

    /** Already-serialised body. Set `content-type` yourself. */
    body?: string;

    /**
     * Budget in ms for the WHOLE call, clamped to the host's ceiling: waiting
     * for rate-limit headroom, the request, any `Retry-After` back-off and the
     * retry all come out of this one number. The ceiling is the host's own
     * deadline for a call into plugin code, so asking for more buys nothing.
     */
    timeoutMs?: number;

    /**
     * Your own reason to give up, on top of the host's.
     *
     * Composed with the host's deadline rather than replacing it: whichever
     * fires first ends the request, and {@link PluginHost.signal} is already
     * watched for you. Pass one when the plugin has a cancellation of its own,
     * such as a caller that walked away or a race between two upstreams.
     */
    signal?: AbortSignal;
}

/**
 * Namespaced key/value store, private to this plugin. Values must be
 * JSON-serialisable. Requires the `storage` permission.
 */
export interface PluginStorage {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    /** Keys, optionally filtered to those starting with `prefix`. */
    list(prefix?: string): Promise<string[]>;
}

/** Read access to this plugin's own decrypted secret config values. */
export interface PluginSecrets {
    /** Resolves to `undefined` when the operator never set the value. */
    get(key: string): Promise<string | undefined>;
}

/** Read access to this plugin's validated non-secret config values. */
export interface PluginConfigAccess {
    get(): Promise<Record<string, unknown>>;
}

/**
 * OAuth token vault. The host owns the redirect endpoint and the encryption;
 * the plugin only builds the authorize URL and exchanges the code.
 * Requires the `oauth` permission.
 */
export interface PluginOAuth {
    /** The host-owned redirect URI to register with the provider. */
    getRedirectUri(): Promise<string>;
    saveTokens(tokens: Record<string, string>): Promise<void>;
    /** Resolves to `undefined` when the plugin has never completed a flow. */
    getTokens(): Promise<Record<string, string> | undefined>;
}

/** Fire-and-forget notifications onto the host's event bus. */
export interface PluginEvents {
    emit(event: string, payload?: Record<string, unknown>): Promise<void>;
}

/**
 * A login the station's track fetcher opens its own session with.
 *
 * Handed to {@link PluginTrackFetcher.serve} and nowhere else: it is not
 * persisted, not written to config, and not readable back out of the host. The
 * plugin still owns the account and the refresh.
 */
export interface TrackFetchSession {
    /** The account the fetcher should log in as. */
    username: string;
    /** A currently-valid access token. */
    accessToken: string;
    /** Unix epoch millis after which `accessToken` stops working. */
    expiresAt?: number;
}

export interface TrackFetchRequest {
    /** Provider-scoped track id, exactly as the plugin's own catalog reports it. */
    trackId: string;
    session: TrackFetchSession;
}

/**
 * The station's own track fetcher: a helper process, running beside the audio
 * player, that speaks a provider's protocol and re-serves the result as plain
 * audio over HTTP.
 *
 * This exists for one shape of provider: the audio is reachable, but only to a
 * process speaking a protocol the plugin does not. Spotify is the reason —
 * its tracks come off the CDN encrypted and are fetched by a separate binary
 * beside Liquidsoap. Without this, such a provider could not implement
 * {@link MusicProviderStream.resolveStreamUrl} at all, because there is no URL
 * for it to mint.
 *
 * Do NOT reach for this when your provider's audio can simply be fetched. Mint
 * the URL yourself and keep your credentials to yourself, which is both simpler
 * and narrower. Requires the `trackFetcher` permission.
 */
export interface PluginTrackFetcher {
    /**
     * Lend the fetcher a login and get back a URL for one track.
     *
     * Resolves to `undefined` when this station has no fetcher configured,
     * which a plugin should pass straight through as "cannot resolve this
     * item" rather than treat as an error: an operator who never set the
     * stream side up is a normal state, not a fault.
     */
    serve(request: TrackFetchRequest): Promise<ProviderStream | undefined>;
}

/**
 * The single object handed to a plugin at init, and the sanctioned way to get
 * at the outside world: network, persistence, secrets, tokens.
 *
 * NOT A SANDBOX, and never going to be one. The host imports plugins into its
 * own realm, permanently (`docs/decisions/plugin-trust.md`), so global `fetch`,
 * `fs`, and `process.env` are all reachable and nothing stops a plugin from
 * using them. What this interface buys is a manifest that honestly describes a
 * well-behaved plugin's blast radius, plus a set of guarantees (rate limiting,
 * timeouts, SSRF-safe redirects) that no plugin has to reimplement. Containment
 * is not among them, and the console says so before an operator enables
 * anything.
 */
export interface PluginHost {
    logger: PluginLogger;

    /**
     * The sanctioned network egress. Enforces the manifest's hostname
     * allowlist, a timeout, a rate limit, and `Retry-After` back-off, and
     * re-checks the allowlist on every redirect hop so an upstream cannot
     * bounce a plugin somewhere its manifest never asked for. Rejects if
     * `url`'s hostname is not in `permissions.network`.
     *
     * The allowlist is advisory against a plugin that simply calls global
     * `fetch` instead (see the note on {@link PluginHost}). It is not advisory
     * against a hostile *server*: the redirect and credential-stripping rules
     * protect an honest plugin, and it gains nothing by going around them.
     *
     * A real `Response`, so `await response.json()` is how you read JSON and
     * `response.body` is how you stream audio. There is no second egress for
     * bytes: a body you do not buffer is one you read off `response.body`, and
     * a body you never read at all should be `response.body?.cancel()`-ed
     * rather than dropped.
     *
     * `timeoutMs` bounds getting the response: connect, headers and the whole
     * redirect chain. It does NOT bound reading the body, because a large body
     * legitimately outlives the call that asked for it. The body is bounded
     * instead by an idle deadline between chunks, a total byte cap and a
     * lifetime cap, all host-enforced. Exceeding any of them fails the read
     * rather than truncating it, so bytes you get are always bytes the server
     * actually sent.
     */
    fetch(url: string, init?: HostFetchInit): Promise<Response>;

    /**
     * Aborts when the host gives up on the call you are currently inside.
     *
     * The same signal the host itself races the call against, not a copy, so
     * honouring it and being abandoned are the same moment rather than two
     * clocks that nearly agree. `host.fetch` already watches it; pass it on to
     * anything else of yours that takes one.
     *
     * Outside any host call (from a timer you set yourself) this is a signal
     * that never aborts, because nothing is waiting on that work.
     */
    signal: AbortSignal;

    /**
     * Milliseconds left before the host abandons the call you are currently
     * inside, so work that does not fit can be dropped deliberately instead of
     * being cut off halfway.
     *
     * The number behind {@link PluginHost.signal}, for deciding whether to
     * START something rather than for being interrupted during it. The signal
     * tells you the call is over; this tells you it is nearly over, which is
     * the only one of the two that can save a partial result.
     *
     * The host gives every call into your code a deadline, and it is not a
     * constant: a background job may run on a far longer budget than a request
     * a person is waiting on, and the same method of yours can be called both
     * ways. Guessing at it is how a plugin ends up either quitting early on a
     * budget it had, or being killed mid-flight with nothing useful to return.
     *
     * The pattern this exists for is a sequence where the later steps are
     * optional:
     *
     * ```ts
     * const core = await this.lookup(ref);
     * if (host.remainingMs() < 2_000) return core;  // good enough, out of time
     * return { ...core, ...(await this.enrich(core)) };
     * ```
     *
     * Not a budget you are given: it is the host's, spent by everything the
     * call does, and `host.fetch` already caps its own timeout by it. Treat a
     * small number as advice to wrap up, not as permission to run that long.
     */
    remainingMs(): number;

    storage: PluginStorage;

    secrets: PluginSecrets;

    config: PluginConfigAccess;

    oauth: PluginOAuth;

    events: PluginEvents;

    trackFetcher: PluginTrackFetcher;
}
