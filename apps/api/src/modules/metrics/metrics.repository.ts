import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DateTime, Duration } from 'luxon';
import type { MetricBucket, MetricResolution } from '@maroonedsoftware/telemetry';
import { MetricsStore, type MetricName, type MetricSeries, type MetricSeriesQuery } from '@maroonedsoftware/telemetry/kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** Where a row came from: the station's own measurements, or another service's OTLP export. */
export type MetricSource = 'station' | 'otlp';

/**
 * `deadair.metric_samples`, through `@maroonedsoftware/telemetry`'s store.
 *
 * A repository rather than the store registered directly, so it is scoped like every other and a
 * singleton reaches it through `inScope`. The SQL is the package's: merging upserts, the idempotent
 * hourly fold and the prune all live there, and were run against Postgres before it was published.
 * What this adds is the station's key on every row and every read.
 */
@Injectable()
export class MetricsRepository extends DataRepository {
    private readonly store: MetricsStore<DB>;

    constructor(db: Kysely<DB>, identity: StationIdentity) {
        super(db);
        this.store = new MetricsStore(db, {
            table: 'deadair.metric_samples',
            scope: { station_key: identity.stationKey },
        });
    }

    /**
     * Writes minute buckets, merging each into the row already stored for its series and minute.
     *
     * @returns How many rows were written.
     */
    upsertMinutes(buckets: readonly MetricBucket[], source: MetricSource = 'station'): Promise<number> {
        return this.store.upsertMinutes(buckets, source);
    }

    /**
     * Replaces the hour row of every series with that hour of its minutes.
     *
     * @param hour - Any instant in the hour.
     * @returns How many hour rows were written.
     */
    rollupHour(hour: DateTime): Promise<number> {
        return this.store.rollupHour(hour);
    }

    /**
     * Deletes rows of one resolution older than `days`. Zero or less deletes nothing, checked here as
     * well as by the caller, on `resolveRetentionDays`'s rule that a window of zero means keep it all.
     *
     * @returns How many rows were deleted.
     */
    async pruneOlderThanDays(resolution: MetricResolution, days: number, now: DateTime = DateTime.now()): Promise<number> {
        if (days <= 0) return 0;
        return this.store.prune(resolution, Duration.fromObject({ days }), now);
    }

    /** Series over a range at one resolution, under the station's key. */
    series(query: MetricSeriesQuery): Promise<MetricSeries[]> {
        return this.store.series(query);
    }

    /** Every metric name held under the station's key. */
    names(): Promise<MetricName[]> {
        return this.store.names();
    }
}
