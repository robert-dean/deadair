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
 * Pages one plugin may serve before a walk that did not choose its own cap gives up on it.
 *
 * 200 pages is 10,000 items. That is the right ceiling for a walk that collects everything into one
 * response, which is what the console's playlist read does: a list longer than that is still a useful
 * answer read up to the cap, and a hundred thousand rows is not one a page can draw.
 *
 * It was once also the ceiling on the catalog sync, on the argument that 10,000 items was "far past any
 * real library". A terabyte of music is ten times that, and the sync stopped at the first 10,000 tracks
 * the provider handed over, which for a Subsonic server is the start of the alphabet. The sync chooses
 * its own cap now ({@link PluginPageRequest.maxPages}). A provider that ignores `offset` no longer needs a
 * low cap to be caught, because the walk notices the repeated page (see {@link pluginPages}).
 */
export const PLUGIN_MAX_PAGES = 200;

/** Which call is being paged, and what an operator should be told if it is cut short. */
export interface PluginPageRequest<T = unknown> {
    pluginId: string;
    /** The capability method, e.g. `catalog.listPlaylists`. Passed to the invoker and logged. */
    op: string;
    /** What may be missing if the cap is hit, as a noun phrase: `this list`, `its catalog`. */
    incomplete: string;
    /** Checked between pages, so a shutdown stops within one page rather than one walk. */
    signal?: AbortSignal;
    /** The most pages this walk reads. {@link PLUGIN_MAX_PAGES} when absent. */
    maxPages?: number;
    /**
     * What identifies an item, for telling a repeated page from a new one. The whole item as JSON when
     * absent. A caller whose items carry an id passes it: a provider that ignores `offset` but signs
     * an image URL afresh on every call serves pages that are never the same JSON, and would then be
     * stopped only by the cap.
     */
    keyOf?: (item: T) => string;
    /**
     * That this walk stopped before the end of the data: at its page cap, or at a provider that served
     * the same full page twice.
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
 * A short page means the end. A provider that ignores `offset` never serves one: it returns page one
 * forever. That provider is caught where it shows, at the first full page identical to the one before
 * it, which no provider that honours `offset` can produce because no two of its pages hold the same
 * items. (A playlist holding one record fifty times in a row twice over would read as a repeat too; that
 * fails safe, as a truncation, and says why in the warn.) The repeat is not yielded, and the walk ends as truncated, LOUDLY, because silently cutting a
 * library short looks exactly like a successful sync. The page cap stays as the backstop for a
 * provider that ignores `offset` in some way that does not repeat. A warn was the whole of "loudly"
 * for as long as this existed, and a log line is not something a caller can act on: see
 * {@link PluginPageRequest.onTruncated}.
 *
 * A generator rather than an array because the catalog walk streams items into a
 * resolver as they arrive; a caller that wants them all at once collects it.
 */
export async function* pluginPages<T>(
    invoker: PluginInvoker,
    logger: Logger,
    request: PluginPageRequest<T>,
    fetch: (offset: number) => Promise<T[]>,
): AsyncGenerator<T> {
    const maxPages = request.maxPages ?? PLUGIN_MAX_PAGES;
    let previous: string | undefined;

    for (let page = 0; page < maxPages; page++) {
        if (request.signal?.aborted) return;

        const items = await invoker.invoke(request.pluginId, request.op, async () => fetch(page * PLUGIN_PAGE_SIZE));
        if (items.length < PLUGIN_PAGE_SIZE) {
            for (const item of items) yield item;
            return;
        }

        const signature = request.keyOf ? items.map(request.keyOf).join('\n') : JSON.stringify(items);
        if (signature === previous) {
            request.onTruncated?.();
            logger.warn(`stopped paging a plugin that served the same page twice; ${request.incomplete} may be incomplete`, {
                plugin: request.pluginId,
                op: request.op,
                page,
            });
            return;
        }
        previous = signature;
        for (const item of items) yield item;
    }

    request.onTruncated?.();
    logger.warn(`stopped paging a plugin at the page cap; ${request.incomplete} may be incomplete`, {
        plugin: request.pluginId,
        op: request.op,
        cap: maxPages,
    });
}
