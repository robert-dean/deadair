import { PluginError, errorText, type PluginErrorCode } from '@deadair/plugin-sdk';
import { APICallError } from 'ai';

/**
 * How much of a provider's own sentence to keep. Enough for "You exceeded your current quota…" and
 * the model it names; not so much that a provider answering with an HTML error page fills a log line.
 */
const MAX_DETAIL_CHARS = 300;

/** An upstream status in the host's vocabulary. See `HTTP_BY_PLUGIN_CODE` on the host for what each one becomes. */
function codeForStatus(status: number): PluginErrorCode {
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 503 || status === 529) return 'unavailable';
    if (status === 408 || status === 504) return 'timeout';
    return 'upstream';
}

/**
 * The fault a provider put on the stream, as something that says what it was.
 *
 * Needed because the SDK does not surface it. With `maxRetries: 0` a refused request arrives as an
 * `error` part, the SDK's step recorder flushes with nothing recorded, and every result promise
 * rejects with a generic `NoOutputGeneratedError` ("No output generated. Check the stream for
 * errors.") that carries neither the status nor the body. Every Gemini failure on a live station read
 * exactly that, a quota refusal and an overloaded model alike, so nobody could tell which. The
 * original is kept as the `cause`.
 */
export function generationError(provider: string, error: unknown): PluginError {
    if (APICallError.isInstance(error) && error.statusCode !== undefined) {
        const detail = error.message.trim().slice(0, MAX_DETAIL_CHARS);
        return new PluginError(`provider "${provider}" answered HTTP ${error.statusCode}: ${detail}`, { cause: error })
            .withCode(codeForStatus(error.statusCode))
            .withUpstreamStatus(error.statusCode);
    }

    return new PluginError(`provider "${provider}" failed: ${errorText(error)}`, { cause: error }).withCode('upstream');
}
