/**
 * Series ids, qualified by the plugin that offered them.
 *
 * `podcasts/show.ids.ts`'s pair, one capability over and for the same reason: a
 * {@link NarrationSeries.id} is scoped to its own plugin, which is the right contract for a plugin
 * author and the wrong one for everything outside: the station keeps pieces and a clock band names
 * a series by this id, and two plugins may well mint the same short one.
 *
 * Kept as its own copy rather than shared with `show.ids.ts`, `feed.ids.ts` and `chart.ids.ts`, on
 * the reason those three already give each other: they agree today by all being obvious, and folding
 * them together would make a change to one a change to all of them.
 */

/**
 * The separator. It cannot appear in a plugin id (`pluginManifestSchema` holds one to lowercase
 * alphanumerics, dashes and dots), so the FIRST one is always the split, and a plugin may use a colon
 * in its own series ids.
 */
const SEPARATOR = ':';

/** `deadair.audiobook` + `frankenstein` -> `deadair.audiobook:frankenstein`. */
export const qualifySeriesId = (pluginId: string, seriesId: string): string => `${pluginId}${SEPARATOR}${seriesId}`;

/** The two halves of a qualified id. */
export interface SeriesAddress {
    pluginId: string;
    seriesId: string;
}

/**
 * Reads a qualified id back apart, or `undefined` when it is not one.
 *
 * The caller's next move is the same for every way this fails: answer with nothing rather than guess
 * which plugin was meant.
 */
export function splitSeriesId(qualified: string): SeriesAddress | undefined {
    const at = qualified.indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const pluginId = qualified.slice(0, at);
    const seriesId = qualified.slice(at + 1);

    return seriesId.length > 0 ? { pluginId, seriesId } : undefined;
}
