/**
 * Show ids, qualified by the plugin that offered them.
 *
 * A {@link PodcastShow.id} is scoped to its own plugin and needs to be unique only there, which is
 * the right contract for a plugin author and the wrong one for everything outside: the station keeps
 * episodes and a clock band names a show by this id, and two plugins may well mint the same short
 * one. So the host qualifies every id before it leaves {@link PodcastsService}, and splits it back on
 * the way in.
 *
 * The same pair `news/feed.ids.ts` and `charts/chart.ids.ts` hold, kept separate rather than shared
 * for the reason those two give: they agree today by all being obvious, and folding them together
 * would make a change to one a change to the others. Pure, because the round trip is the whole
 * correctness question.
 */

/**
 * The separator. It cannot appear in a plugin id (`pluginManifestSchema` holds one to lowercase
 * alphanumerics, dashes and dots), so the FIRST one is always the split, and a plugin may use a colon
 * in its own show ids.
 */
const SEPARATOR = ':';

/** `deadair.podcast` + `73b7fb89` -> `deadair.podcast:73b7fb89`. */
export const qualifyShowId = (pluginId: string, showId: string): string => `${pluginId}${SEPARATOR}${showId}`;

/** The two halves of a qualified id. */
export interface ShowAddress {
    pluginId: string;
    showId: string;
}

/**
 * Reads a qualified id back apart, or `undefined` when it is not one.
 *
 * The caller's next move is the same for every way this fails: answer with nothing rather than guess
 * which plugin was meant.
 */
export function splitShowId(qualified: string): ShowAddress | undefined {
    const at = qualified.indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const pluginId = qualified.slice(0, at);
    const showId = qualified.slice(at + 1);

    return showId.length > 0 ? { pluginId, showId } : undefined;
}
