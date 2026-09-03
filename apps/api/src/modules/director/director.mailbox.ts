/**
 * The one way in to the director: commands, handled one at a time, in order.
 *
 * ## Why a queue rather than method calls
 *
 * Everything that changes what the station is airing arrives from somewhere with
 * its own lifetime. A rundown event fires from the pusher's loop, an operator's
 * change from a request scope, a refill from a job scope, and each of them used
 * to call the director directly. The director's own work spans awaits — it reads
 * `station_air`, plants breaks, looks segments up — and the event loop is free at
 * every one of them, so a caller could and did land in the middle of a decision
 * and change the state it was about to be applied to.
 *
 * The tree's answer to that so far is a fencing token plus five flags, one per
 * way of being interrupted, each added after the interruption it guards against
 * had already shipped a bug. A serial queue answers the whole class instead: if
 * only one command runs at a time, there is no middle to land in.
 *
 * ## The rule that keeps this from becoming a bottleneck
 *
 * **Commands are short.** Anything slow — generating a set, reading a provider,
 * rendering, walking the catalog — happens BEFORE the command is posted, and the
 * command carries the result. A command that awaited a rate-limited provider
 * would hold the station's only decision-making path for as long as that took,
 * and a track boundary would wait behind it.
 *
 * That is not a new discipline. It is what `DirectorService.commit` already does
 * around its epoch check, where everything slow is gathered first and the
 * mutation is one uninterrupted stretch afterwards. This makes it the rule for
 * every writer rather than for one method.
 *
 * A handler that gathers stale material is fine and expected: it re-validates
 * against the state it finds, and the state it finds cannot change underneath it.
 */

import type { RundownTrack } from '#modules/playout/rundown.js';
import type { BreakRequest, BreakRequestResult } from './break.request.js';
import type { EditResult, StationLineupBinding } from './station.lineup.js';

/**
 * A change to the running order made by somebody at the desk.
 *
 * Its own union rather than five more arms on {@link DirectorCommand}, because
 * these are the operator's vocabulary and they share one answer: the edit happened,
 * or precisely why it did not. See {@link EditResult}.
 */
export type OrderEdit =
    | { kind: 'shuffle' }
    | { kind: 'move'; itemId: string; toIndex: number }
    | { kind: 'remove'; itemId: string }
    // `segmentKind` rather than `kind`, which this command has already spent on saying what it is.
    // Carried from the caller because the caller has already loaded the row and the order would
    // otherwise have to read it back to know what the break spacing should count this against.
    | { kind: 'insertSegment'; segmentId: string; atIndex?: number; overAtMs?: number; segmentKind?: string }
    // The whole `RundownTrack`, not a trackId, for the reason `insertSegment` carries `segmentKind`:
    // `DirectorConsoleService.addTrackToOrder` has already resolved which provider binding will
    // play and confirmed its audio is local, and the order would otherwise have to do both again.
    | { kind: 'insertTrack'; track: RundownTrack; atIndex?: number };

/**
 * Something the director has been asked to do.
 *
 * Deliberately only the arms that have a caller. Arms are added by the phase that
 * migrates their writer, because a union describing commands nobody sends is a
 * description of an intention rather than of this program.
 */
export type DirectorCommand =
    /** Something changed what the player is holding; top the running order up. */
    | { kind: 'wake' }
    /**
     * Read what the station was doing and pick it back up: what boot does.
     *
     * A command like everything else, because it ends in a commit pass and a pass run
     * outside the queue has a second one running beside it the moment it awaits — its
     * own append announces a change, which posts a wake. Both then reach the refill
     * guard before either has set it.
     */
    | { kind: 'restore' }
    /**
     * Put the station back on air with the running order it already has.
     *
     * The counterpart to `standDown`, and deliberately NOT `putOnAir`: that one replaces the order
     * from material somebody has just read, which is a new broadcast. This resumes the one that was
     * stopped, mid-order, with every item still saying where it got to — which is exactly what
     * `StationAirRepository.standDown` leaves behind and what nothing could pick back up before.
     *
     * It answers whether there was anything to resume, so a console can say why nothing happened
     * rather than reporting a station on air that is holding nothing.
     */
    | { kind: 'resume' }
    /** The station is going off air, from the transport or from an order that ended. */
    | { kind: 'standDown' }
    /**
     * Put the station on air with a new running order, built from these records.
     *
     * Carries the material rather than naming a row to read, which is the whole
     * shape of stage 2: the source is a PLAYLIST, it is read at the moment the
     * operator presses the button, and the running order built from it is the
     * director's own state. Reading a provider is the slow half and happens before
     * this is posted.
     */
    | { kind: 'putOnAir'; binding: StationLineupBinding; tracks: readonly RundownTrack[] }
    /**
     * A refill has finished generating: put these records at the end of the order.
     *
     * Carries the tracks because generating them is the slow half — a sample, two
     * history reads, and rate-limited providers to come. All this does is append,
     * which is what keeps a refill from holding the station's only decision-making
     * path for the length of a provider call.
     */
    | { kind: 'appendTracks'; tracks: readonly RundownTrack[] }
    /**
     * A replan has finished generating: put these records where everything still planned was.
     *
     * The sibling of {@link appendTracks} and carries material for the same reason. What is
     * different is that it takes something away, which is why the generating happens first: the
     * order the station is airing keeps its tail until there is a replacement to put there, so a
     * model that takes minutes costs the operator a wait rather than costing the station its
     * mount lease. See `ReplanLineupJob`.
     */
    | { kind: 'replaceTail'; tracks: readonly RundownTrack[] }
    /**
     * Change what the operator has asked this broadcast for. Absent or empty clears it.
     *
     * A command of its own rather than a field on {@link replaceTail}, because the two happen
     * minutes apart and in that order: the brief has to be on the row BEFORE `ReplanLineupJob`
     * reads it, since that is what the fresh set is programmed against. It outlives the replan too
     * — every later refill reads the same row — which is the whole reason the brief lives on the
     * running order rather than in a job's payload.
     */
    | { kind: 'rebrief'; brief?: string }
    /**
     * Who is presenting has changed. Re-check who that is, and re-open the breaks the outgoing
     * host wrote and the station has not aired yet.
     *
     * **`bind` is what happened rather than what to do.** Present means this BROADCAST was recast
     * and its own host is now `bind.personaId` — absent inside it clears the binding, handing the
     * show back to the station's. Absent means the STATION's active persona changed and this
     * broadcast's binding is not to be touched: a show that named its own host keeps it, which is
     * `PersonaRepository.presenting`'s precedence and not a rule this command may quietly reverse.
     *
     * One command rather than two because both end in the same question — is what the station is
     * about to say still in character — and because only the director can answer it: the cut
     * between what the player is holding and what is still free is its own state.
     */
    | { kind: 'recast'; bind?: { personaId?: string } }
    /**
     * Somebody at the desk changed the order. Answers with whether it took.
     *
     * The edit is applied HERE rather than by the caller, because the running order
     * is the director's own state and there is no copy for a request to edit. That is
     * the difference stage 2 makes: an edit used to be a write to a row that the
     * reactor then re-read, with all the racing that implies.
     */
    | { kind: 'edit'; edit: OrderEdit }
    /**
     * Something outside the running order wants the station to say something.
     *
     * A listener arriving, a bulletin, an operator at the desk. The producer says what sort of break
     * and how soon; WHERE it goes is decided here, because the director is the only thing that knows
     * what is committed and what is still free. Answers whether it took and, when it did not, a
     * sentence saying why — a decline is an ordinary outcome rather than a failure.
     */
    | { kind: 'requestBreak'; request: BreakRequest };

/** Whether a resume found a running order to pick back up. */
export interface ResumeResult {
    resumed: boolean;
}

/** What a handled command answers with. Only an edit, a resume and a request have anything to say. */
export type DirectorCommandResult = EditResult | ResumeResult | BreakRequestResult | undefined;

/** One posted command and the caller waiting on it. */
interface Envelope {
    command: DirectorCommand;
    resolve: (result: DirectorCommandResult) => void;
    reject: (error: unknown) => void;
}

export class DirectorMailbox {
    private readonly waiting: Envelope[] = [];
    private draining = false;

    /**
     * @param handle - What to do with a command. Called one at a time, never
     *   re-entered, and awaited to completion before the next command starts.
     */
    constructor(private readonly handle: (command: DirectorCommand) => Promise<DirectorCommandResult>) {}

    /**
     * Hand a command over, and find out how it went.
     *
     * The promise settles when THIS command has been handled, not when it was
     * accepted, which is what lets a request answer with the state its own change
     * produced rather than with a promise that it will happen shortly.
     *
     * Rejects with whatever the handler threw. A caller with nobody to tell —
     * a listener on the pusher's loop, say — must catch, or an unhandled rejection
     * takes the process down for a failure the next tick would have retried.
     */
    post(command: DirectorCommand): Promise<DirectorCommandResult> {
        return new Promise<DirectorCommandResult>((resolve, reject) => {
            this.waiting.push({ command, resolve, reject });
            void this.drain();
        });
    }

    /** How many commands are waiting, for a test or a log line. Never for a decision. */
    depth(): number {
        return this.waiting.length;
    }

    /**
     * Work through the queue until it is empty.
     *
     * Re-entrant by design rather than by accident: a handler that posts is
     * appending to the array this loop is reading, so its command is picked up by
     * the same drain rather than starting a second one. That is what makes "the
     * director committed, which emitted a change, which woke the director" a queue
     * entry instead of a stack frame.
     *
     * One command's failure is its own. The loop keeps going, because the commands
     * behind it were sent by other callers about other things, and a station that
     * stopped taking decisions because one of them threw would be a worse failure
     * than the one that started it.
     */
    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;

        try {
            while (this.waiting.length > 0) {
                const envelope = this.waiting.shift()!;
                try {
                    envelope.resolve(await this.handle(envelope.command));
                } catch (error) {
                    envelope.reject(error);
                }
            }
        } finally {
            this.draining = false;
        }
    }
}
