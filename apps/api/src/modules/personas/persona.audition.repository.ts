import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { Audition, AuditionAttempt, AuditionBreak, AuditionRecord, AuditionState } from './persona.audition.js';

/**
 * How many of this run's own scripts a transition is shown.
 *
 * `RECENT_WINDOW` in `write.break.job.ts`, deliberately the same number: the whole point of carrying
 * `recent` through an audition is that the run repeats what a broadcast does, and a window of a
 * different size would make the spent-signature rule fire at a different rate here than on air.
 */
export const AUDITION_RECENT_WINDOW = 6;

/**
 * `deadair.persona_auditions`: the row that IS the state machine.
 *
 * An audition is one model call per transition and the model is preempted by everything the station
 * does for itself, so a run of twenty can span a redeploy — which on this station is any push to
 * main. Nothing about it can live in memory. Every job reads this row to find out which transition
 * is next and writes back what it wrote, and that is the whole of the resumability story, on
 * `ProductionRepository`'s argument: the thing being checkpointed is the checkpoint.
 *
 * ## Claims, on the same argument the production rows make
 *
 * A job CLAIMS its transition with a conditional update on the cursor rather than reading and then
 * writing, so a duplicate delivery is free: only one job moves `cursor` from `n`, and the loser
 * stops. Without it a redelivered job would write a second break at the same ordinal — which the
 * unique index would refuse, turning a free duplicate into a failed run.
 *
 * ## Cancellation is a fact on the row
 *
 * A queue cannot cancel: a message already sent will be delivered. So {@link cancel} writes a
 * terminal state and {@link claim} refuses anything settled, which means a stop is something the
 * work asks about rather than something the queue does to it.
 *
 * ## Nothing here can put anything on air
 *
 * This repository reaches two tables and neither is `segments`, `script_history` or
 * `break_requests`. That is the rehearsal's guarantee expressed in the schema rather than in a rule:
 * an audition break has nowhere to become a broadcast.
 */
@Injectable()
export class PersonaAuditionRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Open one. Born `queued` with the cursor at 0, which is the state the first job claims out of. */
    async open(input: {
        personaId: string;
        personaKey: string;
        sourcePluginId: string;
        sourcePlaylistId: string;
        sourceName?: string;
        records: readonly AuditionRecord[];
        actorId?: string;
    }): Promise<Audition> {
        const row = await this.db
            .insertInto('deadair.personaAuditions')
            .values({
                stationKey: this.station.stationKey,
                personaId: input.personaId,
                personaKey: input.personaKey,
                sourcePluginId: input.sourcePluginId,
                sourcePlaylistId: input.sourcePlaylistId,
                sourceName: input.sourceName ?? null,
                records: toJsonb([...input.records]),
                // One break per transition, so one fewer than the records. The column carries it
                // rather than the reader deriving it, because every progress read wants it and the
                // records are a large jsonb nobody should fetch to count.
                transitions: input.records.length - 1,
                actorId: input.actorId ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return toAudition(row);
    }

    /** One run, however it is doing. */
    async findById(id: string): Promise<Audition | undefined> {
        const row = await this.db.selectFrom('deadair.personaAuditions').selectAll().where('id', '=', id).executeTakeFirst();
        return row === undefined ? undefined : toAudition(row);
    }

    /** One character's runs, newest first: what the console lists. */
    async listFor(personaId: string, limit = 20): Promise<Audition[]> {
        const rows = await this.db
            .selectFrom('deadair.personaAuditions')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('personaId', '=', personaId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .execute();

        return rows.map(toAudition);
    }

    /** How many breaks a run has recorded, which is how far along it is. */
    async writtenCount(auditionId: string): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.personaAuditionBreaks')
            .select(({ fn }) => fn.countAll().as('written'))
            .where('auditionId', '=', auditionId)
            .executeTakeFirst();

        return Number(row?.written ?? 0);
    }

    /** Every break of one run, in order. */
    async breaksOf(auditionId: string): Promise<AuditionBreak[]> {
        const rows = await this.db
            .selectFrom('deadair.personaAuditionBreaks')
            .selectAll()
            .where('auditionId', '=', auditionId)
            .orderBy('ordinal', 'asc')
            .execute();

        return rows.map(toBreak);
    }

    /**
     * This run's own scripts, newest first, for the next transition's `recent`.
     *
     * The audition's equivalent of `ScriptHistoryRepository.spokenDuring`, and shaped the same way:
     * only what was actually WRITTEN, newest first, capped at the window. A run that showed a
     * transition nothing — which is what `recent: []` does for the rehearsal, deliberately — would
     * let the host land its signature phrase at every transition and would measure a repetition no
     * broadcast ever produces.
     */
    async recentScripts(auditionId: string, limit = AUDITION_RECENT_WINDOW): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.personaAuditionBreaks')
            .select('script')
            .where('auditionId', '=', auditionId)
            .where('script', 'is not', null)
            .orderBy('ordinal', 'desc')
            .limit(limit)
            .execute();

        return rows.map(row => String(row.script));
    }

    /**
     * Take one transition, or answer nothing.
     *
     * Conditional on the cursor as well as the state, which is what makes a duplicate delivery free
     * and what makes cancellation bite: a settled row matches no state here, so a job for a run
     * somebody stopped finds nothing to claim and returns without going near the model.
     *
     * Moving `queued → running` on the way is what stops the console reporting a run as merely
     * queued once the first job has it.
     */
    async claim(id: string, ordinal: number): Promise<Audition | undefined> {
        const row = await this.db
            .updateTable('deadair.personaAuditions')
            .set({ state: 'running' })
            .where('id', '=', id)
            .where('cursor', '=', ordinal)
            .where('state', 'in', ['queued', 'running'])
            .returningAll()
            .executeTakeFirst();

        return row === undefined ? undefined : toAudition(row);
    }

    /**
     * Write one transition's break and move the cursor past it.
     *
     * The two together, because a break recorded without the cursor moving would be written again by
     * the next delivery and refused by the unique index. The cursor is advanced conditionally on
     * still being where this job claimed it, so a run cancelled mid-generation keeps its break —
     * which is worth keeping, the model having already been spent on it — without being carried on.
     */
    async recordBreak(
        auditionId: string,
        ordinal: number,
        written: {
            previous: AuditionRecord;
            next: AuditionRecord;
            attempts: readonly AuditionAttempt[];
            script?: string;
            writer?: string;
            reason?: string;
        },
    ): Promise<void> {
        await this.db
            .insertInto('deadair.personaAuditionBreaks')
            .values({
                auditionId,
                ordinal,
                previous: toJsonb(written.previous),
                next: toJsonb(written.next),
                attempts: toJsonb([...written.attempts]),
                script: written.script ?? null,
                writer: written.writer ?? null,
                reason: written.reason ?? null,
            })
            .execute();

        await this.db
            .updateTable('deadair.personaAuditions')
            .set({ cursor: ordinal + 1 })
            .where('id', '=', auditionId)
            .where('cursor', '=', ordinal)
            .execute();
    }

    /** Every transition is written. Refuses a settled row, so a cancelled run does not report `done`. */
    async finish(id: string): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.personaAuditions')
            .set({ state: 'done', finishedAt: instant(Date.now()) })
            .where('id', '=', id)
            .where('state', 'not in', ['done', 'failed', 'cancelled'])
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * A job threw, and this says what happened.
     *
     * Refuses to overwrite a SETTLED row on `ProductionRepository.fail`'s argument: a run somebody
     * cancelled did not fail, and reporting it as though it had would make the record say something
     * that did not happen.
     */
    async fail(id: string, error: string): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.personaAuditions')
            .set({ state: 'failed', error, finishedAt: instant(Date.now()) })
            .where('id', '=', id)
            .where('state', 'not in', ['done', 'failed', 'cancelled'])
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /** Stop one, terminally. Refuses a run that has already settled. */
    async cancel(id: string): Promise<boolean> {
        const row = await this.db
            .updateTable('deadair.personaAuditions')
            .set({ state: 'cancelled', cancelledAt: instant(Date.now()), finishedAt: instant(Date.now()) })
            .where('id', '=', id)
            .where('state', 'not in', ['done', 'failed', 'cancelled'])
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * Keep the newest runs for one character and drop the rest.
     *
     * A bound rather than a sweeper job, because an audition is an operator pressing a button while
     * tuning a sheet: the table grows in bursts of one person's afternoon and is never read beyond
     * the last few runs. A nightly prune job would be more machinery than the thing it swept, and
     * the breaks go with the run through the cascade.
     */
    async prune(personaId: string, keep = 30): Promise<number> {
        const result = await this.db
            .deleteFrom('deadair.personaAuditions')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaId', '=', personaId)
            .where(({ eb, selectFrom }) =>
                eb(
                    'id',
                    'not in',
                    selectFrom('deadair.personaAuditions')
                        .select('id')
                        .where('stationKey', '=', this.station.stationKey)
                        .where('personaId', '=', personaId)
                        .orderBy('createdAt', 'desc')
                        .limit(keep),
                ),
            )
            .executeTakeFirst();

        return Number(result?.numDeletedRows ?? 0);
    }
}

/**
 * Epoch millis as something the column will take.
 *
 * Through SQL rather than as a value, exactly as `production.repository.ts` and
 * `segment.repository.ts` do it: Postgres is handed a number and does the conversion itself, so the
 * `DateTime`-versus-`Date` mismatch in the generated types never has to be resolved here.
 */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/** A timestamp column as epoch millis. Both shapes handled, per `production.repository.ts`. */
function millisOf(value: DateTime | null): number | undefined {
    if (value == null) return undefined;
    return value instanceof Date ? value.getTime() : value.toMillis();
}

/** One run as the rest of the app reads it. */
function toAudition(row: Record<string, unknown>): Audition {
    const cancelledAt = millisOf(row.cancelledAt as DateTime | null);
    const finishedAt = millisOf(row.finishedAt as DateTime | null);

    return {
        id: String(row.id),
        stationKey: String(row.stationKey),
        personaId: String(row.personaId),
        personaKey: String(row.personaKey),
        sourcePluginId: String(row.sourcePluginId),
        sourcePlaylistId: String(row.sourcePlaylistId),
        ...(row.sourceName == null ? {} : { sourceName: String(row.sourceName) }),
        records: (row.records ?? []) as AuditionRecord[],
        transitions: Number(row.transitions),
        cursor: Number(row.cursor),
        state: row.state as AuditionState,
        ...(row.error == null ? {} : { error: String(row.error) }),
        ...(cancelledAt === undefined ? {} : { cancelledAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        ...(row.actorId == null ? {} : { actorId: String(row.actorId) }),
        createdAt: millisOf(row.createdAt as DateTime | null) ?? 0,
    };
}

/** One break as the rest of the app reads it. */
function toBreak(row: Record<string, unknown>): AuditionBreak {
    return {
        id: String(row.id),
        auditionId: String(row.auditionId),
        ordinal: Number(row.ordinal),
        previous: row.previous as AuditionRecord,
        next: row.next as AuditionRecord,
        attempts: (row.attempts ?? []) as AuditionAttempt[],
        ...(row.script == null ? {} : { script: String(row.script) }),
        ...(row.writer == null ? {} : { writer: String(row.writer) }),
        ...(row.reason == null ? {} : { reason: String(row.reason) }),
        createdAt: millisOf(row.createdAt as DateTime | null) ?? 0,
    };
}
