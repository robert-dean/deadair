// A rehearsal has two jobs and they pull against each other: report EVERYTHING the writers said, and
// be able to say nothing at all. So the tests here are mostly about what does not happen — no row is
// written, the on-air persona is not consulted, and a busy model is an answer rather than an error.
//
// The substrate is the other half. A rehearsal an operator runs twice on the same sheet must give
// two comparable readings, which is why the records are constants and `recent` is empty: both are
// things that would otherwise move under the measurement.

import { describe, expect, it, vi } from 'vitest';

import { PersonaRehearsalService, REHEARSAL_NEXT, REHEARSAL_PREVIOUS } from '../../../src/modules/personas/persona.rehearsal.service.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: false,
    ...over,
});

/**
 * The notebook as the service sees it.
 *
 * `markUsed` is here so a test can assert it was NOT called: reading the notebook is what makes a
 * rehearsal sound like the character, and resting it would move the rotation under the next real
 * break — the same class of thing as `recent` being empty.
 */
const notebook = (notes: { trait: string[]; said: string[] } = { trait: [], said: [] }) => ({
    forPrompt: vi.fn(async () => ({ notes, ids: notes.trait.length + notes.said.length === 0 ? [] : ['n1'] })),
    markUsed: vi.fn(),
});

/**
 * The character's own stories, as the service sees them.
 *
 * Nothing by default, which is every station until somebody writes one down. The interesting case is
 * that this is READ and never stamped: a rehearsal that spent a story would hand the next real break
 * the second-best one.
 */
const shelf = (story?: { title: string; story: string; details: string[]; timesTold: number }) => ({
    forPrompt: vi.fn(async () => (story === undefined ? undefined : { id: 's1', story })),
    markTold: vi.fn(),
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const config = (title = 'Dead Air') => ({ get: (_: string, fallback: string) => (title === '' ? fallback : title) });

/** The registry as the service sees it: one `write`, plus the request it was handed. */
function registry(result: unknown) {
    const seen: BreakWriteRequest[] = [];
    return {
        seen,
        write: vi.fn(async (request: BreakWriteRequest) => {
            seen.push(request);
            return result;
        }),
    };
}

const twoAttempts = {
    written: { script: 'Ahoy, me hearties.', label: 'a break' },
    writer: 'model',
    attempts: [{ writer: 'model', outcome: 'written', written: { script: 'Ahoy, me hearties.', label: 'a break' }, durationMs: 900 }],
};

const declinedThenFloor = {
    written: { script: 'That was Green Onions.', label: 'a break' },
    writer: 'deterministic',
    attempts: [
        { writer: 'model', outcome: 'declined', reason: 'the model wrote in plain English rather than in character', durationMs: 1200 },
        { writer: 'deterministic', outcome: 'written', written: { script: 'That was Green Onions.', label: 'a break' }, durationMs: 2 },
    ],
};

describe('PersonaRehearsalService', () => {
    it('rehearses the persona NAMED, never the one on air', async () => {
        const personas = { find: vi.fn(async () => persona()), active: vi.fn(), presenting: vi.fn() };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');

        expect(personas.find).toHaveBeenCalledWith('p1');
        // The whole point is hearing a character that is NOT on air, so resolving the presenting one
        // here would make the page answer a different question from the one its button asks.
        expect(personas.presenting).not.toHaveBeenCalled();
        expect(personas.active).not.toHaveBeenCalled();
        expect(writers.seen[0]?.persona?.key).toBe('pirate');
    });

    it('runs against fixed invented records and no history, so two readings can be compared', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');
        await service.rehearse('p1');

        for (const request of writers.seen) {
            expect(request.previous).toEqual(REHEARSAL_PREVIOUS);
            expect(request.next).toEqual(REHEARSAL_NEXT);
            // Empty rather than the station's real scripts: `recent` is what makes a signature phrase
            // spent, so real history would decline a script for repeating something the operator
            // never heard — and would decline a different one on every click.
            expect(request.recent).toEqual([]);
            expect(request.station).toBe('Dead Air');
        }
    });

    // The one thing a rehearsal must never do, and the reason the field exists at all. It reaches the
    // model down the same path a real break does, so without saying so it contends for the station's
    // one model slot on equal terms with a break that is about to air — and `LlmGate` would then take
    // the model back from the BREAK rather than from the audition.
    it('asks for the model as a preview, so the station outranks it', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');

        expect(writers.seen[0]?.priority).toBe('preview');
    });

    // The notebook is the one thing a rehearsal reads that it could also CHANGE, and the split
    // between the two repository calls is the whole reason it does not. An operator clicking rehearse
    // three times must not hand the next real break this character's fourth-choice lines.
    it('carries the notebook and rests none of it', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const notes = notebook({ trait: ['has taken to calling the listener a shipmate'], said: ['called Booker T. the tightest band alive'] });
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notes as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');

        expect(notes.forPrompt).toHaveBeenCalledWith('pirate');
        expect(writers.seen[0]?.notebook?.trait).toEqual(['has taken to calling the listener a shipmate']);
        expect(writers.seen[0]?.notebook?.said).toEqual(['called Booker T. the tightest band alive']);
        expect(notes.markUsed).not.toHaveBeenCalled();
    });

    // The same bargain one table over, and the stakes are higher: a break carries at most one story,
    // so an operator clicking rehearse three times would put three of them out of reach of the next
    // real break and leave the store claiming each had been told.
    it("carries one of the character's stories and spends none of it", async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const stories = shelf({ title: 'The Barstow lights', story: 'You saw three lights over the desert.', details: [], timesTold: 0 });
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            stories as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');

        expect(stories.forPrompt).toHaveBeenCalledWith('pirate');
        expect(writers.seen[0]?.story?.title).toBe('The Barstow lights');
        expect(stories.markTold).not.toHaveBeenCalled();
    });

    // Part of how the character currently stands, so a rehearsal has to carry it: an operator who
    // filled the box in and heard none of it would have no way to tell a subject that reads badly
    // from one the model ignored.
    it('carries one of the preoccupations, and the same one every reading', async () => {
        const personas = { find: vi.fn(async () => persona({ preoccupations: ['the ship\'s manifest', 'the tide tables', 'the harbourmaster'] })) };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');
        await service.rehearse('p1');

        expect(writers.seen[0]?.preoccupation).toBeDefined();
        // Repeatable for `recent: []`'s reason: two readings of one character have to be comparable,
        // and a subject that moved between them would make them two characters.
        expect(writers.seen[1]?.preoccupation).toBe(writers.seen[0]?.preoccupation);
    });

    it('sends none for a character with none, which is every seed the station shipped with', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await service.rehearse('p1');

        expect(writers.seen[0]?.preoccupation).toBeUndefined();
    });

    it('reports the decline AND the floor underneath it, not only the winner', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            registry(declinedThenFloor) as never,
            config() as never,
            logger() as never,
        );

        const result = await service.rehearse('p1');

        expect(result.attempts).toHaveLength(2);
        expect(result.attempts[0]).toEqual({
            writer: 'model',
            outcome: 'declined',
            durationMs: 1200,
            reason: 'the model wrote in plain English rather than in character',
        });
        expect(result.attempts[1]?.script).toBe('That was Green Onions.');
        // A model that declined and a floor that covered for it are two facts; the second alone
        // reads as a station that never had a model.
        expect(result.script).toBe('That was Green Onions.');
        expect(result.writer).toBe('deterministic');
    });

    it('answers with a reason and no words when every writer had nothing', async () => {
        const personas = { find: vi.fn(async () => persona()) };
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            registry({
                attempts: [{ writer: 'model', outcome: 'failed', reason: 'the station is busy', durationMs: 10_000 }],
                reason: 'nothing wrote this talkbreak',
            }) as never,
            config() as never,
            logger() as never,
        );

        const result = await service.rehearse('p1');

        // Not a throw. A rehearsal during a busy minute is the station telling the truth about that
        // minute, which is the same answer a real break would have got.
        expect(result.script).toBeUndefined();
        expect(result.writer).toBeUndefined();
        expect(result.reason).toBe('nothing wrote this talkbreak');
        expect(result.attempts[0]?.outcome).toBe('failed');
    });

    it('is a 404 for a persona this station does not have', async () => {
        const personas = { find: vi.fn(async () => undefined) };
        const writers = registry(twoAttempts);
        const service = new PersonaRehearsalService(
            personas as never,
            notebook() as never,
            shelf() as never,
            writers as never,
            config() as never,
            logger() as never,
        );

        await expect(service.rehearse('nope')).rejects.toThrow();
        // And nothing was spent on the model slot finding that out.
        expect(writers.write).not.toHaveBeenCalled();
    });
});
