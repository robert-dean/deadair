import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { coerceCast, type ProductionCast } from './production.cast.js';
import { isSettled, type Production, type ProductionOutline, type ProductionPlan, type ProductionState, type WritingMode } from './production.js';
import { isWritingMode } from './production.passes.js';

/**
 * `deadair.productions`: the row that IS the state machine.
 *
 * Making a production is several model calls over minutes to hours, so nothing about it can live in
 * memory and survive what actually happens to it — a restart, a redeploy, an operator changing their
 * mind. Every pass reads this row to find out where the work got to and writes back what it did, and
 * that is the whole of the resumability story: there is no checkpoint table, because the thing being
 * checkpointed is the checkpoint.
 *
 * ## Claims, on the same argument the segment rows make
 *
 * A pass CLAIMS its production with a conditional update rather than reading and then writing, so a
 * duplicate job delivery is free: only one `planned → outlining` wins and the loser stops. That
 * matters more here than for a break, because two runs of the same pass would not merely waste the
 * model, they would write two different outlines over each other and leave the beats drafted against
 * whichever landed second.
 *
 * ## Cancellation is a fact on the row, and is checked rather than delivered
 *
 * **A queue cannot cancel.** A message already sent will be delivered, and a broker will happily
 * resurrect a run minutes after somebody stopped it — which is v1's gotcha, paid for live. So
 * {@link cancel} writes a terminal state and every pass calls {@link claim}, which refuses anything
 * settled. The stop is something the work asks about, not something the queue does to it.
 */
@Injectable()
export class ProductionRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly identity: StationIdentity,
    ) {
        super(db);
    }

    /** Commission one. Born `planned`, which is the state the first pass claims out of. */
    async open(input: {
        kind: string;
        title: string;
        targetMs: number;
        writingMode: WritingMode;
        brief?: string;
        personaId?: string;
        scheduledFor?: number;
        actorId?: string;
    }): Promise<Production> {
        const row = await this.db
            .insertInto('deadair.productions')
            .values({
                stationKey: this.identity.stationKey,
                // Which broadcast it was made FOR, and null when there is none. `StationIdentity`'s
                // rule: a writer with no broadcast stores null rather than reaching for whichever
                // one was last on, which would file this under a programme that has already ended.
                broadcastId: this.identity.current() ?? null,
                kind: input.kind,
                title: input.title,
                targetMs: input.targetMs,
                writingMode: input.writingMode,
                brief: input.brief ?? null,
                personaId: input.personaId ?? null,
                // Nobody is cast at commission. A production is read ahead by up to three hours and
                // the roster can change in between, so who is on it is decided by the first pass
                // that actually runs. See `ProductionCaster`.
                casting: null,
                scheduledFor: input.scheduledFor === undefined ? null : instant(input.scheduledFor),
                actorId: input.actorId ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toProduction(row);
    }

    /** One production, however it is doing. */
    async findById(id: string): Promise<Production | undefined> {
        const row = await this.db.selectFrom('deadair.productions').selectAll().where('id', '=', id).executeTakeFirst();
        return row === undefined ? undefined : toProduction(row);
    }

    /**
     * Take this production for a pass, or answer nothing.
     *
     * Conditional on the state the pass expects to start from, which is what makes a duplicate
     * delivery free and what makes cancellation bite: a settled row matches no `from` state, so a
     * job for a production somebody stopped finds nothing to claim and returns without spending
     * anything at the model.
     */
    async claim(id: string, from: ProductionState, to: ProductionState): Promise<Production | undefined> {
        const row = await this.db
            .updateTable('deadair.productions')
            .set({ state: to })
            .where('id', '=', id)
            .where('state', '=', from)
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toProduction(row);
    }

    /**
     * What the outline pass decided.
     *
     * Guarded on `outlining`, which is to say on the claim this caller took: a production that has
     * since been cancelled, failed, or been carried on by something else never has an outline
     * written over it by a pass that no longer owns it.
     */
    async saveOutline(id: string, outline: ProductionOutline, plan: ProductionPlan, to: ProductionState, casting?: ProductionCast): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.productions')
            .set({
                outline: toJsonb(outline),
                plan: toJsonb(plan),
                state: to,
                ...(casting === undefined ? {} : { casting: toJsonb([...casting]) }),
            })
            .where('id', '=', id)
            .where('state', '=', 'outlining')
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * The computed shape, and who is in it.
     *
     * Both together, because they are decided together and by the same pass: the turn count comes
     * from the band the CAST calls for, so a plan stored without the cast that shaped it would be a
     * row nobody could read back correctly.
     */
    async savePlan(id: string, plan: ProductionPlan, from: ProductionState, to: ProductionState, casting?: ProductionCast): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.productions')
            .set({ plan: toJsonb(plan), state: to, ...(casting === undefined ? {} : { casting: toJsonb([...casting]) }) })
            .where('id', '=', id)
            .where('state', '=', from)
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /** Move a production on, guarded on where it was. */
    async moveTo(id: string, to: ProductionState, from: ProductionState | readonly ProductionState[]): Promise<boolean> {
        const states = Array.isArray(from) ? from : [from as ProductionState];
        const row = await this.db
            .updateTable('deadair.productions')
            .set({ state: to })
            .where('id', '=', id)
            .where('state', 'in', states)
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * Making it did not work, and this says what happened.
     *
     * Unguarded on state, unlike everything else here, and deliberately: a failure can be discovered
     * from any pass, and refusing to record one because the row moved would leave a production stuck
     * with no reason on it. It does refuse to overwrite a SETTLED row, because a production somebody
     * cancelled did not fail and should not be reported as though it had.
     */
    async fail(id: string, error: string): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.productions')
            .set({ state: 'failed', error })
            .where('id', '=', id)
            .where('state', 'not in', ['aired', 'failed', 'cancelled'])
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * Stop one, terminally.
     *
     * The whole of cancellation, and it is a write rather than a message for the reason at the top of
     * this class: a queue cannot cancel. Everything already sent will still be delivered; what
     * changes is that none of it can claim the row when it arrives.
     *
     * Refuses a production that is already settled, so cancelling one that has aired does not rewrite
     * history into something that never went out.
     */
    async cancel(id: string): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.productions')
            .set({ state: 'cancelled', cancelledAt: instant(Date.now()) })
            .where('id', '=', id)
            .where('state', 'not in', ['aired', 'failed', 'cancelled'])
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * Whether this production has been stopped, asked cheaply and mid-pass.
     *
     * A pass claims once at the start and can then be at the model for minutes, which is exactly long
     * enough for somebody to change their mind. This is what a long pass asks before it spends
     * anything more — and what feeds the gate's withdrawal signal, so a beat still queued for the
     * model leaves that queue rather than being admitted, generated and thrown away.
     */
    async isCancelled(id: string): Promise<boolean> {
        const row = await this.db.selectFrom('deadair.productions').select('state').where('id', '=', id).executeTakeFirst();
        return row === undefined || row.state === 'cancelled';
    }

    /** What the station has made or is making, newest first: what a console lists. */
    async recent(limit = 50): Promise<Production[]> {
        const rows = await this.db
            .selectFrom('deadair.productions')
            .selectAll()
            .where('stationKey', '=', this.identity.stationKey)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .execute();

        return rows.map(toProduction);
    }

    /**
     * Productions already scheduled at or after an instant, for the clock's idempotence.
     *
     * The scheduler asks the TABLE whether it has already commissioned a slot rather than
     * remembering, because memory forgets across exactly the restart that makes a double-commission
     * most likely — the same argument `break_requests.dedupe_key` is a column for.
     */
    async scheduledAfter(from: number): Promise<Production[]> {
        const rows = await this.db
            .selectFrom('deadair.productions')
            .selectAll()
            .where('stationKey', '=', this.identity.stationKey)
            .where('scheduledFor', '>=', instant(from))
            .where('state', 'not in', ['failed', 'cancelled'])
            .execute();

        return rows.map(toProduction);
    }

    /** Everything still being made, oldest first: what a scheduler drains. */
    async unfinished(limit = 20): Promise<Production[]> {
        const rows = await this.db
            .selectFrom('deadair.productions')
            .selectAll()
            .where('stationKey', '=', this.identity.stationKey)
            .where('state', 'not in', ['aired', 'failed', 'cancelled'])
            .orderBy('createdAt', 'asc')
            .limit(limit)
            .execute();

        return rows.map(toProduction);
    }
}

/**
 * Epoch millis as something the column will take.
 *
 * Through SQL rather than as a value, exactly as `break.request.repository.ts` and
 * `segment.repository.ts` do it and for the same reason: Postgres is handed a number and does the
 * conversion itself, so the `DateTime`-versus-`Date` mismatch in the generated types never has to be
 * resolved here.
 */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/** A timestamp column as epoch millis. Both shapes handled, per `break.request.repository.ts`. */
function millisOf(value: DateTime | null): number | undefined {
    if (value == null) return undefined;
    return value instanceof Date ? value.getTime() : value.toMillis();
}

/** One row as the rest of the app reads it. */
function toProduction(row: Record<string, unknown>): Production {
    const state = row.state as ProductionState;
    const mode = String(row.writingMode);

    return {
        id: String(row.id),
        stationKey: String(row.stationKey),
        ...(row.broadcastId == null ? {} : { broadcastId: String(row.broadcastId) }),
        kind: String(row.kind),
        title: String(row.title),
        ...(row.brief == null ? {} : { brief: String(row.brief) }),
        ...(row.personaId == null ? {} : { personaId: String(row.personaId) }),
        ...(coerceCast(row.casting) === undefined ? {} : { casting: coerceCast(row.casting)! }),
        // Fallen back rather than trusted: the column is constrained, but a row edited by hand out of
        // band would otherwise reach the pass chain as a mode nothing knows how to run.
        writingMode: isWritingMode(mode) ? mode : 'outlined',
        targetMs: Number(row.targetMs),
        ...(row.plan == null ? {} : { plan: row.plan as ProductionPlan }),
        ...(row.outline == null ? {} : { outline: row.outline as ProductionOutline }),
        state,
        ...(row.error == null ? {} : { error: String(row.error) }),
        ...(millisOf(row.scheduledFor as DateTime | null) === undefined ? {} : { scheduledFor: millisOf(row.scheduledFor as DateTime | null)! }),
        ...(millisOf(row.cancelledAt as DateTime | null) === undefined ? {} : { cancelledAt: millisOf(row.cancelledAt as DateTime | null)! }),
        ...(row.actorId == null ? {} : { actorId: String(row.actorId) }),
        createdAt: millisOf(row.createdAt as DateTime | null) ?? 0,
    };
}

/** Re-exported so a caller holding a `Production` needs one import rather than two. */
export { isSettled };
