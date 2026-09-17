import { PluginError, headersToRecord, hostFetchMethod } from '@deadair/plugin-sdk';
import type { HostFetchInit, PluginHost } from '@deadair/plugin-sdk';

import { REQUEST_TIMEOUT_MS } from './ytmusic.manifest.js';

/** The fetch shape `Innertube.create({ fetch })` calls: the standard one, so it takes all three input forms. */
export type InnertubeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const isRequest = (input: RequestInfo | URL): input is Request => typeof Request !== 'undefined' && input instanceof Request;

/** The url, whichever of the three forms it arrived as. */
const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

/**
 * Adapts `host.fetch` into the fetch `youtubei.js` calls internally, so every byte of traffic still
 * passes through the host: the manifest's hostname allowlist, its rate limiter, its shared request
 * deadline and its SSRF-safe redirect handling all keep applying.
 *
 * Routing the library through here rather than letting it reach global `fetch` is the whole
 * difference between an honest manifest and a decorative one. The plugin runs in the host's own
 * realm, so nothing stops it going around. It was measured before it was relied on: with global
 * `fetch` replaced by a function that throws, a session, a search, two pages of continuations, a
 * playlist read and a `getInfo` all still completed.
 *
 * Two shapes the Spotify bridge beside this one never has to deal with, both observed:
 *
 * - The request arrives as a `Request` OBJECT rather than a string url, and on the same call `init`
 *   carries the body. So neither can be read alone. `init` wins where both speak, which is what
 *   `fetch` itself does.
 * - `HostFetchInit.body` is a string only, and `youtubei.js` depends on `@bufbuild/protobuf`, so a
 *   binary body was the plausible way this could not work at all. It does not arise: continuation
 *   tokens are protobuf built in memory and then base64'd into the JSON body. The guard below is
 *   therefore a guard. If a future version does send bytes, it says so loudly rather than
 *   truncating a body into nonsense and leaving a parser error to explain it.
 */
export function createHostFetch(host: PluginHost): InnertubeFetch {
    return async (input, init) => {
        const url = urlOf(input);
        const request = isRequest(input) ? input : undefined;

        const method = hostFetchMethod(init?.method ?? request?.method);
        if (!method)
            throw new PluginError(`YouTube Music fetch bridge received an unsupported method: ${init?.method ?? request?.method}`).withCode(
                'internal',
            );

        const body = init?.body ?? (request?.body === null ? undefined : await request?.clone().text());
        if (body !== undefined && typeof body !== 'string') {
            throw new PluginError('YouTube Music fetch bridge only supports string request bodies').withCode('internal');
        }

        const hostInit: HostFetchInit = {
            method,
            // The Request's headers underneath, whatever `init` adds on top.
            headers: { ...headersToRecord(new Headers(request?.headers)), ...headersToRecord(new Headers(init?.headers)) },
            body,
            timeoutMs: REQUEST_TIMEOUT_MS,
        };

        // Straight through: `host.fetch` answers with a real `Response`, which is what the library
        // expects back. Rebuilding one field by field is how a 204 with no body becomes a throw.
        return await host.fetch(url, hostInit);
    };
}
