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
import type { Duration } from 'luxon';

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

function build(
    options: { claimed?: Audition; result?: unknown; found?: Persona; recent?: string[]; facts?: Map<string, string[]>; shelf?: unknown[] } = {},
) {
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
    // `forPrompt` is here so a test can assert the job does NOT use it: it answers the same story
    // until somebody stamps, and stamping is the one thing an audition must not do.
    const forPrompt = vi.fn(async () => ({ id: 's1', story: { title: 'The Barstow lights', story: 'Three lights.', details: [], timesTold: 1 } }));
    const tellable = vi.fn(async () => options.shelf ?? [{ title: 'The Barstow lights', story: 'Three lights.', details: [], timesTold: 1 }]);
    const stories = { forPrompt, tellable, markTold } as never;

    // Typed by its parameters, so the assertions below can read the ids and the options off the
    // call rather than casting them back out of an empty tuple.
    const factsForTracks = vi.fn(
        async (_ids: readonly string[], _rotate?: number, _options?: { stamp?: boolean }) => options.facts ?? new Map<string, string[]>(),
    );
    const enrichment = { factsForTracks } as never;

    const seen: BreakWriteRequest[] = [];
    const write = vi.fn(async (request: BreakWriteRequest) => {
        seen.push(request);
        return options.result ?? WROTE;
    });
    const writers = { write } as never;

    // Typed by its parameters, so a test can read the payload and the send options off the call.
    const send = vi.fn(async (_name: string, _payload: AuditionPayload, _options?: { startAfter?: Duration }) => {});
    const jobs = { send } as never;

    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

    const job = new PersonaAuditionJob(
        auditions,
        personas,
        notes,
        stories,
        enrichment,
        writers,
        jobs,
        config,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    const run = (payload?: AuditionPayload) => (job as unknown as { execute: (input?: AuditionPayload) => Promise<void> }).execute(payload);

    return { run, claim, recordBreak, finish, fail, recentScripts, find, markUsed, markTold, forPrompt, tellable, factsForTracks, write, send, seen };
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

describe('PersonaAuditionJob: the facts and the stories', () => {
    it('asks only about the records the station actually holds', async () => {
        const withIds = audition({
            records: [record({ trackId: 't1' }), record({ externalId: 'track-2' }), record({ externalId: 'track-3', trackId: 't3' })],
        });
        const { run, factsForTracks } = build({ claimed: withIds });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // One side is in the catalog and the other is not, which is the ordinary case on a
        // provider playlist.
        expect(factsForTracks.mock.calls[0]?.[0]).toEqual(['t1']);
    });

    it('never asks at all when neither record is in the catalog', async () => {
        const { run, factsForTracks } = build({ claimed: audition() });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(factsForTracks).not.toHaveBeenCalled();
    });

    it('reads the facts WITHOUT spending their cooldown', async () => {
        const withIds = audition({ records: [record({ trackId: 't1' }), record({ externalId: 'track-2', trackId: 't2' })] });
        const { run, factsForTracks } = build({ claimed: withIds });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // A claim handed over is on a week-long cooldown. A run of twenty transitions that stamped
        // would put a week of the station's best claims out of reach of the breaks meant to say them.
        expect(factsForTracks.mock.calls[0]?.[2]).toEqual({ stamp: false });
    });

    it('shows each side its own facts', async () => {
        const withIds = audition({ records: [record({ trackId: 't1' }), record({ externalId: 'track-2', trackId: 't2' })] });
        const { run, seen } = build({
            claimed: withIds,
            facts: new Map([
                ['t1', ['Cut in a single afternoon.']],
                ['t2', ['Written in one sitting.']],
            ]),
        });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(seen[0]?.previous?.facts).toEqual(['Cut in a single afternoon.']);
        expect(seen[0]?.next?.facts).toEqual(['Written in one sitting.']);
    });

    it('writes the break anyway when the facts cannot be read', async () => {
        const withIds = audition({ records: [record({ trackId: 't1' }), record({ externalId: 'track-2', trackId: 't2' })] });
        const { run, factsForTracks, recordBreak } = build({ claimed: withIds });
        factsForTracks.mockRejectedValueOnce(new Error('the enrichment tables are unreachable'));

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // Best-effort: facts that could not be read cost the transition its facts, never its break.
        expect(recordBreak).toHaveBeenCalled();
    });

    it('reads the whole shelf rather than the one story a break would rest', async () => {
        const { run, tellable, forPrompt } = build({ claimed: audition() });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(tellable).toHaveBeenCalledWith('pirate');
        // `forPrompt` answers the same story until somebody stamps it, and stamping is the one
        // thing an audition must not do — so using it would tell one anecdote at every transition.
        expect(forPrompt).not.toHaveBeenCalled();
    });

    it('offers a different story as the run goes on', async () => {
        const shelf = [
            { title: 'The Barstow lights', story: 'Three lights.', details: [], timesTold: 1 },
            { title: 'The night shift', story: 'Nobody came in.', details: [], timesTold: 0 },
        ];

        const first = build({ claimed: audition(), shelf });
        await first.run({ auditionId: 'audition-1', ordinal: 0 });

        const second = build({ claimed: audition(), shelf });
        await second.run({ auditionId: 'audition-1', ordinal: 1 });

        expect(first.seen[0]?.story?.title).toBe('The Barstow lights');
        expect(second.seen[0]?.story?.title).toBe('The night shift');
    });

    it('offers no story to a character that never tells one', async () => {
        const { run, tellable, seen } = build({ claimed: audition(), found: persona({ storytelling: 'never' }) });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(tellable).not.toHaveBeenCalled();
        expect(Object.keys(seen[0]!)).not.toContain('story');
    });

    it('withholds the story from an occasional teller when the records already have something to say', async () => {
        // The default rung fires exactly where the prompt would otherwise hand a model a
        // prohibition and nothing else — the moment that produced invented pressing plants.
        const withIds = audition({ records: [record({ trackId: 't1' }), record({ externalId: 'track-2', trackId: 't2' })] });
        const { run, seen } = build({
            claimed: withIds,
            found: persona({ storytelling: 'occasionally' }),
            facts: new Map([['t1', ['Cut in a single afternoon.']]]),
        });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(Object.keys(seen[0]!)).not.toContain('story');
    });

    it('offers one to an occasional teller when the station knows nothing about the records', async () => {
        const { run, seen } = build({ claimed: audition(), found: persona({ storytelling: 'occasionally' }) });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(seen[0]?.story?.title).toBe('The Barstow lights');
    });
});

describe('PersonaAuditionJob: a busy station', () => {
    /** The model lost to the station, and the floor covering for it — which on air is a good outcome. */
    const PREEMPTED = {
        written: { script: 'Bill Withers there.' },
        writer: 'deterministic',
        attempts: [
            {
                writer: 'model',
                outcome: 'failed',
                durationMs: 30_000,
                reason: 'the model writer failed: the station needed the model',
                code: 'unavailable',
            },
            { writer: 'deterministic', outcome: 'written', durationMs: 1, written: { script: 'Bill Withers there.' } },
        ],
    };

    it('waits and asks again rather than recording the floor', async () => {
        const { run, recordBreak, send } = build({ claimed: audition(), result: PREEMPTED });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // Recording this would tell an operator the floor covered a transition their character was
        // never asked about — a fact about a busy Tuesday reported as a fact about the sheet.
        expect(recordBreak).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith('personas.audition', { auditionId: 'audition-1', ordinal: 0, waited: 1 }, expect.anything());
    });

    it('leaves the model alone for a while before trying again', async () => {
        const { run, send } = build({ claimed: audition(), result: PREEMPTED });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // What is being waited out is a busy station rather than a queue, so it is longer than the
        // gate's own patience — asking again the moment the queue clears just loses the race again.
        expect(send.mock.calls[0]![2]?.startAfter?.as('seconds')).toBeGreaterThan(30);
    });

    it('takes the answer as it stands once it has waited long enough', async () => {
        const { run, recordBreak, send } = build({ claimed: audition(), result: PREEMPTED });

        await run({ auditionId: 'audition-1', ordinal: 0, waited: 3 });

        // There is no state that means "and it will be free eventually". A station busy for three
        // quarters of an hour is one to read the floor's lines from, with the reason saying so.
        expect(recordBreak).toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith('personas.audition', { auditionId: 'audition-1', ordinal: 1 });
    });

    it('records a model that DECLINED rather than waiting for it', async () => {
        // Declining is the reading an audition exists to collect: the model had the slot and chose
        // to say nothing.
        const { run, recordBreak, send } = build({ claimed: audition(), result: NOTHING });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        expect(recordBreak).toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith('personas.audition', { auditionId: 'audition-1', ordinal: 1 });
    });

    it('records a writer that actually broke rather than waiting for it', async () => {
        const broken = {
            attempts: [{ writer: 'model', outcome: 'failed', durationMs: 12, reason: 'the model writer failed: undefined is not a function' }],
            reason: 'every writer had nothing to say',
        };
        const { run, recordBreak } = build({ claimed: audition(), result: broken });

        await run({ auditionId: 'audition-1', ordinal: 0 });

        // No code, so nothing says this was the station's doing. Waiting on it would hide a fault
        // behind a run that never finishes.
        expect(recordBreak).toHaveBeenCalled();
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
