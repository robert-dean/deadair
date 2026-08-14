import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ChartEntry } from '@deadair/plugin-sdk';
import { asChartsPlugin, type ChartsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { qualifyChartId, splitChartId } from './chart.ids.js';
import type { ChartPage, ChartQuery, StationChart, StationChartList } from './types/charts.types.js';

/**
 * What is popular, as the station can see it: every chart every installed
 * plugin offers, under ids that say which plugin offered them.
 *
 * ## A menu, not a merge
 *
 * Enrichment fans out and reconciles, because several sources describing one
 * record is more knowledge about that record. Charts do not work that way: two
 * services' top forties are two published documents, and combining them would
 * produce a ranking nobody stands behind. So this enumerates and never merges,
 * there is no `priority` on the capability, and choosing between charts is the
 * operator picking an id rather than the host deciding.
 *
 * ## It reads and nothing else
 *
 * Nothing here schedules, ingests or writes. A chart entry is a title and an
 * artist as strings, and turning one into something the station plays is the
 * pick path's job — where the dislike veto, the repeat window and the artist
 * spacing already live. Keeping that boundary is what stops a chart plugin from
 * being able to put a record on air that the operator forbade.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the same
 * rule `ToolRegistry` applies to a source that cannot say what it offers: a
 * chart service being down should cost its own rows and not the operator's
 * whole menu.
 */
@Injectable()
export class ChartsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasCharts(): boolean {
        return this.plugins().length > 0;
    }

    /**
     * {@link listCharts} as the console reads it.
     *
     * Thin on purpose, and separate rather than folded in, because the two
     * callers want different things from the same answer: a route wants the
     * contract's wrapper object, and the tool and the generator want the list.
     * Shaping one for the other is how a wrapper ends up in a model's context.
     */
    async readCharts(): Promise<StationChartList> {
        return { charts: await this.listCharts() };
    }

    /**
     * {@link fetchChart} as the console reads it.
     *
     * A chart nothing could read is an empty page and a 200, not a 404. The
     * plugin that owns the id may be reloading, its upstream may be down, and
     * neither of those is the operator having asked for something that does not
     * exist — which is what a 404 would tell them.
     */
    async readChart(id: string, query: ChartQuery): Promise<ChartPage> {
        const entries = await this.fetchChart(id, query.limit ?? MAX_CHART_ENTRIES, query.date);

        return {
            chartId: id,
            records: entries.map(entry => ({
                rank: entry.rank,
                title: entry.title,
                artist: entry.artist,
                ...(entry.featuring === undefined ? {} : { featuring: entry.featuring }),
                ...(entry.album === undefined ? {} : { album: entry.album }),
                ...(entry.year === undefined ? {} : { year: entry.year }),
                ...(entry.peak === undefined ? {} : { peak: entry.peak }),
                ...(entry.weeksOn === undefined ? {} : { weeksOn: entry.weeksOn }),
            })),
        };
    }

    /**
     * Every chart on offer, with its id qualified by the plugin that named it.
     *
     * `StationChart` is the CONTRACT's type rather than one of this module's
     * own: a chart is a thing the console draws a list of, and a second
     * hand-written shape beside the generated one is two places for a field to
     * be added to. `pluginId` rides alongside the qualified id so a console
     * grouping charts by service does not have to know the qualification scheme.
     *
     * Ordered by plugin and then by the order the plugin itself gave, because
     * that order is a decision somebody made — a service listing its national
     * charts by size is telling the operator something — and re-sorting by name
     * would throw it away for no gain.
     */
    async listCharts(): Promise<StationChart[]> {
        const charts: StationChart[] = [];

        for (const plugin of this.plugins()) {
            let offered;
            try {
                offered = await this.pluginInvoker.invoke(plugin.record.id, 'charts.listCharts', async () => plugin.instance.listCharts());
            } catch (error) {
                this.logger.info(`charts: a plugin could not say what it offers (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }

            for (const chart of offered ?? []) {
                if (!chart?.id || !chart.name) continue;
                charts.push({
                    id: qualifyChartId(plugin.record.id, chart.id),
                    pluginId: plugin.record.id,
                    name: chart.name,
                    ...(chart.country === undefined ? {} : { country: chart.country }),
                    ...(chart.genre === undefined ? {} : { genre: chart.genre }),
                    ...(chart.description === undefined ? {} : { description: chart.description }),
                });
            }
        }

        return charts;
    }

    /**
     * One chart's entries, ranked.
     *
     * `[]` covers every way of having no answer: an id that is not qualified, a
     * plugin that is not installed or not active, and a plugin that failed. They
     * are one outcome to every caller here — the tool tells the model it found
     * nothing, and the generator names nothing and lets the chain top up — and
     * the log line is where the difference lives.
     *
     * `limit` is passed through rather than enforced afterwards, because a
     * plugin that can ask its upstream for ten should not fetch two hundred and
     * throw them away. It is also clamped here, since a caller's limit reaches
     * a third party's API as a page size.
     */
    async fetchChart(qualifiedId: string, limit: number, date?: string): Promise<ChartEntry[]> {
        const address = splitChartId(qualifiedId);
        if (!address) {
            this.logger.info(`charts: "${qualifiedId}" is not a chart id (expected "pluginId:chartId")`);
            return [];
        }

        const plugin = this.plugins().find(candidate => candidate.record.id === address.pluginId);
        if (!plugin) {
            this.logger.info(`charts: no active plugin called "${address.pluginId}" can serve a chart`);
            return [];
        }

        try {
            const entries = await this.pluginInvoker.invoke(plugin.record.id, 'charts.fetchChart', async () =>
                plugin.instance.fetchChart({
                    chartId: address.chartId,
                    limit: clampLimit(limit),
                    ...(date === undefined ? {} : { date }),
                }),
            );

            return (entries ?? []).filter(entry => entry?.title?.trim() && entry.artist?.trim()).slice(0, clampLimit(limit));
        } catch (error) {
            this.logger.info(`charts: a chart could not be fetched (${qualifiedId}: ${errorText(error)})`);
            return [];
        }
    }

    /** Every plugin that can serve a chart right now, in a stable order. */
    private plugins(): ChartsPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asChartsPlugin).sort(byPluginId);
    }
}

/**
 * How many entries a chart may be asked for.
 *
 * A ceiling rather than a page size: this number reaches somebody else's API,
 * and a caller that asks for a thousand is asking a third party for a thousand.
 */
export const MAX_CHART_ENTRIES = 100;

const clampLimit = (value: number): number => {
    if (!Number.isFinite(value)) return MAX_CHART_ENTRIES;
    return Math.min(Math.max(Math.floor(value), 1), MAX_CHART_ENTRIES);
};
