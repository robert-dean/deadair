/**
 * Chart ids, qualified by the plugin that offered them.
 *
 * A {@link ChartDescriptor.id} is scoped to its own plugin and needs to be
 * unique only there, which is the right contract for a plugin author and the
 * wrong one for everything outside: two services will both call something
 * `top-100`, and a bare id then names a different chart depending on which
 * plugin happens to answer first. So the host qualifies every id before it
 * leaves {@link ChartsService}, and splits it back on the way in.
 *
 * Pure and separate from the service because the round trip is the whole
 * correctness question here and it is worth table-testing without a plugin
 * registry in the way.
 */

/**
 * The separator, and it cannot appear in a plugin id.
 *
 * `pluginManifestSchema` holds an id to lowercase alphanumerics, dashes and
 * dots, so a colon is unambiguous on the left. It is NOT excluded on the right,
 * which is why {@link splitChartId} splits at the first one rather than the
 * last: a plugin is entitled to a chart called `geo:gb`, and losing its prefix
 * would ask the wrong plugin for it.
 */
const SEPARATOR = ':';

/** `deadair.lastfm` + `top-100` -> `deadair.lastfm:top-100`. */
export const qualifyChartId = (pluginId: string, chartId: string): string => `${pluginId}${SEPARATOR}${chartId}`;

/** The two halves of a qualified id, or `undefined` when it is not one. */
export interface ChartAddress {
    pluginId: string;
    chartId: string;
}

/**
 * Reads a qualified id back apart.
 *
 * `undefined` for anything that is not one — no separator, or an empty half —
 * because the caller's next move is the same in every case: answer with nothing
 * rather than guess which plugin was meant.
 */
export function splitChartId(qualified: string): ChartAddress | undefined {
    const at = qualified.indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const pluginId = qualified.slice(0, at);
    const chartId = qualified.slice(at + SEPARATOR.length);
    if (chartId.length === 0) return undefined;

    return { pluginId, chartId };
}
