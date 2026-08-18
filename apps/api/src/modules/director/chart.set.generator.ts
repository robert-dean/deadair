import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ChartsService } from '#modules/charts/charts.service.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from './pick.resolver.js';
import { songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * A published chart choosing part of what the station plays.
 *
 * ## The half that keeps working when the model does not
 *
 * `ChartsTool` already lets a model read a chart and programme from it, and that is the richer
 * path. It is also the one that disappears exactly when the station is under strain: the model is
 * self-hosted, its slow mode is very slow, and `ModelSetGenerator` declines outright when the gate
 * is busy or the plugin is down. A chart is an ordered list of names, so turning one into picks
 * needs no intelligence at all — which is why this exists beside the tool rather than instead of it.
 *
 * ## It names records and decides nothing
 *
 * A {@link TrackPick} is a title and an artist as strings. Whether any of these airs is settled
 * downstream in `PickResolver`, where the dislike veto, the repeat window, the artist cooldown and
 * the per-artist cap all run, and where a record the library has never held is looked up at a
 * provider and ingested. So this binding inherits every rule by doing nothing, and **anything here
 * that grew its own idea of what may air would be a bug**.
 *
 * ## The brief picks a chart and never filters one
 *
 * {@link SetInputs.brief} is read only far enough to choose between the charts on offer — a country,
 * a genre — because approximating an instruction is the thing the deterministic layer is not allowed
 * to do. A brief nothing on the menu matches leaves the configured chart in place rather than
 * filtering its contents down to whatever happened to contain the operator's words.
 *
 * ## Off by default, and inert without discovery
 *
 * `rotation.chartMix` is 0 until an operator sets it, so installing a chart plugin does not change
 * what the station plays. And with `rotation.discover` off this can do nothing useful whatever the
 * mix says, because a chart pick is almost never in the library — that is a legitimate operator
 * choice, but silence would read as a broken plugin, so it declines out loud once.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const CHART_GENERATOR = 'chart';

/** The `deadair.settings` keys this binding reads. */
export const CHART_GENERATOR_KEYS = {
    /** What fraction of a batch a chart may claim, 0 to 1. 0 is off. */
    mix: 'rotation.chartMix',
    /** Which chart, as `pluginId:chartId`. Empty means the first one on offer. */
    chart: 'rotation.chart',
} as const;

/**
 * Off, so that installing a chart plugin changes nothing until somebody asks.
 *
 * The same posture `llm.setGenerator` takes, and deliberately NOT the one `DEFAULT_SIMILAR_MIX`
 * takes beside it. A chart is a FORMAT: an hour of this week's top forty is a specific thing to
 * sound like, most operators do not want it, and this is the one generator that all but ignores the
 * brief — it reads it far enough to choose a chart and no further. Somebody installing a plugin for
 * its tags should not find chart pop in their evening.
 *
 * Similarity is a bias rather than a format, which is why that one defaults on. The cost of this
 * one being off is that the capability sits there doing nothing, which {@link ChartSetGenerator}
 * says out loud rather than leaving to be discovered.
 */
export const DEFAULT_CHART_MIX = 0;

/**
 * How many entries are fetched relative to what is wanted.
 *
 * Oversampled because a chart is a fixed document and most of it will be rejected: the songs the
 * running order already holds are handed down as `avoidSongKeys`, and everything past that is
 * dropped later by the rules. Asking for exactly `want` would routinely contribute one or two.
 */
const OVERSAMPLE = 4;

/** A ceiling on that oversample, so a big batch cannot ask a third party for a thousand rows. */
const MAX_FETCH = 100;

@Injectable()
export class ChartSetGenerator extends SetGenerator {
    readonly name = CHART_GENERATOR;

    /**
     * Whether the "discovery is off" line has been said.
     *
     * Once per process rather than once per refill: it is a configuration fact that will be just as
     * true on the next boundary, and a refill happens every few records.
     */
    private warnedAboutDiscovery = false;

    /** Whether the "installed but switched off" line has been said. Once per process, as above. */
    private saidItWasInert = false;

    constructor(
        private readonly charts: ChartsService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0) return [];

        // Read per refill rather than held, so an operator turning the mix up gets it on the next
        // one. Cheap: `AppConfig` is a live view over a snapshot, not a query.
        const mix = readMix(this.config.get(CHART_GENERATOR_KEYS.mix, DEFAULT_CHART_MIX));
        if (mix === 0) {
            this.sayIfInert();
            return [];
        }

        if (!this.charts.hasCharts()) {
            this.logger.debug('director: the chart mix is set but no plugin can serve a chart');
            return [];
        }

        // Said once, and said at all because this is the state that looks like a broken plugin: the
        // operator has asked for chart records, a chart is being fetched, and every pick is dropped
        // a step later for want of a copy the station could play.
        if (!this.discovering() && !this.warnedAboutDiscovery) {
            this.warnedAboutDiscovery = true;
            this.logger.warn(
                'director: the chart mix is set but "rotation.discover" is off, so chart records the library does not already hold cannot air',
            );
        }

        // A share of the batch, never the whole of it, and at least one — a mix an operator set
        // above zero should contribute something to a small refill rather than rounding away.
        const want = Math.max(1, Math.round(inputs.count * mix));

        const chartId = await this.chooseChart(inputs.brief);
        if (chartId === undefined) return [];

        let entries;
        try {
            entries = await this.charts.fetchChart(chartId, Math.min(want * OVERSAMPLE, MAX_FETCH));
        } catch (error) {
            // `ChartsService` already flattens a failed upstream to an empty list, so reaching here
            // means something less ordinary. The chain absorbs it either way; this is only so the
            // reason is in the log rather than inferred from a short hour.
            this.logger.warn(`director: a chart could not be read (${chartId}: ${errorText(error)})`);
            return [];
        }

        const picks: TrackPick[] = [];
        const taken = new Set<string>();

        for (const entry of entries) {
            if (picks.length >= want) break;

            const key = songKey(entry.title, [entry.artist]);
            // The chain checks this too, and doing it here as well is what makes the oversample
            // work: a chart's top ten against a running order that already holds half of it should
            // contribute the other half rather than stopping at `want` rows of duplicates.
            if (inputs.avoidSongKeys?.has(key) || taken.has(key)) continue;

            taken.add(key);
            // No `trackId`, deliberately, even where the library happens to hold the record. This
            // binding has not read the catalog and does not know which row it would be; the
            // resolver matches by name and is the one place that decision belongs.
            picks.push({ title: entry.title, artist: entry.artist });
        }

        this.logger.debug('director: took records from a chart', { chartId, want, offered: entries.length, named: picks.length });
        return picks;
    }

    /**
     * Which chart to read: the operator's, or the one the brief points at, or the first on offer.
     *
     * The brief is matched against the NAME, the country and the genre of each chart, which is a
     * choice between documents rather than a filter over one. An operator's explicit setting wins
     * over the brief, because it is the more deliberate of the two.
     */
    private async chooseChart(brief?: string): Promise<string | undefined> {
        const configured = this.config.get(CHART_GENERATOR_KEYS.chart, '').trim();
        if (configured.length > 0) return configured;

        const charts = await this.charts.listCharts();
        if (charts.length === 0) return undefined;

        const wanted = brief?.trim().toLowerCase();
        if (wanted !== undefined && wanted.length > 0) {
            const matched = charts.find(
                chart =>
                    wanted.includes(chart.name.toLowerCase()) ||
                    (chart.genre !== undefined && wanted.includes(chart.genre.toLowerCase())) ||
                    (chart.country !== undefined && wanted.includes(chart.country.toLowerCase())),
            );
            if (matched) return matched.id;
        }

        return charts[0]!.id;
    }

    /**
     * Say, once, that a capability the operator installed is switched off here.
     *
     * This binding is off by DEFAULT, so on any station with a chart plugin installed this is the
     * ordinary path — and that is exactly why it needs saying. The console lists `charts` as a live
     * capability of an active plugin, and without this there is nothing anywhere connecting that to
     * the reason no chart record ever airs.
     *
     * Only when something could actually have answered, so a station with no chart plugin stays
     * silent about a setting that would do nothing for it either way.
     */
    private sayIfInert(): void {
        if (this.saidItWasInert || !this.charts.hasCharts()) return;
        this.saidItWasInert = true;
        this.logger.info(`director: a chart plugin is installed but "${CHART_GENERATOR_KEYS.mix}" is 0, so the station is asking it for nothing`);
    }

    /**
     * Whether a record outside the library can reach the air at all.
     *
     * Read here rather than asked of `PickResolver`, which owns the decision: this is only deciding
     * whether to warn, and the resolver stays the one place that enforces it.
     */
    private discovering(): boolean {
        return settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT);
    }
}

/**
 * The mix as a fraction between 0 and 1.
 *
 * A stored value that is not a number is 0 rather than propagated: this multiplies a batch size,
 * and a `NaN` there would ask for `NaN` records and quietly contribute nothing, which sounds
 * exactly like a chart service that is down.
 */
function readMix(value: unknown): number {
    const mix = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(mix) || mix <= 0) return 0;
    return Math.min(mix, 1);
}
