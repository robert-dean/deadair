import type { HostFetchMethod } from './plugin.host.js';
import type { PluginErrorCode } from './plugin.error.js';

/**
 * The pieces every plugin that talks to an HTTP upstream was writing for itself.
 *
 * Four clients here wrap `host.fetch` the same way — check the status, turn it
 * into a {@link PluginErrorCode}, pull the upstream's own sentence out of the
 * body, and throw something carrying both. The WRAPPER is not shared, because
 * each one throws its own error type and each branches on its own service's
 * quirks. What is shared is underneath it: the rows of the status ladder that
 * mean the same thing everywhere, the truncation, the `Retry-After` parse, and
 * the defensive dig into a JSON error body.
 *
 * Deliberately not here: retry and pacing. A plugin declares its rate limit on
 * its manifest and `host.fetch` applies it, so no plugin implements a backoff
 * and none should start.
 */

/** How long an upstream's own sentence may be before it is cut. */
const MAX_UPSTREAM_MESSAGE = 200;

/**
 * An upstream's sentence, bounded.
 *
 * An error body is untrusted text that ends up in a log line and on a settings
 * card, so its length is not the upstream's decision to make. Three clients cut
 * it at the same 200 characters with the same ellipsis.
 */
export function truncateUpstreamMessage(message: string): string {
    return message.length > MAX_UPSTREAM_MESSAGE ? `${message.slice(0, MAX_UPSTREAM_MESSAGE)}…` : message;
}

/**
 * A string field out of a JSON error body, or `undefined`.
 *
 * Defensive on purpose, and in a specific way: the body is whatever the edge
 * happened to send — an HTML page from a proxy, an empty 429, a truncated
 * response — so a failed parse has to read as "said nothing" rather than throw
 * inside the code that was already handling a failure. An empty string is also
 * nothing, since it would otherwise print as a blank reason.
 *
 * @param body - The raw response body. `undefined` when it was never read.
 * @param pick - Reaches the field. Runs on `unknown`, so it casts; anything it
 *   returns that is not a non-empty string is discarded.
 */
export function upstreamField(body: string | undefined, pick: (parsed: unknown) => unknown): string | undefined {
    if (!body) return undefined;

    let value: unknown;
    try {
        value = pick(JSON.parse(body));
    } catch {
        return undefined;
    }

    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * `Retry-After` in whole seconds, as milliseconds.
 *
 * Only the seconds form is read. The HTTP-date form is legal and no upstream
 * here sends it, and guessing wrong would tell the host to sit out a wait that
 * was never asked for. Anything unparseable or negative means "no advice
 * given", which is different from "wait zero".
 *
 * Takes `null` as well as `undefined` because one caller reads it off a
 * `Headers` (which answers `null`) and another off a record (which answers
 * `undefined`).
 */
export function retryAfterMs(header: string | null | undefined): number | undefined {
    if (header === null || header === undefined) return undefined;

    const seconds = Number(header.trim());
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;

    return seconds * 1000;
}

/**
 * The rows of the status ladder that mean the same thing at every upstream.
 *
 * A plugin layers its own service's readings in FRONT of this rather than
 * replacing it, because the deviations are the interesting part and each one is
 * a decision worth writing down beside the plugin it belongs to. Spotify reads
 * 401 as `auth` and 403 as `forbidden`; MusicBrainz reads a 503 carrying a
 * `Retry-After` as `rate_limited`; the two token-authenticated services read
 * 401 as `config`, because a pasted token is a setting. None of those belongs
 * here.
 *
 * What does belong here is the part nobody disagrees about: a 404 is a missing
 * thing, a 429 is going too fast, any other 5xx is the upstream being down, and
 * everything else is the upstream saying something unhelpful.
 */
export function pluginCodeForStatus(status: number): PluginErrorCode {
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'unavailable';

    return 'upstream';
}

/**
 * A one-line summary of a failed response, for a message a human reads.
 *
 * The status is always there; the other two often are not, and an upstream that
 * sent neither should not produce a line with holes in it.
 */
export function upstreamDetail(status: number, statusText?: string, reason?: string): string {
    return [`HTTP ${status}`, statusText, reason].filter(part => part).join(' ');
}

/** The methods `host.fetch` will carry. */
export const HOST_FETCH_METHODS: readonly HostFetchMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/**
 * A method name as one `host.fetch` accepts, or `undefined` if it is not one.
 *
 * Answers rather than throws, because the two callers refuse in different words
 * and to different audiences — one is telling a plugin author that the AI SDK
 * asked for something impossible, the other is a bridge reporting its own bug —
 * and a shared throw would have flattened both into one message.
 */
export function hostFetchMethod(method: string | undefined): HostFetchMethod | undefined {
    const upper = (method ?? 'GET').toUpperCase();

    return HOST_FETCH_METHODS.find(candidate => candidate === upper);
}

/**
 * Headers as the plain lower-cased record `HostFetchInit.headers` takes.
 *
 * A `Headers` instance has already lower-cased its names and joined repeats,
 * which is the behaviour to want: the host's header handling carries one value
 * per name. Lower-casing again is free and makes the guarantee local.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};

    headers.forEach((value, name) => {
        record[name.toLowerCase()] = value;
    });

    return record;
}
