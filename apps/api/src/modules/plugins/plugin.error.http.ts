import { httpError, type HttpError } from '@maroonedsoftware/errors';
import { ErrorCodes, type ErrorCode } from '@deadair/error-codes';
import { toPluginError, type PluginErrorCode } from '@deadair/plugin-sdk';

/**
 * The host half of `PluginError`: it decides what a plugin's vocabulary
 * means over HTTP. The SDK deliberately knows nothing about status codes (it
 * would have to depend on the server framework to say so), so this table is
 * the single place the translation happens.
 */

interface PluginErrorHttpMapping {
    status: 422 | 429 | 500 | 501 | 502 | 503 | 504;
    code: ErrorCode;
}

/**
 * Note what is NOT here: an upstream's status is never forwarded as our own.
 * A provider's 404 stays a 502, because 404 on these routes already means "no
 * plugin by that id" ({@link PluginsService.requireRecord}) and a client that
 * cannot tell those apart will retry the wrong thing forever. The upstream
 * status is a diagnostic; the `code` is what a client branches on.
 */
const HTTP_BY_PLUGIN_CODE: Record<PluginErrorCode, PluginErrorHttpMapping> = {
    auth: { status: 502, code: ErrorCodes.PLUGIN_AUTH_REQUIRED },
    config: { status: 422, code: ErrorCodes.PLUGIN_MISCONFIGURED },
    rate_limited: { status: 429, code: ErrorCodes.PLUGIN_RATE_LIMITED },
    timeout: { status: 504, code: ErrorCodes.PLUGIN_TIMED_OUT },
    unavailable: { status: 503, code: ErrorCodes.PLUGIN_UNAVAILABLE },
    unsupported: { status: 501, code: ErrorCodes.PLUGIN_UNSUPPORTED },
    upstream: { status: 502, code: ErrorCodes.PLUGIN_UPSTREAM_FAILED },
    not_found: { status: 502, code: ErrorCodes.PLUGIN_UPSTREAM_FAILED },
    internal: { status: 500, code: ErrorCodes.PLUGIN_FAILED },
};

/** `Retry-After` is whole seconds, and a sub-second wait still has to say 1. */
const retryAfterSeconds = (retryAfterMs: number): string => String(Math.max(1, Math.ceil(retryAfterMs / 1000)));

/**
 * Turns anything a plugin call threw into the response the operator API should
 * give for it.
 *
 * A plugin that throws a bare `Error` lands on `internal` → 500, which is what
 * it got before `PluginError` existed, so adopting the class is opt-in
 * per plugin rather than a flag day.
 *
 * The upstream status goes to `internalDetails` (logs only) rather than
 * `details`: it is a number from a third party, and putting it in the response
 * invites clients to treat it as ours.
 */
export function pluginHttpError(pluginId: string, error: unknown): HttpError {
    const pluginError = toPluginError(error);
    const mapping = HTTP_BY_PLUGIN_CODE[pluginError.code];

    const failure = httpError(mapping.status).withDetails({
        code: mapping.code,
        message: pluginError.message,
        plugin: pluginId,
        retryable: pluginError.retryable,
    });

    if (pluginError.upstreamStatus !== undefined) {
        failure.withInternalDetails({ plugin: pluginId, pluginErrorCode: pluginError.code, upstreamStatus: pluginError.upstreamStatus });
    }

    // Only on the code that means it: a `Retry-After` on anything else tells a
    // client to back off from a call that was never throttled.
    if (pluginError.code === 'rate_limited' && pluginError.retryAfterMs !== undefined) {
        return failure.withHeaders({ 'Retry-After': retryAfterSeconds(pluginError.retryAfterMs) });
    }

    return failure;
}
