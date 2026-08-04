/**
 * The one error shape that means the same thing on both sides of the plugin
 * boundary.
 *
 * Deliberately NOT a subclass of the API's `ServerkitError`: that class lives
 * in `@maroonedsoftware/errors`, a server dependency, and inheriting from it
 * here would pull the host's framework into every plugin's dependency tree,
 * which is exactly what this package exists to avoid. So a plugin says what
 * went wrong in its own vocabulary and the host decides what that means over
 * HTTP (see `plugin.error.http.ts` in the API).
 *
 * The classification fields (`code`, `retryable`, `retryAfterMs`,
 * `upstreamStatus`, `message`) are all JSON-safe on purpose: nothing here
 * crosses the boundary as a live object today, but the day plugins move out of
 * process, what has to change is how this is transported, not what it says.
 * `cause` is the exception, and is in-process debugging detail only.
 */

/**
 * Marker used for recognition instead of `instanceof`.
 *
 * `tsup` externalizes `dependencies`, so a workspace plugin resolves to the
 * same copy of this module the host loaded and `instanceof` would in fact work
 * today. A plugin installed from outside the workspace can carry its own copy,
 * and then `instanceof` quietly answers `false` for an error that is a
 * `PluginError` in every way that matters. A branded property survives that.
 */
const PLUGIN_ERROR_BRAND = 'deadair.plugin-error/v1';

/**
 * Why a plugin call failed, in terms the host can act on.
 *
 * These are semantic, not HTTP: an upstream's status code is a diagnostic
 * (`upstreamStatus`), never the answer to what this API should respond. A
 * provider's 404 and "no plugin by that id" are not the same 404.
 */
export type PluginErrorCode =
    /** Credentials are missing, expired or rejected. The operator has to reauthorize. */
    | 'auth'
    /** The plugin's stored settings are wrong or incomplete. The operator has to fix the form. */
    | 'config'
    /** The upstream has no such resource. Often not an error at all to the caller. */
    | 'not_found'
    /**
     * The upstream understood, and refused for this specific resource. Distinct
     * from `auth`: the credentials are fine and the next call for something
     * else will succeed.
     */
    | 'forbidden'
    /** The upstream is throttling. Honour `retryAfterMs` when it is set. */
    | 'rate_limited'
    /** The call did not finish in time. */
    | 'timeout'
    /** The plugin or its upstream is temporarily out of service. */
    | 'unavailable'
    /** The plugin does not implement what was asked of it. */
    | 'unsupported'
    /** The upstream answered, and what it said was a failure. */
    | 'upstream'
    /** Anything else, including a bug in the plugin. */
    | 'internal';

/** Every {@link PluginErrorCode}, for validating a code that arrived from third-party code. */
export const PLUGIN_ERROR_CODES = [
    'auth',
    'config',
    'not_found',
    'forbidden',
    'rate_limited',
    'timeout',
    'unavailable',
    'unsupported',
    'upstream',
    'internal',
] as const;

/**
 * Codes that describe the thing that was asked for rather than the health of
 * the plugin that was asked.
 *
 * This is a separate question from {@link RETRYABLE_BY_CODE}, and conflating
 * the two is a trap. "Retrying will not help" and "this plugin is sick" feel
 * like the same statement and are not: asking Spotify for a playlist you do
 * not own is refused every time, forever, while the connection it was asked
 * over is in perfect health. A host that counts those refusals as failures
 * eventually quarantines a working plugin for correctly answering the
 * question it was asked.
 *
 * So a resource-scoped failure is reported to the caller and otherwise
 * forgotten: it neither trips a circuit breaker nor clears one, because it is
 * not evidence in either direction.
 */
const RESOURCE_SCOPED_CODES: ReadonlySet<PluginErrorCode> = new Set(['not_found', 'forbidden', 'unsupported']);

/**
 * Whether this failure is about the requested resource rather than the plugin.
 *
 * See {@link RESOURCE_SCOPED_CODES}. Hosts use this to decide whether a
 * failure counts against a plugin's health.
 */
export function isResourceScopedCode(code: PluginErrorCode): boolean {
    return RESOURCE_SCOPED_CODES.has(code);
}

/**
 * Whether repeating the identical call could plausibly succeed.
 *
 * `internal` is listed as retryable even though a plugin bug will not fix
 * itself: it is the bucket every unclassified throw lands in, and the host
 * uses this flag to decide whether to quarantine a plugin on the spot. Being
 * wrong in the lenient direction costs a couple of retries; being wrong in the
 * strict direction quarantines a working plugin over one bad response.
 */
const RETRYABLE_BY_CODE: Record<PluginErrorCode, boolean> = {
    auth: false,
    config: false,
    not_found: false,
    forbidden: false,
    unsupported: false,
    rate_limited: true,
    timeout: true,
    unavailable: true,
    upstream: true,
    internal: true,
};

export interface PluginErrorOptions {
    /** Overrides the default for this code. See {@link RETRYABLE_BY_CODE}. */
    retryable?: boolean;
    /** How long to wait before retrying, when the upstream said so (`Retry-After`). */
    retryAfterMs?: number;
    /**
     * The upstream's HTTP status, for logs and for plugin-internal branching.
     * Diagnostic only: the host never forwards it as its own response status.
     */
    upstreamStatus?: number;
    cause?: unknown;
}

/**
 * A failure a plugin can describe well enough for the host to answer properly.
 *
 * Throwing a bare `Error` stays perfectly legal; the host treats it as
 * `internal` and behaves exactly as it did before this class existed. Reach
 * for `PluginError` when the caller can do something different with the answer:
 * reauthorize, wait, fix a setting, or give up.
 */
export class PluginError extends Error {
    /** @internal Recognition marker. Use {@link isPluginError}, not this field. */
    readonly deadairPluginError: string = PLUGIN_ERROR_BRAND;

    readonly code: PluginErrorCode;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly upstreamStatus?: number;

    constructor(code: PluginErrorCode, message: string, options: PluginErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = 'PluginError';
        this.code = code;
        this.retryable = options.retryable ?? RETRYABLE_BY_CODE[code];
        this.retryAfterMs = options.retryAfterMs;
        this.upstreamStatus = options.upstreamStatus;
    }
}

/**
 * Whether `value` carries the {@link PluginError} contract.
 *
 * Structural rather than `instanceof` for the reason on
 * {@link PLUGIN_ERROR_BRAND}, and it does not require `instanceof Error`
 * either: a plugin bundled with its own realm can produce something that is
 * not this realm's `Error` and is still the thing we mean.
 */
export function isPluginError(value: unknown): value is PluginError {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<PluginError>;
    return candidate.deadairPluginError === PLUGIN_ERROR_BRAND && typeof candidate.message === 'string';
}

/**
 * Whatever a plugin threw, as a {@link PluginError}.
 *
 * The `isPluginError` branch re-reads `code` and `retryable` rather than
 * trusting them: the guard proves the brand, not that a third-party copy of
 * this class agreed with ours about which codes exist. An unrecognized code
 * degrades to `fallback` instead of leaking a made-up string into the API's
 * error mapping.
 */
export function toPluginError(error: unknown, fallback: PluginErrorCode = 'internal'): PluginError {
    if (isPluginError(error)) {
        const known = (PLUGIN_ERROR_CODES as readonly string[]).includes(error.code);
        const code = known ? error.code : fallback;
        // Already ours and already valid: keep the identity so a `catch` further
        // up can still recognize the specific subclass that was thrown.
        if (known && typeof error.retryable === 'boolean' && error instanceof PluginError) return error;
        return new PluginError(code, error.message, {
            retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
            retryAfterMs: error.retryAfterMs,
            upstreamStatus: error.upstreamStatus,
            cause: error,
        });
    }

    const message = error instanceof Error ? error.message : String(error);
    return new PluginError(fallback, message, { cause: error });
}
