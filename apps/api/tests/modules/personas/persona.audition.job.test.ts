// A run is a chain of jobs over one row, and everything that can go wrong with that shape is a
// question about the CLAIM. A duplicate delivery, a job for a transition somebody already wrote, and
// a run that was cancelled while a job was in flight all arrive here looking identical, and all three
// must stop before the model: the unique index on (audition, ordinal) means a second break at one
// ordinal is a failed run rather than a wasted generation.
//
// The other half is what a run must not spend. The notebook and the stories are read through their
// reading halves and never rested, because a twenty-transition run that stamped would hand the next
// real break this character's twenty-first-best lines. `markUsed` and `markTold` are faked here
// specifically so the tests can assert they were never called.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { PersonaAuditionJob, type AuditionPayload } from '../../../src/modules/personas/persona.audition.job.js';
import type { Audition, AuditionRecord } from '../../../src/modules/personas/persona.audition.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** What the job hands the repository for one transition. */
type RecordedBreak = {
    previous: AuditionRecord;
    next: AuditionRecord;
    attempts: readonly { writer: string; outcome: string; durationMs: number; script?: string; reason?: string }[];
    script?: string;
    writer?: string;
    reason?: string;
};

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: false,
    ...over,
});

const record = (over: Partial<AuditionRecord> = {}): AuditionRecord => ({
    pluginId: 'spotify',
    externalId: 'track-1',
    title: 'Green Onions',
    artist: 'Booker T. & the M.G.s',
    ...over,
});

const audition = (over: Partial<Audition> = {}): Audition => ({
    id: 'audition-1',
    stationKey: 'main',
    personaId: 'p1',
    personaKey: 'pirate',
    sourcePluginId: 'spotify',
    sourcePlaylistId: 'playlist-1',
    records: [record(), record({ externalId: 'track-2' }), record({ externalId: 'track-3' })],
    transitions: 2,
    cursor: 0,
    state: 'queued',
    createdAt: 0,
    ...over,
});

/** A writer that wrote something, as the registry reports it. */
const WROTE = {
    written: { script: 'That was Green Onions.' },
    writer: 'model',
    attempts: [{ writer: 'model', outcome: 'written', durationMs: 900, written: { script: 'That was Green Onions.' } }],
};

/** Every writer declined, which is a legitimate reading of a sheet rather than a fault. */
const NOTHING = {
    attempts: [
        { writer: 'model', outcome: 'declined', durationMs: 40, reason: 'it named no record' },
        { writer: 'phrasings', outcome: 'declined', durationMs: 1, reason: 'the phrasings writer had nothing to say here' },
    ],
    reason: 'every writer had nothing to say',
};

function build(options: { claimed?: Audition; result?: unknown; found?: Persona; recent?: string[] } = {}) {
    const claim = vi.fn(async () => options.claimed);
    // Typed by its parameters rather than as a bare `vi.fn`, so the assertions below can read the
    // recorded break off the call rather than casting it back out of an empty tuple.
    const recordBreak = vi.fn(async (_auditionId: string, _ordinal: number, _written: RecordedBreak) => {});
    const finish = vi.fn(async () => true);
    const fail = vi.fn(async () => true);
    const recentScripts = vi.fn(async () => options.recent ?? []);
    const auditions = { claim, recordBreak, finish, fail, recentScripts } as never;

    const find = vi.fn(async () => ('found' in options ? options.found : persona()));
    const personas = { find } as never;

    // Both halves are here so the tests can assert the writing ones were never called.
    const markUsed = vi.fn(async () => {});
    const notes = { forPrompt: vi.fn(async () => ({ notes: { trait: ['keeps a logbook'], said: [] }, ids: ['n1'] })), markUsed } as never;

    const markTold = vi.fn(async () => {});
    const stories = {
        forPrompt: vi.fn(async () => ({ id: 's1', story: { title: 'The Barstow lights', story: 'Three lights.', details: [], timesTold: 1 } })),
        markTold,
    } as never;

    const seen: BreakWriteRequest[] = [];
    const write = vi.fn(async (request: BreakWriteRequest) => {
        seen.push(request);
        return options.result ?? WROTE;
    });
    const writers = { write } as never;

    const send = vi.fn(async () => {});
    const jobs = { send } as never;

    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

    const job = new PersonaAuditionJob(
        auditions,
        personas,
        notes,
        stories,
        writers,
        jobs,
        config,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    const run = (payload?: AuditionPayload) => (job as unknown as { execute: (input?: AuditionPayload) => Promise<void> }).execute(payload);

    return { run, claim, recordBreak, finish, fail, recentScripts, find, markUsed, markTold, write, send, seen };
}

describe('PersonaAuditionJob: the claim', () => {
    it('claims the transition it was sent, and no other', async () => {
        const { run, claim } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 1 });

        expect(claim).toHaveBeenCalledWith('audition-1', 1);
    });

    it('writes nothing when the transition was already taken', async () => {
        // A duplicate delivery, or a run somebody cancelled. Both stop here, before the model.
        const { run, write, recordBreak, send, fail } = build({ claimed: undefined });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(write).not.toHaveBeenCalled();
        expect(recordBreak).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        // Not a failure either: the run is fine, this job simply had nothing to do.
        expect(fail).not.toHaveBeenCalled();
    });

    it('does nothing at all when sent no run', async () => {
        const { run, claim } = build();
        await run(undefined);

        expect(claim).not.toHaveBeenCalled();
    });
});

describe('PersonaAuditionJob: writing one transition', () => {
    it('writes the break between the two records at this ordinal', async () => {
        const { run, seen } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 1 });

        // Transition 1 sits between records 1 and 2, which is why three records make two breaks.
        expect(seen[0]?.previous?.title).toBe('Green Onions');
        expect(seen[0]?.next?.title).toBe('Green Onions');
        expect(seen).toHaveLength(1);
    });

    it('auditions the character the run names', async () => {
        const { run, find, seen } = build({ claimed: audition(), found: persona({ key: 'latenight' }) });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(find).toHaveBeenCalledWith('p1');
        expect(seen[0]?.persona?.key).toBe('latenight');
    });

    it('yields the model to the station at every transition', async () => {
        const { run, seen } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(seen[0]?.priority).toBe('preview');
    });

    it('shows the transition what this run has already said', async () => {
        const { run, recentScripts, seen } = build({ claimed: audition(), recent: ['the last thing said'] });
        await run({ auditionId: 'audition-1', ordinal: 1 });

        // The run's own breaks and never `script_history`: an audition must not be shown what the
        // station said, and the station must not be shown what an audition said.
        expect(recentScripts).toHaveBeenCalledWith('audition-1');
        expect(seen[0]?.recent).toEqual(['the last thing said']);
    });

    it('records every writer that was asked, not only the winner', async () => {
        const { run, recordBreak } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(recordBreak).toHaveBeenCalledWith(
            'audition-1',
            0,
            expect.objectContaining({
                script: 'That was Green Onions.',
                writer: 'model',
                attempts: [{ writer: 'model', outcome: 'written', durationMs: 900, script: 'That was Green Onions.' }],
            }),
        );
    });

    it('records a transition nothing wrote, with the reason', async () => {
        const { run, recordBreak, send } = build({ claimed: audition(), result: NOTHING });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        const written = recordBreak.mock.calls[0]![2];
        expect(written).toMatchObject({ reason: 'every writer had nothing to say' });
        expect(Object.keys(written)).not.toContain('script');
        expect(written.attempts).toHaveLength(2);
        // A break nothing wrote is a reading of the sheet, not a broken run: the chain carries on.
        expect(send).toHaveBeenCalled();
    });

    it('keeps the records as they were offered', async () => {
        const { run, recordBreak } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        // What the host said can only be judged against what it was told, and by the time anybody
        // reads the row the facts have rotated.
        expect(recordBreak.mock.calls[0]![2]).toMatchObject({
            previous: expect.objectContaining({ externalId: 'track-1' }),
            next: expect.objectContaining({ externalId: 'track-2' }),
        });
    });
});

describe('PersonaAuditionJob: the chain', () => {
    it('sends the next transition when there is one', async () => {
        const { run, send, finish } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(send).toHaveBeenCalledWith('personas.audition', { auditionId: 'audition-1', ordinal: 1 });
        expect(finish).not.toHaveBeenCalled();
    });

    it('finishes the run after the last transition rather than sending another', async () => {
        const { run, send, finish } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 1 });

        // Two transitions means ordinals 0 and 1, and nothing after.
        expect(send).not.toHaveBeenCalled();
        expect(finish).toHaveBeenCalledWith('audition-1');
    });

    it('stops the chain and says why when the write throws', async () => {
        // The registry absorbs a writer that throws, so this is the layer ABOVE it going wrong: the
        // gate unreachable, the row gone. Recorded rather than rethrown, because an unhandled throw
        // is a retry against a row that has already moved.
        const { run, fail, send, write } = build({ claimed: audition() });
        write.mockRejectedValueOnce(new Error('the model host is unreachable'));

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(fail).toHaveBeenCalledWith('audition-1', 'the model host is unreachable');
        expect(send).not.toHaveBeenCalled();
    });

    it('fails a run whose character has been deleted under it', async () => {
        const { run, fail, write } = build({ claimed: audition(), found: undefined });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(fail).toHaveBeenCalledWith('audition-1', 'the character this was auditioning no longer exists');
        expect(write).not.toHaveBeenCalled();
    });

    it('fails a run whose records do not reach the transition it was sent', async () => {
        const { run, fail, write } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 9 });

        expect(fail).toHaveBeenCalledWith('audition-1', 'this audition has no records for transition 9');
        expect(write).not.toHaveBeenCalled();
    });
});

describe('PersonaAuditionJob: what it does not spend', () => {
    it('carries the notebook without resting it', async () => {
        const { run, markUsed, seen } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(seen[0]?.notebook?.trait).toEqual(['keeps a logbook']);
        // Resting it would hand the next real break this character's second-best lines.
        expect(markUsed).not.toHaveBeenCalled();
    });

    it('carries a story without counting it as told', async () => {
        const { run, markTold, seen } = build({ claimed: audition() });
        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(seen[0]?.story?.title).toBe('The Barstow lights');
        // Stamping would report a telling nobody heard.
        expect(markTold).not.toHaveBeenCalled();
    });
});
