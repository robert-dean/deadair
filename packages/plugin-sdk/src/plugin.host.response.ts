/**
 * Sugar over the `Response` that `host.fetch` hands back.
 *
 * Free functions rather than a `Response` subclass with methods, because
 * `host.fetch` returns the platform's own `Response` and a plugin has to be
 * able to pass it to any library that takes one. Anything that made it a
 * special response would take that away for the sake of dot notation.
 *
 * What they buy over `await response.json()` is the error. The common failure
 * is an API answering 200 with an HTML error page or a rate-limit notice, and
 * `Unexpected token < in JSON at position 0` says nothing about which call did
 * it.
 */

/** How much of an unparseable body to quote back. Enough to identify it, not enough to fill a log line. */
const BODY_SNIPPET_LENGTH = 120;

const snippet = (body: string): string => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return '<empty body>';
    return trimmed.length <= BODY_SNIPPET_LENGTH ? trimmed : `${trimmed.slice(0, BODY_SNIPPET_LENGTH)}…`;
};

/**
 * The body parsed as JSON.
 *
 * Throws when it is not JSON, with the status, the URL and the start of the
 * body in the message. That detail is the point, and it is why this reads the
 * body as text and parses that rather than calling `response.json()`: the text
 * is what names what the server actually sent.
 *
 * A body that fails to READ rather than to parse (over the host's byte cap, a
 * socket that went quiet) rejects with the host's own `PluginError` untouched.
 * That is a different failure from a body that arrived and was not JSON, and
 * relabelling it would lose the code the caller branches on.
 *
 * Note this does not check `response.ok`. A 4xx with a JSON error body is worth
 * parsing, so deciding what a bad status means is left to the caller.
 */
export async function jsonBody<T>(response: Response): Promise<T> {
    const text = await response.text();
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`expected JSON from ${response.url} (HTTP ${response.status}) but got ${snippet(text)}: ${reason}`, { cause: error });
    }
}

/**
 * {@link jsonBody}, but `undefined` instead of a throw when the body will not
 * parse. For the callers that treat an unparseable body the same as a missing
 * one and have nothing useful to add to the error.
 *
 * A body that fails to read still rejects, for the reason above: the host
 * refusing an oversized body is not the same event as a server answering with
 * something that is not JSON, and swallowing the first would report a
 * misconfiguration as an empty result.
 */
export async function tryJsonBody<T>(response: Response): Promise<T | undefined> {
    const text = await response.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}
