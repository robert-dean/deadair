import { PluginError, headersToRecord, hostFetchMethod, type HostFetchInit, type HostFetchMethod, type PluginHost } from '@deadair/plugin-sdk';

/**
 * `host.fetch` in the shape the AI SDK wants.
 *
 * ## Why this exists rather than passing `host.fetch` straight in
 *
 * The two signatures nearly agree and not quite. The platform's `fetch` takes
 * `RequestInfo | URL` and a full `RequestInit`; `host.fetch` takes a string URL
 * and the JSON-safe subset of an init, because it is the one egress the host
 * polices and it will not carry things it cannot inspect.
 *
 * So this is a narrowing, and the narrowing is the point: everything the SDK
 * sends goes through the host's allowlist, per-upstream rate limit, redirect
 * re-check and body bounds. Handing the SDK a global `fetch` instead would be
 * one line shorter and would opt a model call out of all four.
 *
 * ## What it refuses
 *
 * A `Request` object, or a body that is not a string. Neither is something the
 * OpenAI-compatible provider produces (it builds a URL and a JSON string), and
 * both would have to be buffered or unwrapped to cross `host.fetch` at all.
 * Failing loudly means a provider that starts doing either is a clear error on
 * the first call rather than a subtly dropped body.
 */

/**
 * A `fetch` the AI SDK can be handed, backed by the host's.
 *
 * Bound to the host rather than reading it per call, so a provider built at load
 * time keeps working without reaching back through `this`.
 *
 * ## The generation gets the whole call's budget, and it has to
 *
 * `host.fetch` bounds getting the RESPONSE — connect, headers, the redirect chain — and defaults
 * that to ten seconds when a plugin does not say. Ten seconds is a sensible default for an API that
 * answers, and it is the wrong one for this: a self-hosted model that has to load weights into VRAM
 * before it emits its first token routinely spends longer than that before the response begins, and
 * the call died on a station whose model host is a machine on the LAN — `POST … timed out after
 * 10000ms`, reported upward as a model that named no records, which is indistinguishable from a
 * model that declined.
 *
 * So the budget asked for is whatever the invocation has LEFT, which is the honest answer to "how
 * long may this take": the host caps it at exactly that anyway (`Math.min(timeoutMs, ceilingMs)`),
 * a background refill carries minutes of it, and a break writer carries the seconds it is allowed
 * before the floor writes instead. Reading it per call rather than once is the point — the same
 * provider object serves both callers, and the second tool round of a conversation has less left
 * than the first.
 *
 * Note this bounds the response ARRIVING and not the answer streaming, which the host bounds
 * separately with its own body idle and lifetime limits.
 */
export function hostFetch(host: PluginHost): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return await host.fetch(urlOf(input), { ...toHostInit(init), timeoutMs: host.remainingMs() });
    }) as typeof fetch;
}

/** The target as a string, or a clear refusal. */
function urlOf(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();

    throw new PluginError('the model provider asked for a Request object, which the host fetch cannot carry').withCode('internal');
}

/** The SDK's init as the host's, dropping nothing silently. */
function toHostInit(init: RequestInit | undefined): HostFetchInit {
    if (init === undefined) return {};

    const hostInit: HostFetchInit = {};

    if (init.method !== undefined) {
        const method = init.method.toUpperCase();
        const match = hostFetchMethod(method);
        if (!match) {
            throw new PluginError(`the model provider asked for HTTP ${method}, which the host fetch does not offer`).withCode('internal');
        }
        hostInit.method = match;
    }

    const headers = toHeaderRecord(init.headers);
    if (headers !== undefined) hostInit.headers = headers;

    if (init.body !== undefined && init.body !== null) {
        if (typeof init.body !== 'string') {
            throw new PluginError('the model provider sent a non-string body, which the host fetch cannot carry').withCode('internal');
        }
        hostInit.body = init.body;
    }

    // Composed with the host's own deadline rather than replacing it, which is
    // what `host.fetch` does with this. Passing it on matters because the SDK
    // hangs its own cancellation here, and dropping it would leave a generation
    // that was abandoned upstream still holding a socket.
    if (init.signal !== undefined && init.signal !== null) hostInit.signal = init.signal;

    return hostInit;
}

/**
 * Headers in any of the three shapes the platform allows, as a plain record.
 *
 * A `Headers` instance has already lower-cased its names and joined repeats,
 * which is the behaviour to want here: the host's own header handling wants one
 * value per name.
 */
function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
    if (headers === undefined) return undefined;

    const record: Record<string, string> = {};

    if (headers instanceof Headers) {
        return headersToRecord(headers);
    }

    if (Array.isArray(headers)) {
        for (const [name, value] of headers) {
            if (name !== undefined && value !== undefined) record[name.toLowerCase()] = value;
        }
        return record;
    }

    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) record[name.toLowerCase()] = value;
    }
    return record;
}
