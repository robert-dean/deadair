import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ChartEntry } from '@deadair/plugin-sdk';
import { stationZone } from '#modules/director/clock.words.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { qualifyChartId } from './chart.ids.js';
import { StationChartRepository } from './station.chart.repository.js';
import { favouritesEdition, HISTORY_WEEKS, STATION_CHART_SIZE, weeklyEdition, type StationChartEntry } from './station.chart.js';
import type { StationChart } from './types/charts.types.js';
import type { StationChartRecord } from '#modules/playout/rundown.js';

/**
 * A chart entry as the host hands it on: the plugin SDK's shape, plus what the station's own chart
 * knows about why a record is on it. Never set on a plugin's entry; see `ChartsService.fetchChart`.
 */
export type HostChartEntry = ChartEntry & { station?: StationChartRecord };

/**
 * The qualifier the station's own charts are offered under, where a plugin's id would be.
 *
 * Not a plugin id anything ships: bundled plugins are all `deadair.<name>`. A third-party plugin
 * that named itself `station` would lose its charts to these, which is the right way round: the
 * station's own document is the one an operator scheduled.
 */
export const STATION_CHART_QUALIFIER = 'station';

/** The weekly chart. */
export const STATION_TOP_CHART = 'top-40';

/** The liked records, over the last year. */
export const STATION_FAVOURITES_CHART = 'favourites';

/**
 * The station's own charts, offered on the same menu as every plugin's.
 *
 * `ChartsService` asks this beside the plugins and qualifies nothing itself: the ids here are
 * already `station:<chart>`. Everything that reads a chart then reads these too, which is the whole
 * of how a countdown of the station's own records is scheduled: a slot naming `station:top-40` as
 * its chart, played as a countdown.
 */
@Injectable()
export class StationChartSource {
    constructor(
        private readonly repository: StationChartRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
    ) {}

    /** What the menu lists. Named after the station, as the presenter will say it: "number seven on the deadair Top 40". */
    charts(): StationChart[] {
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title).trim() || STREAM_DEFAULTS.title;
        return [
            {
                id: qualifyChartId(STATION_CHART_QUALIFIER, STATION_TOP_CHART),
                pluginId: STATION_CHART_QUALIFIER,
                name: `${station} Top 40`,
                description:
                    "This station's own weekly chart, Monday to Sunday: a point for every play, three for every listener request, " +
                    'one off for every skip, and half as much again for a record the station likes. Disliked and suspended records never chart.',
            },
            {
                id: qualifyChartId(STATION_CHART_QUALIFIER, STATION_FAVOURITES_CHART),
                pluginId: STATION_CHART_QUALIFIER,
                name: `${station} Favourites`,
                description: 'The records this station likes, ranked by how much they were played and asked for over the last year.',
            },
        ];
    }

    /** Whether `chartId`, the unqualified half, is one of these. */
    offers(chartId: string): boolean {
        return chartId === STATION_TOP_CHART || chartId === STATION_FAVOURITES_CHART;
    }

    /**
     * One edition's entries, ranked, as a chart plugin would answer them.
     *
     * `[]` for an id this does not offer, on `ChartsService.fetchChart`'s rule that every way of
     * having no answer is one outcome.
     */
    async fetch(chartId: string, limit: number, date?: string): Promise<HostChartEntry[]> {
        if (!this.offers(chartId) || limit <= 0) return [];

        const zone = stationZone(this.config);
        const week = await this.repository.editionWeek(zone, date);
        const history = await this.repository.history(this.identity.stationKey, zone, week, HISTORY_WEEKS);

        const entries =
            chartId === STATION_TOP_CHART
                ? weeklyEdition(history.tallies, history.standings, week, Math.min(limit, STATION_CHART_SIZE))
                : favouritesEdition(history.tallies, history.standings, limit);
        return entries.map(toChartEntry);
    }
}

/**
 * A station chart entry as the plugin SDK spells one, so everything downstream reads it as it reads
 * a plugin's, plus the station's own counts behind the placing for the presenter.
 */
export const toChartEntry = (entry: StationChartEntry): HostChartEntry => ({
    rank: entry.rank,
    title: entry.title,
    artist: entry.artist,
    ...(entry.peak === undefined ? {} : { peak: entry.peak }),
    ...(entry.weeksOn === undefined ? {} : { weeksOn: entry.weeksOn }),
    ...(entry.lastWeek === undefined ? {} : { lastWeek: entry.lastWeek }),
    station: { plays: entry.plays, requests: entry.requests, liked: entry.liked },
});
