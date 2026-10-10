// A queue consumes one job at a time unless a worker policy says otherwise, so a caller that sends
// two of something is not thereby doing two of them at once. `playout.cache_track` is the one place
// in the station where that distinction is load-bearing and the one mapping that declares a worker
// policy at all, which is what both assertions here hold in place.

import { describe, expect, it } from 'vitest';

import { JobMappings } from '../../../src/modules/jobs/job.mappings.js';
import { FETCH_PER_PASS } from '../../../src/modules/playout/audio/track.cache.planner.js';
import { MAX_PLANNING_ATTEMPTS } from '../../../src/modules/director/plan.records.js';
import { BUDGET_MS, MAX_WAIT_MS } from '../../../src/modules/director/model.set.generator.js';
import { EXTEND_GUARD_MS } from '../../../src/modules/director/director.service.js';

/** The worker policy on a mapping, in either mapping form. */
const workerOf = (name: keyof typeof JobMappings) => {
    const mapping = JobMappings[name];
    return typeof mapping === 'function' ? undefined : mapping.worker;
};

describe('JobMappings worker policies', () => {
    // The ripener asks for `FETCH_PER_PASS` records a pass and its own comment has always called
    // that two downloads at a time. That was true of the sends and false of the bytes until this
    // policy existed: one worker meant the second record's fetch started when the first one's
    // finished, so a cold running order filled at exactly the one-per-pass rate the constant was
    // raised to escape. Reading the constant is what keeps the two numbers from drifting apart, and
    // this is what fails if somebody drops the policy again.
    it('gives the record fetcher as many workers as the ripener sends records', () => {
        expect(workerOf('playout.cache_track')?.concurrency).toBe(FETCH_PER_PASS);
    });

    // The widening is safe HERE and nowhere else, which is a claim worth a test rather than only a
    // comment. `TrackAudioService` de-duplicates by source id, so a second worker cannot start a
    // second download of one record; the two queues most likely to attract the same edit are the
    // opposite case, since `render.segment` and `director.write_break` serialize on `SpeechGate` and
    // `LlmGate` and a second worker there holds a claimed job against its `expiresIn` waiting for a
    // resource it cannot have.
    it('leaves every other queue at one job at a time', () => {
        const declared = Object.keys(JobMappings).filter(name => workerOf(name as keyof typeof JobMappings) !== undefined);
        expect(declared).toEqual(['playout.cache_track']);
    });
});

describe('JobMappings for the queues that plan records', () => {
    /** How long a mapping lets one run take before pg-boss aborts it, in milliseconds. */
    const expiresInMs = (name: keyof typeof JobMappings) => {
        const mapping = JobMappings[name];
        if (typeof mapping === 'function') throw new Error(`${name} declares no policy`);
        return mapping.policy?.expiresIn?.as('milliseconds') ?? 0;
    };

    // pg-boss aborts a run at `expiresIn` and every planning job reads the abort as "throw the plan
    // away", so a ceiling under the model's own worst case discards the work rather than bounding it.
    // That is what silenced the station on 2026-10-10 at three minutes. Read off the generator's own
    // constants, so raising the model's budget without raising this fails here rather than on air.
    const worstModelMs = MAX_PLANNING_ATTEMPTS * (MAX_WAIT_MS + BUDGET_MS);

    it.each(['director.extend_lineup', 'director.replan_lineup', 'schedule.prepare_slot'] as const)(
        '%s outlasts every planning attempt the model may take, with room to resolve after',
        name => {
            expect(expiresInMs(name)).toBeGreaterThanOrEqual(worstModelMs + 2 * 60_000);
        },
    );

    // The director re-asks the moment its refill guard runs out, so a guard shorter than the job's own
    // limit sends a second refill while the first is still planning. It was five minutes against
    // twelve when the limit was raised and nothing tied the two together.
    it("holds the refill guard past the refill job's own limit", () => {
        expect(EXTEND_GUARD_MS).toBeGreaterThan(expiresInMs('director.extend_lineup'));
    });

    // With no retry of its own, the director's re-ask is the only one, and two would plan the same
    // hour: pg-boss starts a retry the moment it gives up on a run that is still holding the model.
    it('leaves retrying a refill to the director', () => {
        const mapping = JobMappings['director.extend_lineup'];
        expect(typeof mapping === 'function' ? undefined : mapping.policy?.retryLimit).toBe(0);
    });
});
