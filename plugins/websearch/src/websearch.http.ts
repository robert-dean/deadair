import { PluginError, pluginCodeForStatus, retryAfterMs, upstreamDetail, type PluginHost } from '@deadair/plugin-sdk';

/**
 * What a bad status from an engine means, once for all three of them.
 *
 * The status ladder is `plugin.http.ts`'s unmodified, and the reason to route
 * every engine through one function is the `Retry-After`: Brave and Tavily are
 * metered, so a 429 that arrives without its advice being carried is a plugin
 * that will be quarantined by the host's own breaker for asking again straight
 * away.
 *
 * The body is cancelled rather than read. It is an error page nobody wants
 * quoted, and reading it spends from the same budget a retry would want.
 *
 * @param hint - Something the status alone does not explain, for the operator's log.
 */
export async function refuseResponse(response: Response, engine: string, hint?: string): Promise<never> {
    await response.body?.cancel();

    const detail = upstreamDetail(response.status, response.statusText);
    const error = new PluginError(`${engine} answered ${detail}${hint === undefined ? '' : ` (${hint})`}`).withCode(
        pluginCodeForStatus(response.status),
    );
    error.upstreamStatus = response.status;

    const advice = retryAfterMs(response.headers.get('retry-after'));
    if (advice !== undefined) error.withRetry(advice);

    throw error;
}

/**
 * Budget below which a request is not worth starting.
 *
 * The point of {@link PluginHost.remainingMs} rather than a fixed timeout: a
 * background enrichment walk runs on a far longer deadline than a break the
 * model is waiting on, and being cut off mid-request costs the request and
 * leaves nothing to show for it. Checked before starting one rather than after.
 */
export const hasBudget = (host: PluginHost, needed: number): boolean => host.remainingMs() >= needed;
