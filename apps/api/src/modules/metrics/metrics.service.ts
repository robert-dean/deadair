import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { resolutionFor } from '@maroonedsoftware/telemetry';
import { MetricsRepository } from './metrics.repository.js';
import type { MetricNames, MetricSeriesPage, MetricSeriesQuery } from './types/metrics.types.js';

/** The most metric names one read may ask for: a page of charts, not the whole table. */
export const MAX_SERIES_NAMES = 20;

/** The widest range one read may span: the hour window's default, so a year against last year fits. */
export const MAX_RANGE_DAYS = 400;

/**
 * The read side of the station's numbers, for the console's Trends tab.
 *
 * The station picks the resolution, not the caller: minutes up to two days, hours beyond. A chart
 * asking for a month of minutes would get forty thousand points per series and draw them as a smear,
 * and a caller that could choose would have to know the minute rows are gone after a week anyway.
 */
@Injectable()
export class MetricsService {
    constructor(private readonly metrics: MetricsRepository) {}

    async readSeries(query: MetricSeriesQuery): Promise<MetricSeriesPage> {
        const names = [
            ...new Set(
                query.names
                    .split(',')
                    .map(name => name.trim())
                    .filter(name => name.length > 0),
            ),
        ];
        if (names.length === 0) throw httpError(400).withDetails({ message: 'name at least one metric' });
        if (names.length > MAX_SERIES_NAMES) throw httpError(400).withDetails({ message: `ask for at most ${MAX_SERIES_NAMES} metrics at once` });
        if (query.to <= query.from) throw httpError(400).withDetails({ message: 'the range has to end after it starts' });
        if (query.to.diff(query.from, 'days').days > MAX_RANGE_DAYS) {
            throw httpError(400).withDetails({ message: `the range can be at most ${MAX_RANGE_DAYS} days` });
        }

        const resolution = resolutionFor(query.from, query.to);
        const series = await this.metrics.series({ names, from: query.from, to: query.to, resolution });

        return {
            resolution,
            from: query.from,
            to: query.to,
            series: series.map(s => ({
                name: s.name,
                labels: { ...s.labels },
                source: s.source,
                points: s.points.map(point => ({ at: point.start, ...point.aggregate })),
            })),
        };
    }

    async readNames(): Promise<MetricNames> {
        return { names: await this.metrics.names() };
    }
}
