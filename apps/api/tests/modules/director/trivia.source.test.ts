// What a trivia break is written from: which kinds it answers for, what it asks the store for, how a
// claim's subject is named, and the two ways of having nothing, neither of which may fail the job.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { FactRepository, TriviaClaim } from '../../../src/modules/enrichment/fact.repository.js';
import { FACT_COOLDOWN_MS, MAX_FACT_CHARS } from '../../../src/modules/enrichment/enrichment.read.service.js';
import { TRIVIA_KIND } from '../../../src/modules/director/trivia.kind.js';
import { TRIVIA_SHOWN, TriviaSource, triviaFactOf } from '../../../src/modules/director/trivia.source.js';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const claim = (overrides: Partial<TriviaClaim> = {}): TriviaClaim => ({
    id: 'fact-1',
    claim: 'Dummy was recorded in Bath over ten months. ',
    level: 'album',
    name: 'Dummy',
    artist: 'Portishead',
    ...overrides,
});

function store(answer: TriviaClaim[] | Error = [claim()]) {
    const findTrivia = vi.fn(async (_cooldownMs: number, _limit: number, _maxChars: number) => {
        if (answer instanceof Error) throw answer;
        return answer;
    });
    return { facts: { findTrivia } as unknown as FactRepository, findTrivia };
}

describe('which breaks it answers for', () => {
    it('answers for a trivia break and asks the store nothing for any other kind', async () => {
        const { facts, findTrivia } = store();
        const source = new TriviaSource(facts, logger());

        expect(await source.factsFor('talkbreak')).toBeUndefined();
        expect(await source.factsFor('almanac')).toBeUndefined();
        expect(findTrivia).not.toHaveBeenCalled();

        expect(await source.factsFor(TRIVIA_KIND)).toEqual({
            trivia: [{ factId: 'fact-1', claim: 'Dummy was recorded in Bath over ten months.', about: 'Dummy, by Portishead' }],
        });
    });

    it('asks under the talk break’s own cooldown and length cap, for six', async () => {
        // One cooldown for one store: a claim a link said this week must not come back as trivia.
        const { facts, findTrivia } = store();

        await new TriviaSource(facts, logger()).factsFor(TRIVIA_KIND);

        expect(findTrivia).toHaveBeenCalledWith(FACT_COOLDOWN_MS, TRIVIA_SHOWN, MAX_FACT_CHARS);
        expect(TRIVIA_SHOWN).toBe(6);
    });
});

describe('having nothing', () => {
    it('answers an empty report and says so at info when the store has nothing to offer', async () => {
        const log = logger();
        const { facts } = store([]);

        expect(await new TriviaSource(facts, log).factsFor(TRIVIA_KIND)).toEqual({});
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('passed over the slot'));
    });

    it('absorbs a failed read, because a slot passed over is not a failed job', async () => {
        const log = logger();
        const { facts } = store(new Error('the pool is gone'));

        expect(await new TriviaSource(facts, log).factsFor(TRIVIA_KIND)).toEqual({});
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('the pool is gone'));
    });
});

describe('how a subject is named', () => {
    it('names a track or a record with whoever made it, and an artist alone', () => {
        expect(triviaFactOf(claim({ level: 'track', name: 'Glory Box' })).about).toBe('Glory Box, by Portishead');
        expect(triviaFactOf(claim({ level: 'artist', name: 'Portishead', artist: undefined })).about).toBe('Portishead');
    });

    it('never rewrites the claim beyond trimming it', () => {
        expect(triviaFactOf(claim({ claim: '  It sold 100,000 copies in its first month.\n' })).claim).toBe(
            'It sold 100,000 copies in its first month.',
        );
    });
});
