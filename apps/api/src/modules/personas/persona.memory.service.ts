import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import type { PersonaMemory, PersonaMemoryChange, PersonaMemoryRollback, PersonaMemoryTimeline } from './types/personas.types.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { PersonaTellingRepository } from './persona.telling.repository.js';

/**
 * Postgres's own name for "before everything", which is what a RESET is.
 *
 * A reset is not a second operation here, it is a rollback with no moment given: every predicate is
 * `created_at > to`, and every real timestamp is after `-infinity`. That keeps one code path, which
 * matters more than it looks — a separate reset would be a second thing to keep in step with every
 * store this grows to cover.
 */
const BEGINNING = '-infinity';

/**
 * Undoing what a character accumulated, back to a moment an operator picks.
 *
 * ## What this is for, and what it deliberately cannot do
 *
 * A station whose characters grow on their own needs a way back, or every experiment is permanent
 * and the only safe setting is off. This is that way back, and it is also the reason the autonomy
 * switch can exist at all: a mistake the operator can undo in one click is a mistake they can afford
 * to let the station make.
 *
 * It undoes what the STATION accrued and never what an operator wrote. Rows with `origin =
 * 'operator'` are left exactly where they are, in every store. An operator rolling back is undoing
 * the machine's work, not their own, and a "restore the snapshot" that quietly took their own
 * writing with it would make this the dangerous button rather than the safe one.
 *
 * ## Three things it cannot put back, all of them stated rather than hidden
 *
 * **What the distil pass read.** `script_history` is swept nightly, so pulling the watermark back
 * past `render.scriptHistoryDays` asks the pass to re-derive notes from scripts that are gone. It
 * will read what survives and no more. Rolling back can forget; it cannot re-remember.
 *
 * **A proposal that was turned down.** `rejected` rows exist so the nightly pass stops offering the
 * same line forever. Deleting one is honest — it never happened — but the pass may well write it
 * again, so the preview counts them separately and the console says so.
 *
 * **A break already written.** One planned before the rollback and aired after it stamps a telling
 * that no longer exists, so `markAired` matches nothing and the airing goes unrecorded. It is a
 * narrow window, it costs one row rather than anything a listener hears, and it is the price of not
 * holding the running order still while somebody edits history.
 *
 * ## The moment is TEXT, and that is load-bearing
 *
 * Every timestamp in and out of here is the column's own text. Luxon is millisecond-resolution and
 * Postgres is microsecond, so a moment taken from a row, truncated through a `DateTime`, and handed
 * back compares as EARLIER than the row it came from — which would delete the row an operator
 * clicked "roll back to here" on. {@link momentFrom} therefore parses the value only to REJECT a
 * malformed one and passes the operator's own string through untouched.
 */
@Injectable()
export class PersonaMemoryService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly tellings: PersonaTellingRepository,
        private readonly activity: ActivityRecorder,
    ) {}

    /** What this character has told, newest first. The console's timeline, and what a moment is picked from. */
    async timeline(id: string): Promise<PersonaMemoryTimeline> {
        const personaKey = await this.keyFor(id);

        return { personaId: id, tellings: await this.tellings.timeline(personaKey) };
    }

    /** What {@link rollback} would undo, counted with the predicates it deletes with. */
    async preview(id: string, query: { to?: string }): Promise<PersonaMemoryChange> {
        const personaKey = await this.keyFor(id);

        return await this.plan(personaKey, momentFrom(query.to));
    }

    /**
     * Undo it.
     *
     * Counted before anything is deleted, because the counts are what an operator is told happened
     * and a count taken afterwards is all zeroes. The whole method runs inside the request's
     * transaction — this path is not in `transaction.exemptions.ts` and must not be added to it, or
     * a failure half way leaves a character with its stories rolled back and its notebook not.
     */
    async rollback(id: string, body: PersonaMemoryRollback): Promise<PersonaMemory> {
        const personaKey = await this.keyFor(id);
        const to = momentFrom(body.to);

        const undone = await this.plan(personaKey, to);

        await this.tellings.removeAfter(personaKey, to);
        await this.notes.rollbackAfter(personaKey, to);
        await this.stories.rollbackAfter(personaKey, to);
        // Nothing to put back in step: the rotation and the telling count are READ off the ledger
        // rather than stored beside it, so cutting the ledger down is the whole of undoing them.
        // That is most of why the ledger is worth having.

        // Asked for rather than assumed, and off by default. Re-reading the window is right when an
        // operator is testing and wrong when they are undoing a character that drifted: the second
        // wants the conclusions gone, and moving the watermark back invites the same pass to reach
        // the same conclusions tonight.
        if (body.relearn === true) await this.notes.pullReadThrough(personaKey, to);

        void this.activity.record({
            // `director`, as both persona passes record themselves: who the station is presenting as
            // is a programming fact, and the feed's modules are about where an operator would look.
            module: 'director',
            kind: 'persona.memoryRolledBack',
            detail:
                body.to === undefined
                    ? `Everything ${personaKey} had accumulated on its own was cleared. What was written by hand is untouched.`
                    : `What ${personaKey} accumulated after ${body.to} was undone. What was written by hand is untouched.`,
            data: { personaKey, to: body.to ?? null, relearn: body.relearn === true, ...undone },
        });

        return { personaId: id, undone, tellings: await this.tellings.timeline(personaKey) };
    }

    /** The counts, from the three stores that hold anything a rollback would take. */
    private async plan(personaKey: string, to: string): Promise<PersonaMemoryChange> {
        const [tellings, notes, stories] = await Promise.all([
            this.tellings.countAfter(personaKey, to),
            this.notes.countAfter(personaKey, to),
            this.stories.countAfter(personaKey, to),
        ]);

        return {
            tellings,
            notes: notes.notes,
            stories: stories.stories,
            details: stories.details,
            // Summed across the stores rather than reported per store, because what an operator is
            // deciding is one thing: whether they mind. Which table a turned-down proposal was in is
            // not part of that question.
            rejected: notes.rejected + stories.rejected,
            touched: notes.touched + stories.touched,
        };
    }

    /**
     * The persona's KEY from the id in the path.
     *
     * The route names a persona by id because that is what the console holds; everything a character
     * accumulates is keyed by its key, which is the stable name. `PersonaNotesService.keyFor`'s job,
     * one service over, and for the same reason.
     */
    private async keyFor(id: string): Promise<string> {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        return persona.key;
    }
}

/**
 * The operator's moment, checked but NOT converted.
 *
 * Parsed only to refuse a malformed one with a 400 rather than letting `::timestamptz` fail as a
 * 500, and then thrown away: what goes to the database is the operator's own string, because that
 * string came out of a row's `created_at::text` and is the only form that compares against it
 * exactly. See the class note.
 */
function momentFrom(to: string | undefined): string {
    if (to === undefined) return BEGINNING;

    const parsed = DateTime.fromSQL(to, { setZone: true });
    const iso = parsed.isValid ? parsed : DateTime.fromISO(to, { setZone: true });
    if (!iso.isValid) throw httpError(400).withDetails({ message: `"${to}" is not a moment this station can read` });

    return to;
}
