import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ChartsService } from '#modules/charts/charts.service.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What is popular?", as something a model can ask.
 *
 * ## The third question, beside what the station HAS and what it can GET
 *
 * `MusicSearchTool` answers from the catalog and the providers together, marking which is which.
 * Both answer "does this record exist and can we play it", which is a question about a record the
 * model already had in mind. This one answers a question it could not otherwise ask at all: what
 * other people are listening to this week. A position in a chart is a FACT, and a fact is what a
 * break is usually short of — "number three in the country this week" is a true thing to say on air
 * that no amount of searching the library will produce.
 *
 * ## Why this one IS backed by a plugin
 *
 * It is the rule `docs/todo/tool-plugins.md` sets: a tool is a plugin when the thing it talks to is
 * somebody else's service, and a host-side source when it talks to deadair. The two search tools are
 * the station asking capabilities it already has. A chart is published by a third party, so the
 * egress, the rate bucket and the response shape belong behind `host.fetch` in a plugin — and this
 * file is only the adapter that lets a model reach {@link ChartsService}.
 *
 * ## Nothing here schedules
 *
 * A chart entry is a title and an artist as strings. Whether any of them ever airs is decided by the
 * pick path, where the dislike veto and the rotation rules live. A model reading a chart is a DJ
 * reading a chart: it can talk about it, and it can choose to name one of the records, and both of
 * those go through everything that already judges a pick.
 */

/**
 * How many records come back, whatever was asked for.
 *
 * The same figure the two search tools use, and for the reason recorded there: a model asked for an
 * oversampled batch and shown ten rows pads the answer with repeats. A top forty is also a document
 * with a shape — the top ten is a different claim from the top forty — so this is generous enough to
 * hold the part anybody talks about.
 */
const MAX_RESULTS = 25;

/** One chart on the menu, as the model reads it. Thin: a name and enough to choose between them. */
interface ChartOption {
    id: string;
    name: string;
    country?: string;
    genre?: string;
}

@Injectable()
export class ChartsTool implements ToolSource {
    constructor(
        private readonly charts: ChartsService,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no chart plugin is installed, which is the default. A declaration
        // whose every call answers "there are no charts" spends context teaching the model about a
        // tool that cannot help it — the same rule `MusicSearchTool` follows for its provider half.
        if (!this.charts.hasCharts()) return [];

        return [
            {
                declaration: {
                    name: 'browse_charts',
                    // Written for the model. It says that calling it without an id is the way to
                    // find out what the ids ARE, because a model that has to guess one guesses a
                    // chart name rather than an id and gets nothing back.
                    description:
                        'Read a published chart of what is popular right now, for records the station does not necessarily own. Pass a style to get the top records in that style, or a chartId for a named chart — call it with neither to see which named charts exist. Positions are facts you can say on air.',
                    parameters: {
                        type: 'object',
                        properties: {
                            // Named STYLE rather than genre, matching the word the set prompt's
                            // vocabulary block uses. Two names for one idea is how a model ends up
                            // deciding they must mean different things.
                            style: {
                                type: 'string',
                                description:
                                    'A musical style, like "heavy metal" or "bluegrass". Any style works, not just the ones the library holds — this is what the world is playing, not what the station owns. Use this for a brief that names a style.',
                            },
                            chartId: {
                                type: 'string',
                                description: 'Which chart, exactly as an earlier call listed it. Leave it out to list the charts on offer.',
                            },
                            limit: { type: 'number', description: `How many records, at most ${MAX_RESULTS}.` },
                            date: {
                                type: 'string',
                                description:
                                    'Which edition, as YYYY-MM-DD, for a chart from the past. Leave it out for the current one. A service that keeps no history answers with the current one either way.',
                            },
                        },
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.browse(args),
            },
        ];
    }

    /**
     * The menu, or one chart off it.
     *
     * A chart that could not be read comes back as an empty list rather than an error, because
     * `ChartsService` has already decided that: a failed upstream, an id that named no plugin and a
     * chart with nothing in it are one outcome to a DJ. The count is in the answer so the model can
     * see it found nothing rather than inferring it from silence.
     */
    private async browse(args: Record<string, unknown>): Promise<{ charts: ChartOption[] } | { chartId: string; records: unknown[] }> {
        // A style is resolved to an id FIRST, and wins over an explicit `chartId` when a model sent
        // both. Sending both is a model hedging, and of the two the style is the one it chose on
        // purpose: the id would have come from a menu that never listed a style chart in the first
        // place, so honouring that instead would answer a question nobody asked.
        const style = readText(args.style);
        const named = style === undefined ? undefined : await this.charts.styleChart(style);

        if (style !== undefined && named === undefined) {
            // Said as an answer rather than an error, following every other miss here: nothing
            // installed publishes style charts, which is a true fact about the station and one the
            // model can act on by searching instead. `chartId` echoes the style rather than the
            // (nonexistent) id, so the answer reads as "no chart for jazz" and not "no chart for
            // nothing".
            this.logger.debug('llm: no chart plugin publishes a style chart', { style });
            return { chartId: style, records: [] };
        }

        const chartId = named ?? readText(args.chartId);

        if (chartId === undefined) {
            const charts = (await this.charts.listCharts()).map(chart => ({
                id: chart.id,
                name: chart.name,
                ...(chart.country === undefined ? {} : { country: chart.country }),
                ...(chart.genre === undefined ? {} : { genre: chart.genre }),
            }));

            this.logger.debug('llm: listed the charts on offer', { charts: charts.length });
            return { charts };
        }

        const entries = await this.charts.fetchChart(chartId, clampLimit(args.limit), readText(args.date));

        // The line the two search tools each carry, and for the same reason: "how many records did
        // the model actually have to choose from" has to be answerable from the log alone when a
        // break turns out to have named nothing.
        this.logger.debug('llm: read a chart', { chartId, found: entries.length });

        return {
            chartId,
            records: entries.map(entry => ({
                rank: entry.rank,
                title: entry.title,
                // The LEAD artist alone, exactly as the search tools answer, because the model is
                // told to copy a title and artist back verbatim and both steps that then judge the
                // pick match on the lead artist. `featuring` is shown and never copied.
                artist: entry.artist,
                ...(entry.featuring === undefined ? {} : { featuring: entry.featuring }),
                ...(entry.album === undefined ? {} : { album: entry.album }),
                ...(entry.year === undefined ? {} : { year: entry.year }),
                ...(entry.peak === undefined ? {} : { peak: entry.peak }),
                ...(entry.weeksOn === undefined ? {} : { weeksOn: entry.weeksOn }),
            })),
        };
    }
}

/** An argument the model actually set. Blank is the interesting case: a model filling every field. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** Whatever the model asked for, held between one and {@link MAX_RESULTS}. */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
