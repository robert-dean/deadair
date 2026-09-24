import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { likeContains } from '#modules/catalog/catalog.query.js';
import { DataRepository } from '#modules/data/data.repository.js';

/** A request's lifecycle. See the migration for what each state means. */
export type RequestStatus = 'waiting' | 'pending' | 'queued' | 'aired' | 'declined' | 'expired';

/** The states in which a request still has something coming: it counts against the one-at-a-time rule and the cap. */
export const OPEN_STATUSES: readonly RequestStatus[] = ['waiting', 'pending', 'queued'];

/** Where to tell somebody on a chat platform what became of their request. */
export interface ChatReplyTarget {
    pluginId: string;
    chatId: string;
    chatKind: 'direct' | 'group';
    messageId: string;
}

/** One request, as the rest of the module reads it. */
export interface RequestRow {
    id: string;
    requesterKey: string;
    requesterName: string;
    actorId?: string;
    chat?: ChatReplyTarget;
    trackId: string;
    title: string;
    artist: string;
    status: RequestStatus;
    reason?: string;
    createdAt: DateTime;
    airedAt?: DateTime;
    /** A dedication: who it is for, and the listener's own words to go with it. Both untrusted. */
    dedication?: Dedication;
}

/** Who a request is dedicated to and what the listener wanted said. The listener's words, never the station's. */
export interface Dedication {
    to?: string;
    message?: string;
}

/** What {@link RequestsRepository.create} is given. */
export interface NewRequest {
    stationKey: string;
    requesterKey: string;
    requesterName: string;
    actorId?: string;
    chat?: ChatReplyTarget;
    trackId: string;
    title: string;
    artist: string;
    status: RequestStatus;
    reason?: string;
    dedication?: Dedication;
}

/** A record the request search found. */
export interface RequestableRow {
    trackId: string;
    title: string;
    artist: string;
    album?: string;
    year?: number;
}

/** The columns every read selects. */
const COLUMNS = [
    'id',
    'requesterKey',
    'requesterName',
    'actorId',
    'pluginId',
    'chatId',
    'chatKind',
    'messageId',
    'trackId',
    'title',
    'artist',
    'status',
    'reason',
    'createdAt',
    'airedAt',
    'dedicateTo',
    'message',
] as const;

/** A row as the module reads it, dropping absent optionals rather than passing nulls on. See `apps/api/CLAUDE.md`. */
function toRow(row: {
    id: string;
    requesterKey: string;
    requesterName: string;
    actorId: string | null;
    pluginId: string | null;
    chatId: string | null;
    chatKind: 'direct' | 'group' | null;
    messageId: string | null;
    trackId: string;
    title: string;
    artist: string;
    status: RequestStatus;
    reason: string | null;
    createdAt: DateTime;
    airedAt: DateTime | null;
    dedicateTo: string | null;
    message: string | null;
}): RequestRow {
    const chat =
        row.pluginId != null && row.chatId != null && row.chatKind != null && row.messageId != null
            ? { pluginId: row.pluginId, chatId: row.chatId, chatKind: row.chatKind, messageId: row.messageId }
            : undefined;
    return {
        id: row.id,
        requesterKey: row.requesterKey,
        requesterName: row.requesterName,
        ...(row.actorId == null ? {} : { actorId: row.actorId }),
        ...(chat === undefined ? {} : { chat }),
        trackId: row.trackId,
        title: row.title,
        artist: row.artist,
        status: row.status,
        ...(row.reason == null ? {} : { reason: row.reason }),
        createdAt: row.createdAt,
        ...(row.airedAt == null ? {} : { airedAt: row.airedAt }),
        ...(row.dedicateTo == null && row.message == null
            ? {}
            : {
                  dedication: { ...(row.dedicateTo == null ? {} : { to: row.dedicateTo }), ...(row.message == null ? {} : { message: row.message }) },
              }),
    };
}

/**
 * Listener requests: `deadair.listener_requests`, and the search that finds a record to ask for.
 *
 * Nothing here decides anything. The rules are `request.arbiter.ts`'s and placing a request in the
 * running order is the director's; this reads and writes rows.
 */
@Injectable()
export class RequestsRepository extends DataRepository {
    async create(request: NewRequest): Promise<RequestRow> {
        const row = await this.db
            .insertInto('deadair.listenerRequests')
            .values({
                stationKey: request.stationKey,
                requesterKey: request.requesterKey,
                requesterName: request.requesterName,
                actorId: request.actorId ?? null,
                pluginId: request.chat?.pluginId ?? null,
                chatId: request.chat?.chatId ?? null,
                chatKind: request.chat?.chatKind ?? null,
                messageId: request.chat?.messageId ?? null,
                trackId: request.trackId,
                title: request.title,
                artist: request.artist,
                status: request.status,
                reason: request.reason ?? null,
                dedicateTo: request.dedication?.to ?? null,
                message: request.dedication?.message ?? null,
                ...(request.status === 'declined' ? { decidedAt: sql<DateTime>`now()` } : {}),
            })
            .returning(COLUMNS)
            .executeTakeFirstOrThrow();
        return toRow(row);
    }

    async find(stationKey: string, id: string): Promise<RequestRow | undefined> {
        const row = await this.db
            .selectFrom('deadair.listenerRequests')
            .select(COLUMNS)
            .where('stationKey', '=', stationKey)
            .where('id', '=', id)
            .executeTakeFirst();
        return row === undefined ? undefined : toRow(row);
    }

    /** Recent requests, newest first, optionally in one state or by one person. */
    async list(stationKey: string, filter: { status?: RequestStatus; requesterKey?: string; limit?: number } = {}): Promise<RequestRow[]> {
        const rows = await this.db
            .selectFrom('deadair.listenerRequests')
            .select(COLUMNS)
            .where('stationKey', '=', stationKey)
            .$if(filter.status !== undefined, qb => qb.where('status', '=', filter.status!))
            .$if(filter.requesterKey !== undefined, qb => qb.where('requesterKey', '=', filter.requesterKey!))
            .orderBy('createdAt', 'desc')
            .limit(filter.limit ?? 50)
            .execute();
        return rows.map(toRow);
    }

    /** Every request still open, oldest first: what the arbitration counts and the tick walks. */
    async open(stationKey: string): Promise<RequestRow[]> {
        const rows = await this.db
            .selectFrom('deadair.listenerRequests')
            .select(COLUMNS)
            .where('stationKey', '=', stationKey)
            .where('status', 'in', OPEN_STATUSES)
            .orderBy('createdAt', 'asc')
            .execute();
        return rows.map(toRow);
    }

    /** When this person's last request that was let through was made, or nothing. Declined ones do not count against them. */
    async lastGrantedAt(stationKey: string, requesterKey: string): Promise<DateTime | undefined> {
        const row = await this.db
            .selectFrom('deadair.listenerRequests')
            .select('createdAt')
            .where('stationKey', '=', stationKey)
            .where('requesterKey', '=', requesterKey)
            .where('status', 'in', ['pending', 'queued', 'aired'])
            .orderBy('createdAt', 'desc')
            .limit(1)
            .executeTakeFirst();
        return row?.createdAt;
    }

    /**
     * Move a request from one state to another, and answer it as it now stands, or nothing when it
     * was no longer in `from`: somebody else decided first. Guarded on `from` so two deciders racing
     * cannot both win.
     */
    async moveTo(
        stationKey: string,
        id: string,
        from: readonly RequestStatus[],
        to: RequestStatus,
        reason?: string,
    ): Promise<RequestRow | undefined> {
        const row = await this.db
            .updateTable('deadair.listenerRequests')
            .set({
                status: to,
                ...(reason === undefined ? {} : { reason }),
                ...(to === 'aired' ? { airedAt: sql<DateTime>`now()` } : {}),
                ...(to === 'declined' || to === 'pending' ? { decidedAt: sql<DateTime>`now()` } : {}),
            })
            .where('stationKey', '=', stationKey)
            .where('id', '=', id)
            .where('status', 'in', from)
            .returning(COLUMNS)
            .executeTakeFirst();
        return row === undefined ? undefined : toRow(row);
    }

    /**
     * Records the station holds and could play, matching every word of `query` against the title or
     * the artist. Exact titles first, then titles that start with it, then the rest by title.
     */
    async search(query: string, limit: number): Promise<RequestableRow[]> {
        const words = query
            .split(/\s+/)
            .map(word => word.replace(/^[-–—]+|[-–—]+$/g, ''))
            .filter(word => word.length > 0)
            .slice(0, 8);
        if (words.length === 0) return [];

        const whole = query.trim().toLowerCase();
        const rows = await this.requestable()
            .where(eb =>
                eb.and(
                    words.map(word =>
                        eb.or([eb('deadair.tracks.title', 'ilike', likeContains(word)), eb('deadair.artists.name', 'ilike', likeContains(word))]),
                    ),
                ),
            )
            .orderBy(sql`lower(deadair.tracks.title) = ${whole}`, 'desc')
            .orderBy(sql`lower(deadair.tracks.title) like ${likeContains(whole).slice(1)}`, 'desc')
            .orderBy('deadair.tracks.title')
            .limit(limit)
            .execute();

        return rows.map(toRequestable);
    }

    /** One record, if the station could be asked for it: the same floor the search stands on. */
    async findRequestable(trackId: string): Promise<RequestableRow | undefined> {
        const row = await this.requestable().where('deadair.tracks.id', '=', trackId).executeTakeFirst();
        return row === undefined ? undefined : toRequestable(row);
    }

    /**
     * Records something can serve and nothing has disliked: the floor the model's own search stands
     * on, so a listener is never offered a record the station has been told not to play.
     */
    private requestable() {
        return this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select([
                'deadair.tracks.id as trackId',
                'deadair.tracks.title',
                'deadair.tracks.year',
                'deadair.artists.name as artist',
                'deadair.albums.name as album',
            ])
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .where(eb =>
                eb.exists(
                    eb
                        .selectFrom('deadair.trackSources')
                        .select('deadair.trackSources.id')
                        .whereRef('deadair.trackSources.trackId', '=', 'deadair.tracks.id')
                        .where('deadair.trackSources.missingAt', 'is', null),
                ),
            )
            .where('deadair.tracks.rating', '<>', -1)
            .where('deadair.artists.rating', '<>', -1)
            .where(eb => eb.or([eb('deadair.albums.rating', 'is', null), eb('deadair.albums.rating', '<>', -1)]));
    }
}

function toRequestable(row: { trackId: string; title: string; artist: string; album: string | null; year: number | null }): RequestableRow {
    return {
        trackId: row.trackId,
        title: row.title,
        artist: row.artist,
        ...(row.album == null ? {} : { album: row.album }),
        ...(row.year == null ? {} : { year: row.year }),
    };
}
