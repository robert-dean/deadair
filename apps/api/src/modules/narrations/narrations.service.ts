import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type { NarrationOrder, NarrationPiece, NarrationSeries } from '@deadair/plugin-sdk';
import { asNarrationPlugin, type NarrationPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import type { NarrationPieceListing, NarrationPieceRecord } from './narration.piece.js';
import { NarrationPieceRepository } from './narration.piece.repository.js';
import { qualifySeriesId } from './series.ids.js';
import type { StationPiece, StationPiecePage, StationPieceQuery, StationSeries, StationSeriesList } from './types/narrations.types.js';

/**
 * How long a plugin is given to say what it offers, when somebody is waiting on the answer.
 *
 * `PodcastsService.LIST_SHOWS_TIMEOUT_MS`'s number and its argument: listing is cheap compared with
 * producing anything, and ten seconds is what a console page can wait.
 */
export const LIST_SERIES_TIMEOUT_MS = 10_000;

/** The same, for a refresh nobody is waiting on. Long enough to read a whole shelf fresh. */
export const REFRESH_LIST_SERIES_TIMEOUT_MS = 60_000;

/**
 * How long a plugin is given for one series' pieces.
 *
 * Longer than a podcast feed gets, because the work differs in kind: a feed is one document, and a
 * book's table of contents may mean opening and parsing an EPUB of a few megabytes.
 */
export const LIST_PIECES_TIMEOUT_MS = 30_000;

/**
 * How many of a series' pieces a refresh asks for.
 *
 * Far more than a podcast's twenty-five, because a serial is worked through from its beginning: the
 * station's place in a book is a row in this table, so a book whose later chapters were never listed
 * is one the station stops part-way through. Two hundred covers a long novel whole, and a serial
 * longer than that is read across refreshes as the station advances.
 */
export const REFRESH_PIECES_PER_SERIES = 200;

/** What the console is given when it asks for pieces and says nothing about how many. */
export const DEFAULT_PIECE_PAGE = 100;

/**
 * How long a render claim stands before the station will ask again.
 *
 * Long, and deliberately longer than a podcast's fetch window: a chapter is several takes on the
 * station's only speech engine, each queued behind whatever else is waiting and each yielding to it,
 * so a render that is merely slow must not be mistaken for one that died. What this bounds is how
 * long a render that genuinely vanished (a worker killed mid-job) keeps its piece from being tried
 * again.
 */
export const RENDER_RETRY_AFTER_MS = 60 * 60_000;

/** What a refresh did, for the log and the console's own summary. */
export interface NarrationRefreshSummary {
    series: number;
    listed: number;
    added: number;
    /** Qualified ids of the series that could not be listed. */
    failed: string[];
}

/**
 * What the station can read out, out of whatever narration plugins are installed.
 *
 * Fans out over every one of them rather than selecting a single plugin, on `PodcastsService`'s
 * argument: two narration plugins are two shelves of things to read, and there is nothing to rank.
 * Every id is qualified with the plugin that offered it on the way out, because two plugins may well
 * both call a series `frankenstein`.
 */
@Injectable()
export class NarrationsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly pieces: NarrationPieceRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasNarrations(): boolean {
        return this.plugins().length > 0;
    }

    /** {@link listSeries} as the console reads it. */
    async readSeries(): Promise<StationSeriesList> {
        return { series: await this.listSeries() };
    }

    /**
     * Every series on offer, with its id qualified by the plugin that offers it.
     *
     * Ordered by plugin and then in the plugin's own order, which is the operator's: a list of things
     * somebody chose to have read out is in the order they chose them, and re-sorting by title would
     * throw that away.
     */
    async listSeries(timeoutMs = LIST_SERIES_TIMEOUT_MS): Promise<StationSeries[]> {
        const series: StationSeries[] = [];

        for (const plugin of this.plugins()) {
            let offered: NarrationSeries[];
            try {
                offered =
                    (await this.pluginInvoker.invoke(plugin.record.id, 'narration.listSeries', async () => plugin.instance.listSeries(), {
                        timeoutMs,
                    })) ?? [];
            } catch (error) {
                this.logger.warn(`narrations: a plugin could not say what it offers (${plugin.record.id}: ${errorText(error)})`);
                continue;
            }

            for (const one of offered) {
                if (!one?.id || !one.title) continue;
                series.push(toStationSeries(plugin.record.id, one));
            }
        }

        return series;
    }

    /** The pieces the station knows about, as the console reads them. */
    async readPieces(query: StationPieceQuery = {}): Promise<StationPiecePage> {
        const rows = await this.pieces.list({
            limit: query.limit ?? DEFAULT_PIECE_PAGE,
            ...(query.seriesId === undefined || query.seriesId.length === 0 ? {} : { seriesId: query.seriesId }),
        });

        return { pieces: rows.map(toStationPiece) };
    }

    /**
     * Ask for a refresh now, rather than waiting for the next scheduled one.
     *
     * Sent as a job rather than run inline, on `PodcastsService.requestRefresh`'s terms: reading every
     * source is far longer than a request should hold, and the console wants to know the ask landed
     * rather than to wait for the answer.
     */
    async requestRefresh(): Promise<void> {
        await this.jobs.send('narrations.refresh', {});
    }

    /**
     * Have one piece spoken now.
     *
     * The claim is the same conditional update the scheduler takes, so an operator pressing the
     * button twice, and an operator pressing it while the scheduler is already asking, both come down
     * to one render. A piece the station already holds is answered with its row and nothing is sent.
     */
    async requestRender(id: string): Promise<StationPiece> {
        const piece = await this.pieces.get(id);
        if (piece === undefined) throw httpError(404).withDetails({ message: 'the station does not know that piece' });

        if (piece.segmentId === undefined && (await this.pieces.claimRender(id, Date.now(), RENDER_RETRY_AFTER_MS))) {
            await this.jobs.send('narrations.render', { pieceId: id });
        }

        return toStationPiece((await this.pieces.get(id)) ?? piece);
    }

    /**
     * Read every series' pieces and remember them.
     *
     * One series at a time, so a failing one costs itself and the rest are still written. Stops early,
     * between series, when the job is being abandoned, rather than starting a read nobody will keep.
     */
    async refresh(signal?: AbortSignal): Promise<NarrationRefreshSummary> {
        const summary: NarrationRefreshSummary = { series: 0, listed: 0, added: 0, failed: [] };

        for (const plugin of this.plugins()) {
            if (signal?.aborted) break;

            let offered: NarrationSeries[];
            try {
                offered =
                    (await this.pluginInvoker.invoke(plugin.record.id, 'narration.listSeries', async () => plugin.instance.listSeries(), {
                        timeoutMs: REFRESH_LIST_SERIES_TIMEOUT_MS,
                    })) ?? [];
            } catch (error) {
                this.logger.warn(
                    `narrations: a plugin could not say what it offers, so none of its series were refreshed (${plugin.record.id}: ${errorText(error)})`,
                );
                continue;
            }

            for (const series of offered) {
                if (signal?.aborted) break;
                if (!series?.id) continue;

                summary.series += 1;
                const seriesId = qualifySeriesId(plugin.record.id, series.id);

                let pieces: NarrationPiece[];
                try {
                    pieces =
                        (await this.pluginInvoker.invoke(
                            plugin.record.id,
                            'narration.listPieces',
                            async () => plugin.instance.listPieces({ seriesId: series.id, limit: REFRESH_PIECES_PER_SERIES }),
                            { timeoutMs: LIST_PIECES_TIMEOUT_MS },
                        )) ?? [];
                } catch (error) {
                    summary.failed.push(seriesId);
                    this.logger.info(`narrations: a series' pieces could not be listed (${seriesId}: ${errorText(error)})`);
                    continue;
                }

                const listings = pieces.flatMap(piece => {
                    const listing = toListing(seriesId, series, piece);
                    return listing === undefined ? [] : [listing];
                });

                summary.listed += listings.length;
                summary.added += await this.pieces.record(listings);
            }
        }

        return summary;
    }

    /** Every installed plugin that can offer something to read, in a stable order. */
    private plugins(): NarrationPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asNarrationPlugin).sort(byPluginId);
    }
}

/** A plugin's series as the console reads it. */
function toStationSeries(pluginId: string, series: NarrationSeries): StationSeries {
    return {
        id: qualifySeriesId(pluginId, series.id),
        pluginId,
        title: series.title,
        order: readOrder(series.order),
        ...(series.author === undefined ? {} : { author: series.author }),
        ...(series.description === undefined ? {} : { description: series.description }),
        ...(series.artworkUrl === undefined ? {} : { artworkUrl: series.artworkUrl }),
        ...(series.homeUrl === undefined ? {} : { homeUrl: series.homeUrl }),
        ...(series.language === undefined ? {} : { language: series.language }),
    };
}

/**
 * A plugin's piece as a row the station can keep, or nothing when it is not one.
 *
 * Checked rather than trusted, because this is the boundary. A piece with no id could never be told
 * from the next one, and one with no way to be placed in its series' order is one no band could ever
 * ask for: a `serial` piece needs an `ordinal` and a `latest` piece needs a date. Each is the plugin
 * breaking its contract, and each costs that piece alone.
 *
 * A date that will not parse is dropped rather than the piece, since undated is a state a serial
 * handles perfectly well. It is only fatal to a `latest` series, where it is caught by the check
 * above on the parsed value.
 */
function toListing(seriesId: string, series: NarrationSeries, piece: NarrationPiece): NarrationPieceListing | undefined {
    if (!piece?.id || !piece.title) return undefined;

    const order = readOrder(series.order);
    const parsed = piece.publishedAt === undefined ? undefined : Date.parse(piece.publishedAt);
    const publishedAt = parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
    const ordinal = typeof piece.ordinal === 'number' && Number.isFinite(piece.ordinal) && piece.ordinal >= 0 ? Math.round(piece.ordinal) : undefined;

    if (order === 'serial' && ordinal === undefined) return undefined;
    if (order === 'latest' && publishedAt === undefined) return undefined;

    return {
        seriesId,
        pieceId: piece.id,
        seriesTitle: piece.seriesTitle || series.title,
        title: piece.title,
        seriesOrder: order,
        ...(series.author === undefined ? {} : { author: series.author }),
        ...(piece.summary === undefined ? {} : { summary: piece.summary }),
        ...(series.artworkUrl === undefined ? {} : { artworkUrl: series.artworkUrl }),
        ...(series.language === undefined ? {} : { language: series.language }),
        ...(piece.url === undefined ? {} : { url: piece.url }),
        ...(ordinal === undefined ? {} : { ordinal }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(piece.wordCount === undefined ? {} : { wordCount: piece.wordCount }),
    };
}

/** A row as the console reads it. Instants as ISO-8601, the contract's rule. */
function toStationPiece(row: NarrationPieceRecord): StationPiece {
    const iso = (millis: number): string => new Date(millis).toISOString();

    return {
        id: row.id,
        seriesId: row.seriesId,
        pieceId: row.pieceId,
        seriesTitle: row.seriesTitle,
        title: row.title,
        order: row.seriesOrder,
        seenAt: iso(row.seenAt),
        rendered: row.segmentId !== undefined,
        // Being made right now, which the console draws differently from both "not yet asked for" and
        // "ready": the row holds a production and no audio.
        rendering: row.segmentId === undefined && row.productionId !== undefined,
        ...(row.author === undefined ? {} : { author: row.author }),
        ...(row.summary === undefined ? {} : { summary: row.summary }),
        ...(row.url === undefined ? {} : { url: row.url }),
        ...(row.artworkUrl === undefined ? {} : { artworkUrl: row.artworkUrl }),
        ...(row.ordinal === undefined ? {} : { ordinal: row.ordinal }),
        ...(row.publishedAt === undefined ? {} : { publishedAt: iso(row.publishedAt) }),
        ...(row.wordCount === undefined ? {} : { wordCount: row.wordCount }),
        ...(row.renderRequestedAt === undefined ? {} : { renderRequestedAt: iso(row.renderRequestedAt) }),
        ...(row.renderError === undefined ? {} : { renderError: row.renderError }),
        ...(row.scheduledFor === undefined ? {} : { scheduledFor: iso(row.scheduledFor) }),
        ...(row.airedAt === undefined ? {} : { airedAt: iso(row.airedAt) }),
    };
}

/** A plugin's order, read leniently: anything that is not `latest` is a serial. See the repository's own reader. */
const readOrder = (value: unknown): NarrationOrder => (String(value ?? '').trim().toLowerCase() === 'latest' ? 'latest' : 'serial');
