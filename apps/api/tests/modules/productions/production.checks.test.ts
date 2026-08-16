// A beat judged without a model, which is the whole point: a model asked whether its own draft is
// good says yes, and everything worth catching here is measurable. The empty-beat case is not
// defensive — a model that spends its entire output allowance on reasoning returns exactly that, and
// this station's own logs show it happening.

import { describe, expect, it } from 'vitest';

import { checkBeat, correctionNote, countWords, DUPLICATE_OVERLAP, trigramOverlap } from '../../../src/modules/productions/production.checks.js';

/** A beat of about `count` words, distinct enough not to trip the repetition check by accident. */
const words = (count: number, seed = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet') => {
    const pool = seed.split(' ');
    return Array.from({ length: count }, (_, index) => pool[index % pool.length]).join(' ');
};

const beat = (text: string, overrides: Partial<Parameters<typeof checkBeat>[0]> = {}) => checkBeat({ text, words: 200, ordinal: 1, ...overrides });

describe('checkBeat', () => {
    it('finds nothing wrong with a beat of about the right length', () => {
        expect(beat(words(200))).toEqual([]);
    });

    // Not a defensive case. A model whose output allowance is consumed by reasoning before it emits
    // any text returns exactly this, with finishReason=length.
    it('reports an empty beat and nothing else, because there is nothing else to judge', () => {
        const problems = beat('   ');

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/came back empty/i);
    });

    describe('length', () => {
        it('catches a beat that came back as a sentence', () => {
            expect(beat(words(20))[0]).toMatch(/too short/i);
        });

        it('catches one that ran away', () => {
            expect(beat(words(600))[0]).toMatch(/far too long/i);
        });

        it('leaves a beat that is merely a bit over or under alone', () => {
            // The budget is an instruction about pace rather than a contract, and a beat ten percent
            // long is a beat that had something to say.
            expect(beat(words(220))).toEqual([]);
            expect(beat(words(170))).toEqual([]);
        });

        // Past the beat ceiling a beat is asked for more than any single completion produces, so
        // judging "too short" against the ask would burn a re-draft on every beat of a long
        // production.
        it('judges a huge ask against the expected ceiling rather than the ask', () => {
            expect(checkBeat({ text: words(300), words: 1_300, ordinal: 1 })).toEqual([]);
        });
    });

    describe('re-introducing the programme', () => {
        it('catches a mid-programme beat that welcomes the listener again', () => {
            const problems = beat('Welcome back to the show. ' + words(200));

            expect(problems.some(problem => /introduces the programme again/i.test(problem))).toBe(true);
        });

        it('allows it in the first beat, which is where an opening belongs', () => {
            expect(checkBeat({ text: 'Welcome to the show. ' + words(200), words: 200, ordinal: 0 })).toEqual([]);
        });
    });

    describe('repeating an earlier beat', () => {
        it('catches a beat that restates one already written', () => {
            const earlier = words(200);
            const problems = beat(earlier, { priorBeats: [earlier] });

            expect(problems.some(problem => /repeats an earlier one/i.test(problem))).toBe(true);
        });

        it('leaves a beat that shares a phrase or two alone', () => {
            const earlier = words(200, 'one two three four five six seven eight nine ten');
            expect(beat(words(200), { priorBeats: [earlier] })).toEqual([]);
        });

        it('says nothing about repetition for the first beat, which has nothing to repeat', () => {
            expect(checkBeat({ text: words(200), words: 200, ordinal: 0, priorBeats: [] })).toEqual([]);
        });
    });

    // A beat is re-drafted at most once, so the one correction it gets has to carry everything wrong
    // with it: fixing the length and being told about the repetition on a second pass that never
    // comes is worse than useless.
    it('reports every problem at once rather than the first one it finds', () => {
        const earlier = words(200);
        const problems = beat('Welcome back to the show. ' + earlier.split(' ').slice(0, 20).join(' '), { priorBeats: [earlier] });

        expect(problems.length).toBeGreaterThan(1);
        // Length first: it is the one that changes what the beat has room to say.
        expect(problems[0]).toMatch(/too short/i);
    });
});

describe('trigramOverlap', () => {
    it('is 1 for a text against itself', () => {
        expect(trigramOverlap(words(50), words(50))).toBe(1);
    });

    it('is 0 for two texts with nothing in common', () => {
        expect(trigramOverlap('one two three four', 'alpha bravo charlie delta')).toBe(0);
    });

    it('ignores case and punctuation, so a repeat cannot hide behind them', () => {
        expect(trigramOverlap('The 808 was cheap.', 'the 808 was cheap!')).toBe(1);
    });

    // Judged against the SHORTER side: a short beat lifted wholesale from a long one shares only a
    // fraction of the long one's phrases, and the other way round would miss it.
    it('catches a short beat lifted whole out of a long one', () => {
        const long = words(200);
        const lifted = long.split(' ').slice(0, 40).join(' ');

        expect(trigramOverlap(long, lifted)).toBeGreaterThanOrEqual(DUPLICATE_OVERLAP);
    });

    it('answers 0 rather than dividing by zero when there is nothing to compare', () => {
        expect(trigramOverlap('', 'one two three')).toBe(0);
        expect(trigramOverlap('two words', 'one two three')).toBe(0);
    });
});

describe('countWords', () => {
    it('counts spoken words and ignores the whitespace around them', () => {
        expect(countWords('  one   two\nthree ')).toBe(3);
        expect(countWords('   ')).toBe(0);
    });
});

describe('correctionNote', () => {
    // A model handed its own draft and a list of complaints edits around them and keeps the shape
    // that produced them, which is what fails again on a beat that was too short.
    it('asks for a rewrite from scratch rather than a fix', () => {
        const note = correctionNote(['too short', 'repeats an earlier beat']);

        expect(note).toMatch(/rewrite it from scratch/i);
        expect(note).toContain('- too short');
        expect(note).toContain('- repeats an earlier beat');
    });
});
