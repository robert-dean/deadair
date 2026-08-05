/**
 * Everything in this file crosses the plugin boundary. Every argument and
 * return value is JSON-safe on purpose, and deliberately narrower than
 * structured-clone-safe: the deferred isolation target (see
 * `docs/decisions/plugin-isolation.md`) is a subprocess over IPC, not
 * `worker_threads`, and a subprocess boundary is framing plus a serialization
 * format, in practice JSON. So no `Uint8Array`, `Map`, `Set` or `Date`, even
 * though `structuredClone` would carry all four.
 *
 * That means: no `Request`/`Response`/`Headers`, no streams, no `Date`, no
 * class instances, no functions in payloads. See
 * `docs/decisions/plugin-streaming.md` for how bytes cross this boundary when
 * they have to.
 */

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
}

/** JSON-safe subset of `Response`. */
export interface HostFetchResponse {
    status: number;

    /** The reason phrase, e.g. `"Not Found"`. Empty when the server sent none. */
    statusText: string;

    /**
     * Lowercased header names. A header the server repeated arrives joined with
     * `", "`, per the Fetch spec, with one exception: `set-cookie` is NOT here,
     * because joining cookies corrupts them. See
     * {@link HostFetchResponse.setCookie}.
     */
    headers: Record<string, string>;

    /**
     * Every `set-cookie` header, one entry each, unparsed. Split out of
     * {@link HostFetchResponse.headers} because a `Record` holds one value per
     * name and `Set-Cookie` is the header servers routinely repeat. Empty when
     * the server set none.
     */
    setCookie: string[];

    /** Raw response body as text. Parse it yourself, or see `jsonBody`. */
    body: string;

    /** True for 2xx. */
    ok: boolean;

    /**
     * The URL this response actually came from: the last hop of the redirect
     * chain, which is not necessarily the URL that was requested. Use it to
     * resolve relative links out of the body.
     */
    url: string;

    /** True when at least one redirect was followed to get here. */
    redirected: boolean;
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
 * The single object handed to a plugin at init, and the sanctioned way to get
 * at the outside world: network, persistence, secrets, tokens.
 *
 * NOT YET A SANDBOX. The host imports plugins into its own realm today, so
 * global `fetch`, `fs`, and `process.env` are all still reachable and nothing
 * stops a plugin from using them. What this interface buys right now is a
 * manifest that honestly describes a well-behaved plugin's blast radius, plus
 * a set of guarantees (rate limiting, timeouts, SSRF-safe redirects) that no
 * plugin has to reimplement. It becomes an enforceable boundary only once
 * plugins move into an isolate; the JSON-safe shape of everything here is what
 * keeps that move from breaking every plugin.
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
     * The body is fully buffered, under the same deadline as the request and
     * under a host-configured size cap. A response over the cap fails the call
     * rather than arriving truncated, so a `body` you get back is always whole.
     */
    fetch(url: string, init?: HostFetchInit): Promise<HostFetchResponse>;

    storage: PluginStorage;

    secrets: PluginSecrets;

    config: PluginConfigAccess;

    oauth: PluginOAuth;

    events: PluginEvents;
}
