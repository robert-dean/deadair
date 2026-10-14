import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/** One event destination as it is stored (`deadair.event_destinations`), its secret still sealed. */
export interface EventDestinationRow {
    id: string;
    name: string;
    url: string;
    secretSealed: string;
    enabled: boolean;
    /** The event types it asked for. Empty means every type. */
    events: string[];
    consecutiveFailures: number;
    disabledReason?: 'failing';
    lastDeliveredAt?: DateTime;
    lastFailedAt?: DateTime;
    lastFailure?: string;
    /** The newest state event it has taken; see the migration. */
    lastStateAt?: DateTime;
    createdAt: DateTime;
    updatedAt: DateTime;
}

/** What a new destination is stored with. */
export interface NewEventDestination {
    name: string;
    url: string;
    secretSealed: string;
    enabled: boolean;
    events: string[];
    createdBy?: string;
}

/** The fields an update may change; absent means unchanged. */
export interface EventDestinationChanges {
    name?: string;
    url?: string;
    enabled?: boolean;
    events?: string[];
    secretSealed?: string;
}

/** One delivery attempt as it is written down. */
export interface NewEventDelivery {
    destinationId: string;
    eventId: string;
    eventType: string;
    attempt: number;
    outcome: 'delivered' | 'failed' | 'dropped';
    httpStatus?: number;
    durationMs: number;
    error?: string;
}

/** One delivery attempt as it is read back. */
export interface EventDeliveryRow extends NewEventDelivery {
    id: string;
    createdAt: DateTime;
}

/** What a destination's failure count came to, after one more. */
export interface FailureTally {
    consecutiveFailures: number;
    enabled: boolean;
    name: string;
}

/**
 * How many delivery attempts are kept per destination. What an operator needs is what a destination
 * has been doing lately, and a busy station sends one event per record per destination for as long
 * as it is on; see the migration.
 */
export const DELIVERIES_KEPT = 50;

const DESTINATION_COLUMNS = [
    'id',
    'name',
    'url',
    'secretSealed',
    'enabled',
    'events',
    'consecutiveFailures',
    'disabledReason',
    'lastDeliveredAt',
    'lastFailedAt',
    'lastFailure',
    'lastStateAt',
    'createdAt',
    'updatedAt',
] as const;
const DELIVERY_COLUMNS = [
    'id',
    'destinationId',
    'eventId',
    'eventType',
    'attempt',
    'outcome',
    'httpStatus',
    'durationMs',
    'error',
    'createdAt',
] as const;

interface StoredDestination {
    id: string;
    name: string;
    url: string;
    secretSealed: string;
    enabled: boolean;
    events: string[];
    consecutiveFailures: number;
    disabledReason: 'failing' | null;
    lastDeliveredAt: DateTime | null;
    lastFailedAt: DateTime | null;
    lastFailure: string | null;
    lastStateAt: DateTime | null;
    createdAt: DateTime;
    updatedAt: DateTime;
}

/** A stored row with its nulls read as absent, which is what every reader above this one means by them. */
const toRow = ({ disabledReason, lastDeliveredAt, lastFailedAt, lastFailure, lastStateAt, ...row }: StoredDestination): EventDestinationRow => ({
    ...row,
    ...(disabledReason === null ? {} : { disabledReason }),
    ...(lastDeliveredAt === null ? {} : { lastDeliveredAt }),
    ...(lastFailedAt === null ? {} : { lastFailedAt }),
    ...(lastFailure === null ? {} : { lastFailure }),
    ...(lastStateAt === null ? {} : { lastStateAt }),
});

@Injectable()
export class EventDestinationsRepository extends DataRepository {
    /** Every destination, oldest first, so the console lists them in the order they were added. */
    async list(): Promise<EventDestinationRow[]> {
        const rows = await this.db.selectFrom('deadair.eventDestinations').select(DESTINATION_COLUMNS).orderBy('createdAt').orderBy('id').execute();
        return rows.map(toRow);
    }

    async get(id: string): Promise<EventDestinationRow | undefined> {
        const row = await this.db.selectFrom('deadair.eventDestinations').select(DESTINATION_COLUMNS).where('id', '=', id).executeTakeFirst();
        return row === undefined ? undefined : toRow(row);
    }

    /** The ids of every destination that is on and wants this type: asked for it by name, or asked for everything. */
    async subscribedTo(type: string): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.eventDestinations')
            .select('id')
            .where('enabled', '=', true)
            .where(eb => eb.or([eb(sql`cardinality(events)`, '=', 0), eb(sql.val(type), '=', eb.fn.any('events'))]))
            .execute();
        return rows.map(row => row.id);
    }

    async create(destination: NewEventDestination): Promise<EventDestinationRow> {
        const row = await this.db
            .insertInto('deadair.eventDestinations')
            .values({ ...destination, createdBy: destination.createdBy ?? null })
            .returning(DESTINATION_COLUMNS)
            .executeTakeFirstOrThrow();
        return toRow(row);
    }

    /**
     * Applies the changes given and stamps `updatedAt`. Answers nothing when there is no such destination.
     *
     * Turning a destination ON also clears why the station turned it off and its count of failures,
     * because an operator turning it back on is saying the receiver is fixed. A count left standing
     * at nineteen would switch it off again on the first hiccup.
     */
    async update(id: string, changes: EventDestinationChanges): Promise<EventDestinationRow | undefined> {
        const row = await this.db
            .updateTable('deadair.eventDestinations')
            .set({
                ...changes,
                ...(changes.enabled === true ? { consecutiveFailures: 0, disabledReason: null } : {}),
                updatedAt: sql<DateTime>`now()`,
            })
            .where('id', '=', id)
            .returning(DESTINATION_COLUMNS)
            .executeTakeFirst();
        return row === undefined ? undefined : toRow(row);
    }

    /** Removes a destination and, by cascade, its delivery log. Answers whether there was one. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db.deleteFrom('deadair.eventDestinations').where('id', '=', id).executeTakeFirst();
        return result.numDeletedRows > 0n;
    }

    /**
     * A delivery arrived: the failure count goes back to nothing, and a state event moves
     * `last_state_at` forward, never back, since two deliveries can finish in either order.
     */
    async markDelivered(id: string, stateAt?: string): Promise<void> {
        await this.db
            .updateTable('deadair.eventDestinations')
            .set({
                consecutiveFailures: 0,
                lastDeliveredAt: sql<DateTime>`now()`,
                ...(stateAt === undefined ? {} : { lastStateAt: sql<DateTime>`greatest(last_state_at, ${stateAt}::timestamptz)` }),
            })
            .where('id', '=', id)
            .execute();
    }

    /** A delivery failed for good: one more in the count, counted in the database so two jobs cannot both read nineteen. */
    async markFailed(id: string, reason: string): Promise<FailureTally | undefined> {
        return this.db
            .updateTable('deadair.eventDestinations')
            .set({ consecutiveFailures: sql<number>`consecutive_failures + 1`, lastFailedAt: sql<DateTime>`now()`, lastFailure: reason })
            .where('id', '=', id)
            .returning(['consecutiveFailures', 'enabled', 'name'])
            .executeTakeFirst();
    }

    /**
     * The station turns a destination off because it kept failing. Answers whether this call did it,
     * so that of two jobs crossing the line together only one says so on the feed.
     */
    async disableFailing(id: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.eventDestinations')
            .set({ enabled: false, disabledReason: 'failing', updatedAt: sql<DateTime>`now()` })
            .where('id', '=', id)
            .where('enabled', '=', true)
            .executeTakeFirst();
        return result.numUpdatedRows > 0n;
    }

    /** How many attempts this destination has already made at this event, from its log. */
    async attemptsAt(destinationId: string, eventId: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.eventDeliveries')
            .select(eb => eb.fn.countAll<string>().as('count'))
            .where('destinationId', '=', destinationId)
            .where('eventId', '=', eventId)
            .executeTakeFirst();
        return Number(row?.count ?? 0);
    }

    /**
     * Writes one attempt down and trims that destination's log to the newest {@link DELIVERIES_KEPT}.
     *
     * Trimmed here rather than by a sweep, because the log is per destination and bounded by count:
     * the moment a row arrives is the one moment the destination is known to have one too many.
     */
    async recordDelivery(delivery: NewEventDelivery): Promise<void> {
        await this.db
            .insertInto('deadair.eventDeliveries')
            .values({ ...delivery, httpStatus: delivery.httpStatus ?? null, error: delivery.error ?? null })
            .execute();

        await this.db
            .deleteFrom('deadair.eventDeliveries')
            .where('destinationId', '=', delivery.destinationId)
            .where(
                'id',
                'not in',
                this.db
                    .selectFrom('deadair.eventDeliveries')
                    .select('id')
                    .where('destinationId', '=', delivery.destinationId)
                    .orderBy('createdAt', 'desc')
                    .orderBy('id', 'desc')
                    .limit(DELIVERIES_KEPT),
            )
            .execute();
    }

    /** A destination's kept attempts, newest first. */
    async listDeliveries(destinationId: string): Promise<EventDeliveryRow[]> {
        const rows = await this.db
            .selectFrom('deadair.eventDeliveries')
            .select(DELIVERY_COLUMNS)
            .where('destinationId', '=', destinationId)
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .limit(DELIVERIES_KEPT)
            .execute();

        return rows.map(({ httpStatus, error, ...row }) => ({
            ...row,
            ...(httpStatus === null ? {} : { httpStatus }),
            ...(error === null ? {} : { error }),
        }));
    }
}
