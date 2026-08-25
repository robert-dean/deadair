import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';

import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';

import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { Heartbeat } from '#modules/shared/heartbeat.js';
import type { StationBacklog, StationCheckup, StationHeartbeat } from './types/station.types.js';

/**
 * The machinery, for the page that assembles a check-up.
 *
 * Two signals and no more, because those are the two nothing else exposes. Every other fact a
 * check-up shows is already on a contract the console reads for another reason: the silence verdict
 * and the audience ride `/playout/status`, which the transport strip polls every two seconds; what
 * needs somebody is `/station/attention`; the plugin statuses are `/plugins`; the disk is
 * `/storage`. Composing any of them again here would be a second answer that can disagree with the
 * first, and the console can hold five readings as easily as one.
 *
 * ## It adds no probing
 *
 * The heartbeats are already being kept in memory by the loops themselves and the counts are one
 * query the catalog already runs for its own page. Nothing here opens a connection, asks an upstream
 * anything, or starts a timer — which is the rule `comparable-stations.md` sets for a check-up and
 * the reason one is worth having at all: a page that measured the station by poking it would change
 * the thing it was reporting on.
 *
 * ## Each section fails on its own
 *
 * `StationAttentionService` next door states the argument and this follows it: a page that says what
 * is wrong is the worst possible place for one broken reader to take the whole answer down, and
 * these are the readers most likely to be unhappy on a station that has something wrong with it. So
 * a failed read is an absent section with the failure logged, and the rest of the reading still
 * arrives.
 */
@Injectable()
export class StationCheckupService {
    constructor(
        private readonly tracks: TracksRepository,
        private readonly heartbeat: Heartbeat,
        private readonly logger: Logger,
    ) {}

    async read(): Promise<StationCheckup> {
        const [heartbeats, backlog] = await Promise.all([this.loops(), this.backlog()]);

        return {
            // Stamped here rather than left to the console's own clock, so a page that has been open
            // for an hour cannot present an old reading as the present tense.
            readAt: DateTime.utc(),
            ...(heartbeats === undefined ? {} : { heartbeats }),
            ...(backlog === undefined ? {} : { backlog }),
        };
    }

    /**
     * Every loop being watched, with its timestamps and no verdict.
     *
     * Epoch milliseconds in memory become ISO datetimes on the wire, which is the JSON-safe rule and
     * also the honest shape: a reader on another machine needs to know WHEN, not how many
     * milliseconds ago according to a clock it cannot see.
     *
     * Synchronous underneath and wrapped anyway, on the same terms as the reads beside it: it cannot
     * throw today, and a section that started throwing later should cost this page one row rather
     * than all of them.
     */
    private async loops(): Promise<StationHeartbeat[] | undefined> {
        try {
            return this.heartbeat.all().map(reading => ({
                name: reading.name,
                startedAt: DateTime.fromMillis(reading.startedAt, { zone: 'utc' }),
                ...(reading.lastBeat === undefined ? {} : { lastBeat: DateTime.fromMillis(reading.lastBeat, { zone: 'utc' }) }),
            }));
        } catch (error) {
            this.logger.warn(`station: the heartbeats could not be read (${message(error)})`);
            return undefined;
        }
    }

    /**
     * How much of the library the station has actually looked at.
     *
     * The same counts `/catalog/tracks` answers with, asked without a page of rows attached. The
     * schema version rides along for the reason the catalog's own reader documents: "measured" means
     * measured at a version the station still trusts, and a row from an older one holds fields that
     * may since have changed meaning.
     */
    private async backlog(): Promise<StationBacklog | undefined> {
        try {
            // The paging fields are inert here and are what the query type asks for: this reads the
            // aggregate over the whole filtered set rather than a page of it, exactly as
            // `StationAttentionService` asks the same question.
            const counts = await this.tracks.trackStateCounts({ limit: 0, offset: 0, sort: 'asc', schemaVersion: ANALYSIS_SCHEMA_VERSION });
            return { total: counts.total, cached: counts.cached, measured: counts.measured };
        } catch (error) {
            this.logger.warn(`station: the analysis backlog could not be counted (${message(error)})`);
            return undefined;
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
