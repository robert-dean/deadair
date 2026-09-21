import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import {
    PERSONA_NOTE_LIMITS,
    type PersonaNote,
    type PersonaNoteDraft,
    type PersonaNoteKind,
    type PersonaNoteOrigin,
    type PersonaNoteState,
} from './persona.note.js';
import type { PersonaNotesForPrompt } from './persona.note.js';

/** A note on its way in, with the two things only the writer of it knows. */
export interface PersonaNoteWrite extends PersonaNoteDraft {
    personaKey: string;
    state: PersonaNoteState;
    origin: PersonaNoteOrigin;
}

/**
 * What each character has accumulated.
 *
 * Shaped after `PronunciationRepository`, which solves the same problem one table over: a list an
 * operator and a machine both append to, where a proposal that was turned down has to outlive the
 * pass that proposed it.
 *
 * ## The read and the stamp are two calls, deliberately
 *
 * {@link forPrompt} never touches `last_used_at`. The caller that is actually putting words on air
 * calls {@link markUsed} afterwards, which is `FactRepository`'s arrangement and exists for the same
 * reason: a rehearsal reads the notebook to let an operator HEAR the character, and a preview that
 * spent the rotation would leave the next real break with the second-best six.
 *
 * The stamp is at SELECTION rather than at air, which is the same inaccuracy `chooseFacts` buys and
 * against the same alternative — a break dropped before its slot has still rested its notes, and the
 * only way to do better is a second writer of this column that can disagree with the first.
 */
@Injectable()
export class PersonaNotesRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Every note one character holds, in every state, oldest first.
     *
     * The console read. Ordered on the stamp with the id behind it, for `PersonaRepository.list`'s
     * reason: the distil pass writes a batch in one statement, so rows share a timestamp and a sort
     * on it alone reshuffles between reads.
     */
    async list(personaKey: string, state?: PersonaNoteState): Promise<PersonaNote[]> {
        let query = this.db
            .selectFrom('deadair.personaNotes')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc');

        if (state !== undefined) query = query.where('state', '=', state);

        return (await query.execute()).map(row => ({
            id: row.id,
            personaKey: row.personaKey,
            kind: row.kind,
            note: row.note,
            state: row.state,
            origin: row.origin,
            ...(row.sourceScriptId == null ? {} : { sourceScriptId: row.sourceScriptId }),
            ...(row.sourceQuote == null ? {} : { sourceQuote: row.sourceQuote }),
            ...(row.lastUsedAt == null ? {} : { lastUsedAt: row.lastUsedAt.toISO() ?? '' }),
            createdAt: row.createdAt.toISO() ?? '',
        }));
    }

    /**
     * What a break should be told about this character, capped and rotated.
     *
     * Two queries rather than one, because the caps are per KIND and a single ordered read would let
     * a character with a dozen sayings crowd out every trait it has. Both are ordered least-recently
     * used first, so a notebook larger than its cap comes round rather than showing the same six
     * lines until somebody edits it.
     *
     * Answers empty lists for a character with nothing, which is what keeps a prompt built around a
     * bare persona byte-identical to one built around no notebook at all.
     */
    async forPrompt(personaKey: string): Promise<{ notes: PersonaNotesForPrompt; ids: string[] }> {
        const [trait, said] = await Promise.all([this.chooseKind(personaKey, 'trait'), this.chooseKind(personaKey, 'said')]);

        return {
            notes: { trait: trait.map(row => row.note), said: said.map(row => row.note) },
            ids: [...trait, ...said].map(row => row.id),
        };
    }

    /**
     * Rest the notes that were just carried into a break.
     *
     * Separate from the read so a caller that is not on air does not spend anything. See the class
     * note.
     */
    async markUsed(ids: readonly string[]): Promise<void> {
        if (ids.length === 0) return;

        await this.db
            .updateTable('deadair.personaNotes')
            .set({ lastUsedAt: sql`now()` })
            .where('stationKey', '=', this.station.stationKey)
            .where('id', 'in', [...ids])
            .execute();
    }

    /** Writes one note and answers with it. */
    async add(write: PersonaNoteWrite): Promise<PersonaNote> {
        const row = await this.db.insertInto('deadair.personaNotes').values(this.valuesFor(write)).returning('id').executeTakeFirstOrThrow();

        return (await this.list(write.personaKey)).find(note => note.id === row.id)!;
    }

    /**
     * Writes several, skipping anything this character already holds in the same words.
     *
     * `on conflict do nothing` against the partial unique index rather than a read and then a write,
     * for `PronunciationRepository.addAll`'s reason: the distil pass and an operator's own note can
     * land in the same moment, and the loser of that race should be the machine.
     *
     * Answers how many rows were actually written, which is what the pass reports and what decides
     * whether the activity feed hears about it at all.
     */
    async addAll(writes: readonly PersonaNoteWrite[]): Promise<number> {
        if (writes.length === 0) return 0;

        const written = await this.db
            .insertInto('deadair.personaNotes')
            .values(writes.map(write => this.valuesFor(write)))
            .onConflict(conflict => conflict.doNothing())
            .returning('id')
            .execute();

        return written.length;
    }

    /** Rewrites one note's words. An operator editing what the station wrote is the point of the panel. */
    async update(id: string, note: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaNotes')
            .set({ note: note.trim(), updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Accepts or turns down a proposal, or takes a note out of use without losing it. */
    async setState(id: string, state: PersonaNoteState): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaNotes')
            .set({ state, updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Removes one note outright, which is the operator's own to do. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.personaNotes')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /** Whether this character already holds a note in these words, in any state including `rejected`. */
    async holds(personaKey: string, note: string): Promise<boolean> {
        const found = await this.db
            .selectFrom('deadair.personaNotes')
            .select('id')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where(sql<boolean>`lower(btrim(note)) = lower(btrim(${note}))`)
            .executeTakeFirst();

        return found !== undefined;
    }

    /**
     * How far the distil pass has read this character, or `undefined` for never.
     *
     * A watermark rather than a mark per script, which is where this parts company with
     * `fact_extractions`: documents arrive individually and in no order, so each needs its own mark,
     * while scripts are a time-ordered stream and one timestamp says everything about what has been
     * seen. A pass that read forty scripts and wrote nothing still moves it, which is the property
     * that table exists for — a pass that yielded nothing must not look like one that never ran.
     *
     * Carried as the column's own TEXT rather than as a `DateTime`, which is the same precision
     * argument `ScriptHistoryRepository.writtenBy` makes at the other end and has to hold at both:
     * Luxon is millisecond-resolution and Postgres is microsecond, so a watermark that went through
     * a `DateTime` would compare as earlier than the row it was taken from and re-read it forever.
     */
    async readThrough(personaKey: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.personaNotePasses')
            .select(sql<string | null>`read_through::text`.as('readThrough'))
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .executeTakeFirst();

        return row?.readThrough ?? undefined;
    }

    /**
     * Move the watermark, and record that a pass ran at all.
     *
     * `ran_at` moves on every pass and `read_through` only when something was actually read, so a
     * character whose window is still filling up (below `MIN_SCRIPTS`) is visibly being looked at
     * without its scripts being consumed.
     */
    async markRead(personaKey: string, readThrough: string | undefined): Promise<void> {
        await this.db
            .insertInto('deadair.personaNotePasses')
            .values({
                stationKey: this.station.stationKey,
                personaKey,
                readThrough: (readThrough === undefined ? null : sql`${readThrough}::timestamptz`) as never,
                ranAt: sql`now()` as never,
            })
            .onConflict(conflict =>
                conflict.columns(['stationKey', 'personaKey']).doUpdateSet({
                    ranAt: sql`now()`,
                    // Never backwards. Two passes cannot legitimately overlap, but a hand-run one
                    // against an older window should not un-read what the nightly pass already has.
                    readThrough: sql`greatest(deadair.persona_note_passes.read_through, excluded.read_through)`,
                }),
            )
            .execute();
    }

    /**
     * What a rollback to this moment would take out of the notebook, and what it would unsettle.
     *
     * Counted with the same predicates {@link rollbackAfter} deletes with, so a preview cannot
     * promise one thing and do another. `to` is the column's own text — see {@link readThrough} for
     * why a `DateTime` here reads as earlier than the row it came from.
     */
    async countAfter(personaKey: string, to: string): Promise<{ notes: number; rejected: number; touched: number }> {
        const row = await this.db
            .selectFrom('deadair.personaNotes')
            .select([
                sql<string>`count(*)`.as('notes'),
                // Rows kept ONLY so the nightly pass stops re-proposing them. Deleting one is
                // honest — it never happened — but the pass may well write it again, and an
                // operator who turned it down deserves to be told that before it reappears.
                sql<string>`count(*) filter (where state = 'rejected')`.as('rejected'),
                // A proposal an operator has since accepted or edited. It still goes, because it is
                // the station's row, but it is the one kind of loss they did not cause.
                sql<string>`count(*) filter (where updated_at > created_at)`.as('touched'),
            ])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('origin', '=', 'model')
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirstOrThrow();

        return { notes: Number(row.notes), rejected: Number(row.rejected), touched: Number(row.touched) };
    }

    /**
     * Undo what the STATION accrued in this notebook after a moment, and nothing an operator wrote.
     *
     * Two statements, and the second is not optional. Deleting the rows the pass wrote is only half
     * of "put this character back": a note written long before `to` that has been CARRIED since
     * still holds a `last_used_at` from after it, and leaving that stamp means the rotation resumes
     * where the rolled-back station left off rather than where it actually stood.
     *
     * `origin = 'operator'` rows are never touched, which is the whole shape of this feature: an
     * operator is undoing the station's work, not their own.
     */
    async rollbackAfter(personaKey: string, to: string): Promise<number> {
        const removed = await this.db
            .deleteFrom('deadair.personaNotes')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('origin', '=', 'model')
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirst();

        await this.db
            .updateTable('deadair.personaNotes')
            .set({ lastUsedAt: null })
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where(sql<boolean>`last_used_at > ${to}::timestamptz`)
            .execute();

        return Number(removed.numDeletedRows);
    }

    /**
     * Drag the distil watermark BACK, so the pass reads that window again.
     *
     * Deliberately not {@link markRead}, which is `greatest(...)` and cannot go backwards — that
     * guard is right for two passes racing and wrong for an operator who has just deleted what a
     * pass concluded. This is the only writer allowed to move it down, and it is asked for
     * explicitly: re-learning is right for testing and wrong for "this character drifted, undo it",
     * so nothing here decides which of those an operator meant.
     *
     * `least` rather than a bare set, so rolling back to a moment the pass had not yet reached does
     * not accidentally move the watermark FORWARD and skip scripts nothing has read.
     */
    async pullReadThrough(personaKey: string, to: string): Promise<void> {
        await this.db
            .updateTable('deadair.personaNotePasses')
            .set({ readThrough: sql`least(read_through, ${to}::timestamptz)` as never })
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .execute();
    }

    private async chooseKind(personaKey: string, kind: PersonaNoteKind): Promise<{ id: string; note: string }[]> {
        return await this.db
            .selectFrom('deadair.personaNotes')
            .select(['id', 'note'])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('state', '=', 'active')
            .where('kind', '=', kind)
            // Least recently used first, and `nulls first` so a note that has never been carried is
            // ahead of every note that has. Then oldest, so the order is stable between two reads a
            // second apart rather than whatever the planner felt like.
            .orderBy(sql`last_used_at asc nulls first`)
            .orderBy('createdAt', 'asc')
            .limit(PERSONA_NOTE_LIMITS[kind])
            .execute();
    }

    private valuesFor(write: PersonaNoteWrite) {
        return {
            stationKey: this.station.stationKey,
            personaKey: write.personaKey,
            kind: write.kind,
            note: write.note.trim(),
            state: write.state,
            origin: write.origin,
            sourceScriptId: write.sourceScriptId ?? null,
            sourceQuote: write.sourceQuote ?? null,
        };
    }
}
