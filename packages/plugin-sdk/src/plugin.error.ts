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

/**
 * Marker that survives a plugin carrying its own copy of this module.
 *
 * `Symbol.for` reads from the global symbol registry, which is shared by every
 * realm in the agent, so a second copy of this file computes the *identical*
 * symbol rather than a private one. That is the whole trick: `instanceof`
 * compares class identity and a second copy has its own class, while this
 * compares a value two copies independently agree on.
 *
 * A symbol rather than a string property because it then stays out of
 * `JSON.stringify`, `Object.keys` and log output, and because a plain object
 * decoded off the wire cannot carry one by accident the way a well-guessed
 * string field could.
 *
 * Only {@link toPluginError} reads it. See the note on {@link isPluginError}
 * for why recognition and adoption are deliberately different questions.
 */
const PLUGIN_ERROR_BRAND = Symbol.for('deadair.plugin-error/v1');

/**
 * A failure a plugin can describe well enough for the host to answer properly.
 *
 * Throwing a bare `Error` stays perfectly legal; the host treats it as
 * `internal` and behaves exactly as it did before this class existed. Reach
 * for `PluginError` when the caller can do something different with the answer:
 * reauthorize, wait, fix a setting, or give up.
 *
 * The classification is applied with the `with*` builders rather than through
 * the constructor, so a subclass only has to forward `(message, options)` to
 * `super` and can then say what it means on its own terms:
 *
 * ```ts
 * throw new PluginError('slow down').withCode('rate_limited').withUpstreamStatus(429).withRetry(30_000);
 * ```
 *
 * Call {@link withCode} first: it resets `retryable` to the default for the
 * code, so a later `withCode` would undo an earlier {@link withRetry}.
 */
export class PluginError extends Error {
    /** @internal Recognition marker for a foreign copy. See {@link PLUGIN_ERROR_BRAND}. */
    readonly [PLUGIN_ERROR_BRAND] = true;

    /** What went wrong, in host vocabulary. Defaults to `internal`; set it with {@link withCode}. */
    code: PluginErrorCode = 'internal';
    /** Whether repeating the call could plausibly succeed. See {@link RETRYABLE_BY_CODE}. */
    retryable: boolean = RETRYABLE_BY_CODE.internal;
    /** How long to wait before retrying, when the upstream said so (`Retry-After`). */
    retryAfterMs?: number;
    /**
     * The upstream's HTTP status, for logs and for plugin-internal branching.
     * Diagnostic only: the host never forwards it as its own response status.
     */
    upstreamStatus?: number;

    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);

        // Restore the prototype to the actual class used with `new` (workaround
        // for the historic Error-subclass instanceof bug in transpilers / older
        // V8). Using `new.target.prototype` means subclasses get correct `instanceof`
        // behaviour without each one having to replicate this line.
        Object.setPrototypeOf(this, new.target.prototype);
        this.name = 'PluginError';
    }

    /** Classifies the failure, and resets `retryable` to the default for that code. */
    withCode(code: PluginErrorCode) {
        this.code = code;
        this.retryable = RETRYABLE_BY_CODE[code];
        return this;
    }

    /**
     * Attaches the upstream's retry advice. Saying "wait this long and try
     * again" is itself a statement that a retry is worth making, so this marks
     * the failure retryable regardless of what the code defaults to.
     */
    withRetry(retryAfterMs: number) {
        this.retryable = true;
        this.retryAfterMs = retryAfterMs;
        return this;
    }

    withUpstreamStatus(upstreamStatus: number) {
        this.upstreamStatus = upstreamStatus;
        return this;
    }
}

/**
 * Whether `value` is one of ours: an error this copy of the module built.
 *
 * Deliberately `instanceof`, and deliberately NOT the same question
 * {@link toPluginError} answers. Almost every caller asking this is host code
 * downstream of the invoker, where the error has already been adopted and the
 * honest question is "did we make this", to which `instanceof` is the exact,
 * unforgeable answer. It also keeps subclasses (`SpotifyRequestError`) working
 * for the plugin's own branching, via the constructor's `new.target` fix-up.
 *
 * Tolerating a foreign copy is the boundary's job, and the boundary is one
 * function wide. Making this guard structural instead would spread that
 * laxness across every call site that only ever sees host-built errors.
 */
export const isPluginError = (error: unknown): error is PluginError => {
    return error instanceof PluginError;
};

/**
 * Whether `value` is a `PluginError` from a *different* copy of this module.
 *
 * See {@link PLUGIN_ERROR_BRAND}. The brand proves the shape, not that the
 * other copy agreed with this one about which codes exist, so
 * {@link toPluginError} still validates every field it reads.
 */
function isForeignPluginError(value: unknown): value is Partial<PluginError> {
    if (typeof value !== 'object' || value === null) return false;
    return (value as Partial<PluginError>)[PLUGIN_ERROR_BRAND] === true;
}

/**
 * Whatever a plugin threw, as a {@link PluginError} this copy owns.
 *
 * This is the boundary function, and the only place tolerant recognition
 * belongs: the host funnels every call into plugin code through one door
 * (`PluginInvoker.invoke`), so a foreign error is adopted exactly once and
 * everything downstream deals only with errors the host itself constructed.
 *
 * Three cases, in order of how much is trusted:
 *
 * 1. Ours: passed straight through, keeping its identity so a `catch` further
 *    up can still recognize the specific subclass that was thrown.
 * 2. Branded but from another copy: rebuilt here, field by field, with the
 *    code checked against {@link PLUGIN_ERROR_CODES}. An unrecognized code
 *    degrades to `fallback` rather than leaking a made-up string into the
 *    host's HTTP mapping, and a non-numeric `retryAfterMs` is dropped rather
 *    than turned into a `Retry-After` header of `NaN`.
 * 3. Anything else: adopted under `fallback`, original kept as the `cause`.
 *
 * The rebuild in case 2 is the same operation that will be needed when plugins
 * move out of process and a failure arrives as JSON rather than as a live
 * object: what changes then is how it is transported, not what it says.
 */
export function toPluginError(error: unknown, fallback: PluginErrorCode = 'internal'): PluginError {
    if (isPluginError(error)) return error;

    if (isForeignPluginError(error)) {
        const known = typeof error.code === 'string' && (PLUGIN_ERROR_CODES as readonly string[]).includes(error.code);
        const message = typeof error.message === 'string' ? error.message : String(error);
        const adopted = new PluginError(message, { cause: error }).withCode(known ? (error.code as PluginErrorCode) : fallback);

        if (typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs)) adopted.withRetry(error.retryAfterMs);
        if (typeof error.upstreamStatus === 'number' && Number.isFinite(error.upstreamStatus)) adopted.withUpstreamStatus(error.upstreamStatus);

        return adopted;
    }

    const message = error instanceof Error ? error.message : String(error);
    return new PluginError(message, { cause: error }).withCode(fallback);
}

/**
 * A caught `unknown` as a sentence, for a message a person reads.
 *
 * `catch` binds `unknown`, so every plugin reporting a failure narrows it before
 * it can say anything — five sites here did, four of them inline. The fallback
 * is not padding: a rejected fetch, a thrown string and an aborted signal all
 * arrive here and only some of them are `Error`.
 *
 * This is NOT error handling and is not a substitute for {@link toPluginError}.
 * It produces a string for a log line or a `testConnection` result, deliberately
 * losing the code, the cause and the retry advice. Anything deciding what to DO
 * about a failure wants the error itself.
 */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
