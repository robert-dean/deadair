import type { Logger } from '@maroonedsoftware/logger';
import type { PluginInvoker } from './plugin.invoker.js';

/**
 * Items per page.
 *
 * Spotify caps playlist reads at 50 and clamps anything larger, so asking for
 * more buys nothing and makes the offsets lie. The playlist read and the catalog
 * walk used to declare this separately, with one of the two comments saying it
 * was the same value as the other for the same reason.
 */
export const PLUGIN_PAGE_SIZE = 50;

/**
 * Pages one plugin may serve before the caller gives up on it.
 *
 * Termination depends on the provider honouring `offset`, which is a promise
 * made by code the host does not own: one that ignores it returns page one
 * forever and the walk never ends on its own. 200 pages is 10,000 items, far
 * past any real playlist or library, and finite.
 */
export const PLUGIN_MAX_PAGES = 200;

/** Which call is being paged, and what an operator should be told if it is cut short. */
export interface PluginPageRequest {
    pluginId: string;
    /** The capability method, e.g. `catalog.listPlaylists`. Passed to the invoker and logged. */
    op: string;
    /** What may be missing if the cap is hit, as a noun phrase: `this list`, `its catalog`. */
    incomplete: string;
    /** Checked between pages, so a shutdown stops within one page rather than one walk. */
    signal?: AbortSignal;
    /**
     * That this walk stopped at {@link PLUGIN_MAX_PAGES} rather than at the end of the data.
     *
     * A caller that only wants the items it got does not pass one, and the warn below is all that
     * happens — which is what the playlist read wants, since a very long list read up to the cap is
     * still a useful answer to draw. A caller that DECIDES something from having seen everything
     * has to know, because from the outside a truncated walk and a complete one are the same
     * generator finishing quietly: the catalog sweep read one as the other and would have retired
     * every binding past page 200.
     */
    onTruncated?: () => void;
}

/**
 * Offset pagination over a plugin call, stopping at the first short page.
 *
 * Every page goes through {@link PluginInvoker}, which is what keeps a hanging
 * plugin from becoming a hanging job: the deadline and the failure breaker both
 * apply per page rather than to the walk as a whole.
 *
 * A short page means the end. A full page yielding nothing new would still
 * advance the offset, so the only way this fails to terminate is a provider that
 * ignores `offset` entirely — which {@link PLUGIN_MAX_PAGES} covers, LOUDLY,
 * because silently truncating a library looks exactly like a successful sync.
 * A warn was the whole of "loudly" for as long as this existed, and a log line is
 * not something a caller can act on: see {@link PluginPageRequest.onTruncated}.
 *
 * A generator rather than an array because the catalog walk streams items into a
 * resolver as they arrive; a caller that wants them all at once collects it.
 */
export async function* pluginPages<T>(
    invoker: PluginInvoker,
    logger: Logger,
    request: PluginPageRequest,
    fetch: (offset: number) => Promise<T[]>,
): AsyncGenerator<T> {
    for (let page = 0; page < PLUGIN_MAX_PAGES; page++) {
        if (request.signal?.aborted) return;

        const items = await invoker.invoke(request.pluginId, request.op, async () => fetch(page * PLUGIN_PAGE_SIZE));
        for (const item of items) yield item;
        if (items.length < PLUGIN_PAGE_SIZE) return;
    }

    request.onTruncated?.();
    logger.warn(`stopped paging a plugin at the page cap; ${request.incomplete} may be incomplete`, {
        plugin: request.pluginId,
        op: request.op,
        cap: PLUGIN_MAX_PAGES,
    });
}
