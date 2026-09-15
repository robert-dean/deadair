import { createSdkFetch, DeadairSdk, type SdkFetch } from '@deadair/sdk';

import type { Station } from './station.settings.js';

/**
 * How long one request may take before the station counts as not answering.
 *
 * The SDK sets no deadline of its own, and Node's `fetch` waits minutes for a host that accepted the
 * connection and then said nothing. A key showing a reading from a minute ago as though it were
 * current is the thing the stale marker exists to prevent, and it can only say "stale" once a request
 * has actually given up.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The station's SDK, asking as the plugin with the operator's key.
 *
 * The one place the key is put on a request, so there is one place to check that nothing else reads
 * it. The User-Agent names the plugin, which is what makes its requests readable in the station's
 * logs among the console's and the listener apps'.
 */
export function createStationSdk(station: Station, userAgent: string): DeadairSdk {
    return sdkFor(station.apiBase, { Authorization: `Bearer ${station.apiKey}`, 'User-Agent': userAgent });
}

/**
 * The station's SDK with no key, for the one route that needs none (`GET /nowplaying`). The settings
 * check asks it first, because an answer there proves the ADDRESS whatever is wrong with the key.
 */
export function createPublicSdk(apiBase: string, userAgent: string): DeadairSdk {
    return sdkFor(apiBase, { 'User-Agent': userAgent });
}

function sdkFor(apiBase: string, headers: Record<string, string>): DeadairSdk {
    const base = createSdkFetch({ baseUrl: apiBase, headers });
    const timed: SdkFetch = (url, init) => base(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return new DeadairSdk({ baseUrl: apiBase, fetch: timed });
}
