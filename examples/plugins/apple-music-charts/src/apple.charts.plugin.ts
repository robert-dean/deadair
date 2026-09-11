import {
    Plugin,
    PluginError,
    jsonBody,
    pluginCodeForStatus,
    upstreamDetail,
    type ChartDescriptor,
    type ChartEntry,
    type ChartQuery,
    type ChartsPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
} from '@deadair/plugin-sdk';
import { COUNTRIES, FEED_HOST, appleChartsConfig, type Country } from './apple.charts.manifest.js';
import { parseFeed, splitCredit } from './apple.feed.js';

/** The one chart this plugin serves. The id only has to be unique within the plugin. */
export const CHART_ID = 'most-played';

/**
 * How many entries to ask Apple for. The feed answers for 10, 25, 50 and 100 and is not documented
 * to answer for anything else, so this always asks for the most and trims to what was wanted.
 */
const FEED_SIZE = 100;

/** A ceiling on one request. The station caps every fetch by what is left of the call anyway. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Apple Music's most-played songs in one country, as a `charts` plugin.
 *
 * A chart is an opinion about records rather than a source of them: every entry is a title and an
 * artist as text, and the station looks each one up in the library it already has and judges it by
 * its own rules. So nothing here can put a record on air that the operator has refused.
 */
export class AppleMusicChartsPlugin extends Plugin implements ChartsPluginInstance {
    private country: Country = 'us';

    protected async onLoad(): Promise<void> {
        // Already validated against the manifest's schema by the station. Parsing again is what
        // turns it into a typed value with the default filled in.
        const { country } = appleChartsConfig.parse(await this.host.config.get());
        this.country = country;
        this.host.logger.info('apple music charts ready', { country });
    }

    async listCharts(): Promise<ChartDescriptor[]> {
        return [{ id: CHART_ID, name: `Top Songs: ${COUNTRIES[this.country]}`, country: this.country.toUpperCase() }];
    }

    async fetchChart(query: ChartQuery): Promise<ChartEntry[]> {
        // An id this plugin never offered means the menu moved under the caller, which is a stale
        // request rather than a fault, so the answer is an empty chart.
        if (query.chartId !== CHART_ID) return [];

        // Taken once, before the first await. Saving this plugin's settings restarts it, and a
        // request in flight at that moment must not reach for `this.host` afterwards and find it gone.
        const host = this.host;

        // `query.date` asks for a past edition. Apple's feed has none, so the current one answers:
        // a nearly-right chart is a usable hour, and an error is silence.
        const entries = await fetchFeed(host, this.country);
        return entries.slice(0, Math.max(0, query.limit));
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        try {
            const entries = await fetchFeed(host, this.country);
            const top = entries[0];
            return {
                ok: true,
                message: top === undefined ? `Apple answered with an empty chart.` : `Apple answered: number one is ${top.title} by ${top.artist}.`,
            };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }
}

/** One country's chart, ranked, with each credit split into its lead and the rest. */
async function fetchFeed(host: PluginHost, country: Country): Promise<ChartEntry[]> {
    const url = `https://${FEED_HOST}/api/v2/${country}/music/most-played/${FEED_SIZE}/songs.json`;
    const response = await host.fetch(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers: { Accept: 'application/json' } });

    if (!response.ok) {
        // Nobody will read an error page, and reading it spends time a retry would want.
        await response.body?.cancel();
        throw new PluginError(`Apple answered ${upstreamDetail(response.status, response.statusText)}`)
            .withCode(pluginCodeForStatus(response.status))
            .withUpstreamStatus(response.status);
    }

    let entries;
    try {
        entries = parseFeed(await jsonBody<unknown>(response));
    } catch (error) {
        throw new PluginError('Apple answered with something that is not a chart', { cause: error }).withCode('upstream');
    }

    return entries.map((entry, index) => {
        const { artist, featuring } = splitCredit(entry.artistName, entry.artistUrl);
        return {
            rank: index + 1,
            // Kept exactly as Apple spells it, `(feat. …)` and all: that is how the providers spell
            // it too, and the title is where the station expects to find a featured artist.
            title: entry.name,
            artist,
            ...(featuring.length > 0 ? { featuring } : {}),
        };
    });
}
