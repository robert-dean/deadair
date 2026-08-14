/**
 * The `charts` kind. A charts plugin answers "what is popular", as an ordered
 * list of records somebody else ranked.
 *
 * ## It answers with NAMES, and that is the whole design
 *
 * A chart entry is a title and an artist as strings, which is exactly the shape
 * of a station pick: the host looks a name up, ingests it if a provider has it,
 * and then judges it against the rotation rules like anything else. So a chart
 * source inherits the dislike veto, the repeat window, the artist spacing and
 * the fetch-and-bench by doing nothing at all, and a plugin here has no way to
 * put a record on air that the operator forbade.
 *
 * Which is why there is no `trackId`, no provider id and no stream URL in any
 * shape below. A chart is an opinion about records, not a source of them.
 *
 * ## Several plugins, several menus
 *
 * Unlike `enrichment`, this is not a fan-out that merges: two chart services do
 * not produce one better chart, they produce two charts. So there is no
 * `priority` here, and the host qualifies every {@link ChartDescriptor.id} with
 * the plugin that offered it — two services will both call something `top-100`.
 *
 * Every shape here is JSON-safe.
 */

/**
 * One chart this plugin can serve.
 *
 * `id` is scoped to this plugin and needs to be unique only within it. The host
 * qualifies it before anything outside sees it, so a short flat id is right.
 */
export interface ChartDescriptor {
    id: string;
    /** What to call it in a list an operator reads, e.g. `Top 100 Songs`. */
    name: string;
    /** ISO 3166-1 alpha-2, when the chart is national. Absent means global. */
    country?: string;
    /** The genre this chart covers, when it covers one. */
    genre?: string;
    description?: string;
}

/** What a chart is asked for. */
export interface ChartQuery {
    /** A {@link ChartDescriptor.id} this plugin offered. */
    chartId: string;
    /** How many entries to return. A plugin may return fewer; it must not return more. */
    limit: number;
    /**
     * Which edition, as an ISO-8601 date string (`YYYY-MM-DD`). Never a `Date`.
     *
     * A chart is a weekly document with a history, and "the hits of this week in
     * 1994" is a show. Whether a service can answer that is the plugin's
     * business: one that cannot should answer for its current edition rather
     * than throwing, because a nearly-right chart is a usable hour and an error
     * is silence.
     */
    date?: string;
}

/** One record's place in a chart. */
export interface ChartEntry {
    /** 1-based position in this edition. */
    rank: number;
    title: string;
    /**
     * The LEAD artist, and never a credit line.
     *
     * A correctness rule rather than a formatting one, and it is the single
     * easiest thing to get wrong here, because most feeds print `A, B & C` in
     * one field. Everything downstream matches a pick on the lead artist alone —
     * the host keys it as `songKey(title, [artist])` and its provider lookup
     * compares the first artist exactly — so a joined credit is a record that is
     * named correctly, resolves to nothing, and is dropped as "not in the
     * catalog". A live run of the same mistake elsewhere resolved every solo
     * credit and lost every duet.
     *
     * Put the other credits in {@link featuring}, which is shown and never
     * matched on.
     */
    artist: string;
    /** The other credited artists, in the source's own order. Never used to identify the record. */
    featuring?: string[];
    album?: string;
    year?: number;
    /** Best position this record has reached, where the source tracks it. */
    peak?: number;
    /** How many editions it has appeared in, where the source tracks it. */
    weeksOn?: number;
}

/**
 * Implemented by a `charts` plugin.
 */
export interface ChartsProvider {
    /**
     * What this plugin can serve, right now.
     *
     * Asked per request rather than cached by the host, for the reason a tool's
     * declarations are: an operator reconfiguring a plugin reinitializes it, and
     * a country list that depends on a config field would otherwise be a boot
     * snapshot of a setting that has since changed.
     *
     * An empty array is an ordinary answer — an unconfigured plugin has nothing
     * to offer — and is not a failure.
     */
    listCharts(): Promise<ChartDescriptor[]>;

    /**
     * One chart's entries, ranked.
     *
     * Return `[]` for a `chartId` you do not recognise rather than throwing: the
     * host asks the plugin that named the id, so an unknown one means the menu
     * moved underneath a caller, which is a stale request and not a fault.
     */
    fetchChart(query: ChartQuery): Promise<ChartEntry[]>;
}
