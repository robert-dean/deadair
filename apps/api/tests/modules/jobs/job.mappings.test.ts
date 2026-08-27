// A queue consumes one job at a time unless a worker policy says otherwise, so a caller that sends
// two of something is not thereby doing two of them at once. `playout.cache_track` is the one place
// in the station where that distinction is load-bearing and the one mapping that declares a worker
// policy at all, which is what both assertions here hold in place.

import { describe, expect, it } from 'vitest';

import { JobMappings } from '../../../src/modules/jobs/job.mappings.js';
import { FETCH_PER_PASS } from '../../../src/modules/playout/audio/track.cache.planner.js';

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
