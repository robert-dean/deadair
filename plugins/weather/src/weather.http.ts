import { jsonBody, PluginError, pluginCodeForStatus, retryAfterMs, upstreamDetail, type PluginHost } from '@deadair/plugin-sdk';

/**
 * Everything a provider needs to reach its service, as one value.
 *
 * The host, plus how this station identifies itself. Bundled rather than passed
 * as two parameters because the second is optional, applies to every request the
 * plugin makes, and is the sort of thing that gets added to three call sites and
 * forgotten at the fourth — which for the National Weather Service means being
 * refused, since it asks callers to say who they are.
 */
export interface Service {
    host: PluginHost;
    /**
     * What to send as `User-Agent`, when the operator has given a contact.
     *
     * Absent means the host's own default (`<plugin id>/<version> (deadair)`),
     * which identifies the software but names nobody to write to.
     */
    userAgent?: string;
}

/**
 * A GET whose answer is JSON, with every way of failing already decided.
 *
 * All three services are read through this, which is what keeps the
 * `Retry-After` handling, the identifying header and the body-cancellation in
 * one place rather than in nine.
 *
 * @param name - What to call the service in a message an operator reads.
 * @param hint - Turns a status into the sentence the status alone does not explain.
 */
export async function fetchJson(
    service: Service,
    url: string,
    options: { accept?: string; name: string; timeoutMs: number; hint?: (status: number) => string | undefined },
): Promise<unknown> {
    const response = await service.host.fetch(url, {
        timeoutMs: options.timeoutMs,
        headers: {
            Accept: options.accept ?? 'application/json',
            ...(service.userAgent === undefined ? {} : { 'User-Agent': service.userAgent }),
        },
    });

    if (!response.ok) await refuseResponse(response, options.name, options.hint?.(response.status));

    return await jsonBody<unknown>(response);
}

/**
 * What a bad status from a service means, once for all three of them.
 *
 * The status ladder is `plugin.http.ts`'s unmodified, and the reason to route
 * every service through one function is the `Retry-After`: OpenWeatherMap is
 * metered, so a 429 whose advice is not carried is a plugin that asks again
 * straight away and gets quarantined by the host's own breaker.
 *
 * The body is cancelled rather than read. It is an error page nobody wants
 * quoted, and reading it spends from the same budget a retry would want.
 *
 * @param hint - Something the status alone does not explain, for the operator's log.
 */
export async function refuseResponse(response: Response, service: string, hint?: string): Promise<never> {
    await response.body?.cancel();

    const detail = upstreamDetail(response.status, response.statusText);
    const error = new PluginError(`${service} answered ${detail}${hint === undefined ? '' : ` (${hint})`}`).withCode(
        pluginCodeForStatus(response.status),
    );
    error.upstreamStatus = response.status;

    const advice = retryAfterMs(response.headers.get('retry-after'));
    if (advice !== undefined) error.withRetry(advice);

    throw error;
}

/**
 * Budget below which a read is not worth starting.
 *
 * The point of {@link PluginHost.remainingMs} rather than a fixed timeout: a
 * background walk runs on a far longer deadline than a break the model is
 * waiting on, and being cut off mid-request costs the request and leaves nothing
 * to show for it. Checked before starting one rather than after.
 *
 * It is checked ONCE, before the first request of a read, even though two of the
 * three engines then make three or four. Bounding each hop separately would be
 * arithmetic over a deadline the host already enforces: `host.fetch` caps its own
 * timeout by whatever is left, so a read that runs out of budget fails on the hop
 * that ran out rather than being allowed to overrun.
 */
export const hasBudget = (host: PluginHost, needed: number): boolean => host.remainingMs() >= needed;
