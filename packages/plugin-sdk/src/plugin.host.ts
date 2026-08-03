/**
 * Everything in this file crosses the plugin boundary. Every argument and
 * return value is JSON-safe (structured-clone-friendly) on purpose: the host
 * currently calls plugins in-process, but the boundary is shaped so it can be
 * moved behind `worker_threads` without changing a single signature.
 *
 * That means: no `Request`/`Response`/`Headers`, no streams, no `Date`, no
 * class instances, no functions in payloads.
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

    /** Per-request timeout in ms. The host clamps this to its own ceiling. */
    timeoutMs?: number;
}

/** JSON-safe subset of `Response`. */
export interface HostFetchResponse {
    status: number;

    /** Lowercased header names. */
    headers: Record<string, string>;

    /** Raw response body as text. Parse it yourself. */
    body: string;

    /** True for 2xx. */
    ok: boolean;
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
 * The single object handed to a plugin at init. A plugin gets at the outside
 * world through this and nothing else: no `fetch`, no `fs`, no direct DB.
 */
export interface PluginHost {
    logger: PluginLogger;

    /**
     * The only network egress. The host enforces the manifest's hostname
     * allowlist, a timeout, a rate limit, and `Retry-After` back-off. Rejects
     * if `url`'s hostname is not in `permissions.network`.
     */
    fetch(url: string, init?: HostFetchInit): Promise<HostFetchResponse>;

    storage: PluginStorage;

    secrets: PluginSecrets;

    config: PluginConfigAccess;

    oauth: PluginOAuth;

    events: PluginEvents;
}
