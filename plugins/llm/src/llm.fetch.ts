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
 */
export function hostFetch(host: PluginHost): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return await host.fetch(urlOf(input), toHostInit(init));
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
