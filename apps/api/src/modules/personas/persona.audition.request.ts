/**
 * What an audition tells the writers.
 *
 * The one place the substrate for an auditioned break is assembled, and a PURE function of what it
 * is handed: no repository, no config, no clock. That is what makes it testable — the interesting
 * assertions here are about what an audition deliberately does and does not carry, and every one of
 * them would otherwise need a database and a model to make.
 *
 * ## It mirrors `WriteBreakJob`, minus what only a slot can supply
 *
 * The point of an audition is that a break written for it is written from the same substrate an
 * on-air break gets, since a measurement taken against a thinner prompt measures a different
 * station. So this carries the persona, the notebook, the story, the preoccupation, the records with
 * their facts, the time of day, the station's name and what the run has already said.
 *
 * Four fields are deliberately absent, and each is absent for its own reason rather than by
 * oversight:
 *
 * - **`clock`** — the hour, in words. It is gated on `airsAt` and on `clock.namesTheTime` on air,
 *   because a phrasing is only as true as the slot it was computed for. An audition has no slot: a
 *   break written now and read in an hour would name a time that never applied to it.
 * - **`airsAt`** — what `patienceFor` computes the model's queue patience from. Absent gives the
 *   30-second default, which is the right patience for something an operator is watching.
 * - **`played`** — what this broadcast has played. An audition is not a broadcast, and the records
 *   it has been through are already the previous side of every transition it has written.
 * - **`pads` and `reactions`** — the soundboard and the engine's cues. Both exist to be PERFORMED,
 *   and an audition is read on a page. Offering them would have the host reach for a sting that
 *   nothing here can play, and `floorPad` would then append a cue to a script nobody renders.
 *
 * `priority` is `preview` at every transition. The station always outranks somebody at the desk, and
 * losing the race is a legitimate answer that the run reports as an ordinary decline.
 */

import { TALK_BREAK_KIND } from '#modules/director/talk.break.writer.js';
import { dayGreeting, dayPart } from '#modules/director/clock.words.js';
import { preoccupationOf } from './persona.sheet.js';
import type { BreakTrack, BreakWriteRequest } from '#modules/director/break.writer.js';
import type { Persona } from './persona.js';
import type { PersonaNotesForPrompt } from './persona.note.js';
import type { PersonaStoryForPrompt } from './persona.story.js';
import type { AuditionRecord } from './persona.audition.js';

/** What one transition needs to know about itself, gathered by the job that is writing it. */
export interface AuditionRequestInput {
    /** The character being auditioned. The one NAMED, never whoever is presenting. */
    persona: Persona;
    /** What it has accumulated, read and NOT rested. See the job. */
    notebook?: PersonaNotesForPrompt;
    /** The one story this transition may draw on, chosen and not stamped. */
    story?: PersonaStoryForPrompt;
    /** The record this break follows, and the one it leads into, facts already attached. */
    previous: AuditionRecord;
    next: AuditionRecord;
    /** Short true things about each side, keyed by the catalog id. Absent for a record nothing knows. */
    facts?: { previous?: readonly string[]; next?: readonly string[] };
    /** What this RUN has already said, newest first. Not the station's history: see the job. */
    recent: readonly string[];
    /** Something stable and unique to this transition, which the preoccupation is spread over. */
    turn: string;
    /** What the station calls itself. */
    station: string;
    /** The station's zone, for the time of day. */
    zone: string;
    /** Now, as epoch millis. A parameter so a reading is repeatable in a test. */
    now: number;
}

/**
 * One record as a writer sees it.
 *
 * Optionals spread one at a time rather than passed through, which is `neighboursOf`'s rule and the
 * reason for it is measurable: `describe` in the prompt tests truthiness and drops what is empty, so
 * a field arriving as an empty string reaches the model as "album ." — which aired.
 *
 * `artist` falls back to a phrase rather than an empty string, again as the on-air path does: a
 * provider that gave no credit would otherwise have the host announce a record by nobody.
 */
export function toBreakTrack(record: AuditionRecord, facts?: readonly string[]): BreakTrack {
    return {
        title: record.title,
        // `||` and not `??`: a record with no credit carries the empty string rather than nothing.
        artist: record.artist || 'an unknown artist',
        ...(record.trackId === undefined ? {} : { trackId: record.trackId }),
        ...(record.year === undefined ? {} : { year: record.year }),
        ...(record.album === undefined ? {} : { album: record.album }),
        ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
        ...(facts === undefined || facts.length === 0 ? {} : { facts }),
    };
}

/**
 * The request one transition of an audition is written from.
 *
 * The `greeting` and the `dayPart` are computed from `now` and offered to every kind, exactly as the
 * job offers them: which breaks have any business greeting anybody is the writer's question, and
 * answering it here would put a decision about one kind of break in the code that serves all of
 * them. `moment` rides along for the guard that refuses a script naming the wrong time of day —
 * without it a host auditioned at four in the afternoon can say "morning" and nothing objects.
 */
export function auditionRequest(input: AuditionRequestInput): BreakWriteRequest {
    const greeting = dayGreeting(input.now, input.zone);
    const preoccupation = preoccupationOf(input.persona, input.turn);

    return {
        kind: TALK_BREAK_KIND,
        previous: toBreakTrack(input.previous, input.facts?.previous),
        next: toBreakTrack(input.next, input.facts?.next),
        station: input.station,
        persona: input.persona,
        ...(input.notebook === undefined ? {} : { notebook: input.notebook }),
        ...(input.story === undefined ? {} : { story: input.story }),
        ...(preoccupation === undefined ? {} : { preoccupation }),
        // What this RUN has said, which is what makes the spent-signature rule mean anything over a
        // playlist. The rehearsal passes `[]` for repeatability, and that is the right call for one
        // break against a fixed pair; over twenty transitions it would measure a host landing its
        // signature phrase every time, which is a repetition no broadcast produces.
        recent: input.recent,
        // Absent in the small hours by design, which is the one stretch `dayPart` covers and this
        // does not.
        ...(greeting === undefined ? {} : { greeting }),
        dayPart: dayPart(input.now, input.zone),
        moment: { at: input.now, zone: input.zone },
        // The station is always more important than hearing what it would have said. An audition
        // queues behind every break and refill and is taken off the model the moment one arrives, at
        // which point the registry falls through and the run records the floor's line — which is a
        // legitimate answer rather than a failure, and one of the attempts the console draws.
        priority: 'preview',
    };
}
