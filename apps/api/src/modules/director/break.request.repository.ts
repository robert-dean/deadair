import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { BreakContext, BreakRequest, BreakRequestState, BreakUrgency, StoredBreakRequest } from './break.request.js';

/**
 * Storage for `deadair.break_requests`: what the station has been asked to say.
 *
 * The record AND the authority, which is the opposite of `StationLineupRepository` beside it. The
 * running order is held in memory because a station must not need Postgres up to advance a track;
 * a request has no in-memory home, because the whole reason it is a row is that it must survive the
 * restart that would otherwise lose it — and the moment it describes does not come round again.
 *
 * Scoped like every other repository here: the director opens a scope per unit of work, and the
 * render job gets one per execution.
 */
@Injectable()
export class BreakRequestRepository extends DataRepository {
    /**
     * Injected rather than passed in, following `SegmentRepository`: the callers are a director pass,
     * a render job and a console route, and none of them has any other reason to hold the station's
     * identity.
     */
    constructor(
        db: Kysely<DB>,
        private readonly identity: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Write down something the station has been asked to say.
     *
     * Born `pending` for an urgency that waits for its audio and `placed` for one that is planted at
     * once, decided by the caller rather than here: this table records what was asked and what became
     * of it, and which urgencies wait is a fact about the placement rules, which live in the planner.
     *
     * The broadcast is stamped from {@link StationIdentity} and may genuinely be absent — a request
     * made while the station is stood down is declined before it reaches here, so in practice it is
     * set, and it is stored as null rather than reaching for whichever broadcast was last on.
     */
    async open(request: BreakRequest, state: BreakRequestState, expiresAt?: number): Promise<StoredBreakRequest> {
        const row = await this.db
            .insertInto('deadair.breakRequests')
            .values({
                stationKey: this.identity.stationKey,
                broadcastId: this.identity.current() ?? null,
                kind: request.kind,
                urgency: request.urgency,
                source: request.source,
                reason: request.reason ?? null,
                context: toJsonb(request.context),
                dedupeKey: request.key ?? null,
                state,
                expiresAt: expiresAt === undefined ? null : instant(expiresAt),
            })
            .returning(COLUMNS)
            .executeTakeFirstOrThrow();

        return toRequest(row);
    }

    /** One request, whatever state it is in. */
    async findById(id: string): Promise<StoredBreakRequest | undefined> {
        const row = await this.db.selectFrom('deadair.breakRequests').select(COLUMNS).where('id', '=', id).executeTakeFirst();

        return row === undefined ? undefined : toRequest(row);
    }

    /**
     * Everything waiting for a slot, oldest first.
     *
     * What the director drains on its commit pass. `ready` and `pending` together rather than only
     * the first, because the pass has to notice a request that EXPIRED while it was still being
     * written as well as one whose audio has landed — a bulletin nobody could speak in twenty minutes
     * has to be retired, not left pending forever.
     *
     * Oldest first because two requests waiting is a queue and the earlier one asked first.
     */
    async waiting(): Promise<StoredBreakRequest[]> {
        const rows = await this.db
            .selectFrom('deadair.breakRequests')
            .select(COLUMNS)
            .where('stationKey', '=', this.identity.stationKey)
            .where('state', 'in', ['pending', 'ready'] as const)
            .orderBy('createdAt', 'asc')
            .execute();

        return rows.map(toRequest);
    }

    /**
     * Whether something has already been accepted under this key recently.
     *
     * The cooldown, asked as a question about the table rather than about a map in memory. Every
     * state counts, including the ones that came to nothing: a welcome whose render failed still
     * means the station TRIED to greet this listener, and greeting them again a moment later because
     * the first attempt broke is the same annoyance twice.
     */
    async acceptedSince(key: string, since: number): Promise<boolean> {
        const row = await this.db
            .selectFrom('deadair.breakRequests')
            .select('id')
            .where('stationKey', '=', this.identity.stationKey)
            .where('dedupeKey', '=', key)
            .where('createdAt', '>=', instant(since))
            .limit(1)
            .executeTakeFirst();

        return row !== undefined;
    }

    /** Which break this request became. Set as soon as the row has been planned. */
    async attachSegment(id: string, segmentId: string): Promise<void> {
        await this.db.updateTable('deadair.breakRequests').set({ segmentId }).where('id', '=', id).execute();
    }

    /**
     * Move a request on, but only from where it is expected to be.
     *
     * Conditional for the reason `SegmentRepository.claimForWrite` is: the render job and the
     * director's drain both touch these rows, and a state written unconditionally would let a late
     * message put a request that has already aired back into the queue. A transition that does not
     * apply is not a failure — somebody else got there first — so this answers whether it took rather
     * than throwing.
     */
    async moveTo(id: string, to: BreakRequestState, from: BreakRequestState | readonly BreakRequestState[]): Promise<boolean> {
        const allowed = Array.isArray(from) ? [...from] : [from as BreakRequestState];

        const updated = await this.db
            .updateTable('deadair.breakRequests')
            .set({ state: to })
            .where('id', '=', id)
            .where('state', 'in', allowed)
            .returning('id')
            .executeTakeFirst();

        return updated !== undefined;
    }
}

const COLUMNS = ['id', 'kind', 'urgency', 'source', 'state', 'reason', 'context', 'dedupeKey', 'expiresAt', 'segmentId'] as const;

interface RequestRow {
    id: string;
    kind: string;
    urgency: BreakUrgency;
    source: string;
    state: BreakRequestState;
    reason: string | null;
    context: unknown;
    dedupeKey: string | null;
    expiresAt: DateTime | null;
    segmentId: string | null;
}

/**
 * Epoch millis as something the column will take.
 *
 * Through SQL rather than as a value, exactly as `segment.repository.ts` does it and for the same
 * reason: Postgres is handed a number and does the conversion itself, so the `DateTime`-versus-`Date`
 * mismatch in the generated types never has to be resolved here.
 */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/** A timestamp column as epoch millis. Both shapes handled, per `segment.repository.ts`. */
function millisOf(value: DateTime | null): number | undefined {
    if (value == null) return undefined;
    return value instanceof Date ? value.getTime() : value.toMillis();
}

/**
 * Rows read back as `undefined` rather than `null`, per the note in CLAUDE.md.
 *
 * The context is checked rather than cast, the way `audioExt` is on a segment: it is handed to a
 * writer as raw material, and a hand-edited row holding an array or a string should read as "no
 * context" instead of arriving somewhere that expects an object.
 */
function toRequest(row: RequestRow): StoredBreakRequest {
    return {
        id: row.id,
        kind: row.kind,
        urgency: row.urgency,
        source: row.source,
        state: row.state,
        ...(row.reason == null ? {} : { reason: row.reason }),
        ...(isContext(row.context) ? { context: row.context } : {}),
        ...(row.dedupeKey == null ? {} : { key: row.dedupeKey }),
        ...(millisOf(row.expiresAt) === undefined ? {} : { expiresAt: millisOf(row.expiresAt)! }),
        ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
    };
}

/** A jsonb value that is actually the flat object a writer was promised. */
function isContext(value: unknown): value is BreakContext {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

    return Object.values(value).every(entry => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean');
}
