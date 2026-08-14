import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import type { ScrobblePlay } from '@deadair/plugin-sdk';
import { DataRepository } from '#modules/data/data.repository.js';

/** One queued play, as the drain reads it back. */
export interface QueuedScrobble {
    id: string;
    pluginId: string;
    play: ScrobblePlay;
    attempts: number;
}

/** What {@link ScrobbleRepository.enqueue} is given for one destination. */
export interface ScrobbleEnqueue {
    stationKey: string;
    broadcastId?: string;
    pluginId: string;
    play: ScrobblePlay;
    /** Epoch millis before which this must not be sent. See the migration. */
    eligibleAt: number;
}

/**
 * The outbound queue: `deadair.scrobble_queue`.
 *
 * Written at the moment a record goes to air and drained by a cron. Nothing here
 * is read to make a decision about the broadcast, which is what lets every write
 * be fire-and-forget from the caller's point of view.
 */
@Injectable()
export class ScrobbleRepository extends DataRepository {
    /**
     * Queue one play for one destination.
     *
     * A row per destination rather than a row with a list, so two services fail
     * independently — see the migration.
     */
    async enqueue(entries: readonly ScrobbleEnqueue[]): Promise<number> {
        if (entries.length === 0) return 0;

        const rows = await this.db
            .insertInto('deadair.scrobbleQueue')
            .values(
                entries.map(entry => ({
                    stationKey: entry.stationKey,
                    broadcastId: entry.broadcastId ?? null,
                    pluginId: entry.pluginId,
                    payload: JSON.stringify(entry.play),
                    playedAt: sql<DateTime>`to_timestamp(${entry.play.playedAt} / 1000.0)`,
                    eligibleAt: sql<DateTime>`to_timestamp(${entry.eligibleAt} / 1000.0)`,
                })),
            )
            .execute();

        return Number(rows[0]?.numInsertedOrUpdatedRows ?? entries.length);
    }

    /**
     * What is due for one destination, oldest first.
     *
     * Both clocks have to have passed: `eligible_at`, which is the service's own
     * rule about when a listen counts, and `next_attempt_at`, which is the
     * backoff. They are separate columns because they answer different questions
     * and a single one would make a failed send reset the eligibility rule.
     *
     * No claim and no lock. The drain is a single cron job with `retryLimit: 0`,
     * so there is never a second reader — and the cost of being wrong about that
     * is a duplicate scrobble, which every service in this space de-duplicates on
     * timestamp anyway. A `for update skip locked` here would be machinery for a
     * concurrency that does not exist.
     */
    async due(stationKey: string, pluginId: string, limit: number): Promise<QueuedScrobble[]> {
        const rows = await this.db
            .selectFrom('deadair.scrobbleQueue')
            .select(['id', 'pluginId', 'payload', 'attempts'])
            .where('stationKey', '=', stationKey)
            .where('pluginId', '=', pluginId)
            .where('eligibleAt', '<=', sql<DateTime>`now()`)
            .where('nextAttemptAt', '<=', sql<DateTime>`now()`)
            // Oldest first, because a service that rejects everything older than
            // some horizon should lose the oldest rather than a random scattering.
            .orderBy('playedAt', 'asc')
            .limit(limit)
            .execute();

        return rows.map(row => ({
            id: row.id,
            pluginId: row.pluginId,
            play: row.payload as unknown as ScrobblePlay,
            attempts: row.attempts,
        }));
    }

    /** Drop rows that are done with: accepted, or refused in a way that will not change. */
    async forget(ids: readonly string[]): Promise<number> {
        if (ids.length === 0) return 0;

        const result = await this.db
            .deleteFrom('deadair.scrobbleQueue')
            .where('id', 'in', [...ids])
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }

    /**
     * Push rows back, with a doubling backoff and the reason on them.
     *
     * The delay is computed from `attempts` in SQL rather than passed in, so the
     * caller cannot get the sequence wrong for a subset of a batch, and so a row
     * retried by two different code paths still climbs one ladder.
     */
    async defer(ids: readonly string[], reason: string, baseDelayMs: number, maxDelayMs: number): Promise<void> {
        if (ids.length === 0) return;

        await this.db
            .updateTable('deadair.scrobbleQueue')
            .set({
                attempts: sql<number>`attempts + 1`,
                lastError: reason.slice(0, 500),
                nextAttemptAt: sql<DateTime>`now() + least(
                    ${sql.lit(maxDelayMs)},
                    ${sql.lit(baseDelayMs)} * power(2, least(attempts, 16))
                ) * interval '1 millisecond'`,
            })
            .where('id', 'in', [...ids])
            .execute();
    }

    /**
     * Drop rows that have failed too often, and say how many.
     *
     * A play nobody will ever take is not worth a row forever: the queue is meant
     * to survive an outage, not to remember a misconfiguration. The count is
     * returned so the caller can say so once rather than the sweep being silent.
     */
    async abandon(stationKey: string, maxAttempts: number): Promise<number> {
        const result = await this.db
            .deleteFrom('deadair.scrobbleQueue')
            .where('stationKey', '=', stationKey)
            .where('attempts', '>=', maxAttempts)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }

    /** How many plays are waiting for one destination. For a status read, never for a decision. */
    async depth(stationKey: string, pluginId: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.scrobbleQueue')
            .select(eb => eb.fn.countAll<string>().as('waiting'))
            .where('stationKey', '=', stationKey)
            .where('pluginId', '=', pluginId)
            .executeTakeFirst();

        return Number(row?.waiting ?? 0);
    }
}
