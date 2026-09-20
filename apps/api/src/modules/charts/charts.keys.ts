/**
 * The station settings this module reads.
 *
 * Declared in `settings.registry.ts` and read here, which is the split every
 * module keeps: the registry owns the form and the defaults, and the typed
 * resolver lives beside the code that acts on it. There is one key, and it is
 * here rather than inlined at the registry because the pairing in
 * `plugins/plugin.providers.ts` has to name it too, and a key spelled in two
 * files is a key that can be renamed in one.
 */
export const CHARTS_KEYS = {
    /**
     * Which chart service is asked first.
     *
     * Two things read it, and only one of them is a preference an operator
     * would notice straight away. `listCharts` builds a menu, so this is the
     * order the charts appear in. `styleChart` takes the FIRST plugin that
     * publishes a chart for a style and stops, so for that one this decides
     * outright whose chart of a genre the station plays.
     *
     * Empty keeps the alphabetical order the station used before the setting
     * existed, and a listed id that is not installed is ignored rather than
     * gating: see `plugins/plugin.order.ts`.
     */
    providerOrder: 'charts.providerOrder',
} as const;
