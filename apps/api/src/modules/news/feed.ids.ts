/**
 * Feed ids, qualified by the plugin that offered them.
 *
 * A {@link NewsFeedDescriptor.id} is scoped to its own plugin and needs to be
 * unique only there, which is the right contract for a plugin author and the
 * wrong one for everything outside: two services will both call something
 * `world`, and a bare id then names a different feed depending on which plugin
 * happens to answer first. So the host qualifies every id before it leaves
 * {@link NewsService}, and splits it back on the way in.
 *
 * The same pair `chart.ids.ts` holds, kept separate rather than shared: they
 * agree today by both being obvious, and folding them together would make a
 * change to one a change to the other. Pure, because the round trip is the
 * whole correctness question and is worth table-testing with no registry in the
 * way.
 */

/**
 * The separator, and it cannot appear in a plugin id.
 *
 * `pluginManifestSchema` holds an id to lowercase alphanumerics, dashes and
 * dots, so a colon is unambiguous on the left. It is NOT excluded on the right,
 * which is why {@link splitFeedId} splits at the first one rather than the
 * last: a plugin is entitled to a feed called `geo:gb`, and losing its prefix
 * would ask the wrong plugin for it.
 */
const SEPARATOR = ':';

/** `deadair.rss` + `world` -> `deadair.rss:world`. */
export const qualifyFeedId = (pluginId: string, feedId: string): string => `${pluginId}${SEPARATOR}${feedId}`;

/** The two halves of a qualified id, or `undefined` when it is not one. */
export interface FeedAddress {
    pluginId: string;
    feedId: string;
}

/**
 * Reads a qualified id back apart.
 *
 * `undefined` for anything that is not one — no separator, or an empty half —
 * because the caller's next move is the same in every case: answer with nothing
 * rather than guess which plugin was meant.
 */
export function splitFeedId(qualified: string): FeedAddress | undefined {
    const at = qualified.indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const pluginId = qualified.slice(0, at);
    const feedId = qualified.slice(at + 1);

    return feedId.length > 0 ? { pluginId, feedId } : undefined;
}
