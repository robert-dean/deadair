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
    createdAt: DateTime;
    updatedAt: DateTime;
}

/** What a new destination is stored with. */
export interface NewEventDestination {
    name: string;
    url: string;
    secretSealed: string;
    enabled: boolean;
    createdBy?: string;
}

/** The fields an update may change; absent means unchanged. */
export interface EventDestinationChanges {
    name?: string;
    url?: string;
    enabled?: boolean;
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

/**
 * How many delivery attempts are kept per destination. What an operator needs is what a destination
 * has been doing lately, and a busy station sends one event per record per destination for as long
 * as it is on; see the migration.
 */
export const DELIVERIES_KEPT = 50;

const DESTINATION_COLUMNS = ['id', 'name', 'url', 'secretSealed', 'enabled', 'createdAt', 'updatedAt'] as const;
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

@Injectable()
export class EventDestinationsRepository extends DataRepository {
    /** Every destination, oldest first, so the console lists them in the order they were added. */
    async list(): Promise<EventDestinationRow[]> {
        return this.db.selectFrom('deadair.eventDestinations').select(DESTINATION_COLUMNS).orderBy('createdAt').orderBy('id').execute();
    }

    async get(id: string): Promise<EventDestinationRow | undefined> {
        return this.db.selectFrom('deadair.eventDestinations').select(DESTINATION_COLUMNS).where('id', '=', id).executeTakeFirst();
    }

    async create(destination: NewEventDestination): Promise<EventDestinationRow> {
        return this.db
            .insertInto('deadair.eventDestinations')
            .values({ ...destination, createdBy: destination.createdBy ?? null })
            .returning(DESTINATION_COLUMNS)
            .executeTakeFirstOrThrow();
    }

    /** Applies the changes given and stamps `updatedAt`. Answers nothing when there is no such destination. */
    async update(id: string, changes: EventDestinationChanges): Promise<EventDestinationRow | undefined> {
        return this.db
            .updateTable('deadair.eventDestinations')
            .set({ ...changes, updatedAt: sql<DateTime>`now()` })
            .where('id', '=', id)
            .returning(DESTINATION_COLUMNS)
            .executeTakeFirst();
    }

    /** Removes a destination and, by cascade, its delivery log. Answers whether there was one. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db.deleteFrom('deadair.eventDestinations').where('id', '=', id).executeTakeFirst();
        return result.numDeletedRows > 0n;
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
