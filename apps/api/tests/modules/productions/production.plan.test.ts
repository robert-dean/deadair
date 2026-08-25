// The shape of a production, which is arithmetic and never the model's. The expensive lesson behind
// every case here: asked to decide its own beat count, a model gives one story one beat, so one
// story in a ten-minute show meant a single beat asked to carry about 1300 spoken words.

import { describe, expect, it } from 'vitest';

import {
    beatCount,
    expectedWords,
    MAX_BEATS,
    MAX_EXPECTED_WORDS,
    MAX_WORDS,
    MIN_WORDS,
    planProduction,
    spreadItems,
    TURN_BAND,
    wordBudget,
    WORDS_PER_MINUTE,
} from '../../../src/modules/productions/production.plan.js';

const minutes = (count: number) => count * 60_000;

describe('wordBudget', () => {
    it('turns a duration into words at the station speaking rate', () => {
        expect(wordBudget(minutes(10))).toBe(1600);
        expect(wordBudget(minutes(1))).toBe(160);
    });

    it('floors at something sayable rather than at zero', () => {
        // A production commissioned for a few seconds is a very short production, not one with no
        // words at all.
        expect(wordBudget(1_000)).toBe(MIN_WORDS);
    });
});

describe('beatCount', () => {
    // THE case. Ten minutes is 1600 words; one beat would be unwritable and the model would return
    // something short and shapeless instead.
    it('never asks one beat to carry a ten-minute show', () => {
        const beats = beatCount(wordBudget(minutes(10)));

        expect(beats).toBeGreaterThan(1);
        expect(wordBudget(minutes(10)) / beats).toBeLessThanOrEqual(MAX_WORDS);
    });

    it('keeps every beat inside the band, from both ends', () => {
        // Up to the point the beat ceiling binds, which is the next case.
        for (const length of [2, 5, 10, 20, 30]) {
            const words = wordBudget(minutes(length));
            const each = words / beatCount(words);

            expect(each).toBeGreaterThanOrEqual(MIN_WORDS);
            expect(each).toBeLessThanOrEqual(MAX_WORDS);
        }
    });

    // The one place the band is deliberately broken, and it is a trade rather than a bug: past the
    // ceiling a production either fans out into hundreds of model calls or asks each beat for more
    // than the band. It asks for more — and `expectedWords` is what stops the check then burning a
    // re-draft on every beat for being "too short" against a number no completion reaches.
    it('goes over the band rather than past the beat ceiling, and says so through expectedWords', () => {
        const words = wordBudget(minutes(45));
        const each = words / beatCount(words);

        expect(beatCount(words)).toBe(MAX_BEATS);
        expect(each).toBeGreaterThan(MAX_WORDS);
        expect(expectedWords(Math.round(each))).toBeLessThanOrEqual(MAX_EXPECTED_WORDS);
    });

    it('gives a very short production a single beat', () => {
        expect(beatCount(MIN_WORDS)).toBe(1);
        expect(beatCount(20)).toBe(1);
    });

    // Otherwise a feature-length production fans out into hundreds of model calls.
    it('stops multiplying beats at the ceiling', () => {
        expect(beatCount(wordBudget(minutes(600)))).toBe(MAX_BEATS);
    });
});

describe('planProduction', () => {
    it('numbers the beats from zero, in order', () => {
        const shape = planProduction(minutes(10));

        expect(shape.beats.map(beat => beat.ordinal)).toEqual(shape.beats.map((_, index) => index));
    });

    it('spends the whole budget, to the word', () => {
        for (const length of [3, 7, 10, 23]) {
            const shape = planProduction(minutes(length));
            const spent = shape.beats.reduce((total, beat) => total + beat.words, 0);

            expect(spent).toBe(wordBudget(minutes(length)));
        }
    });

    // Dumping the remainder on the last beat leaves it measurably longer than every other and, at
    // the ceiling, outside the band the check judges it against.
    it('spreads the remainder rather than dumping it on the last beat', () => {
        const shape = planProduction(minutes(7));
        const sizes = shape.beats.map(beat => beat.words);

        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    it('gives every beat a budget inside the band for an ordinary production', () => {
        for (const beat of planProduction(minutes(15)).beats) {
            expect(beat.words).toBeGreaterThanOrEqual(MIN_WORDS);
            expect(beat.words).toBeLessThanOrEqual(MAX_WORDS);
        }
    });
});

describe('expectedWords', () => {
    it('leaves an ordinary target alone', () => {
        expect(expectedWords(200)).toBe(200);
    });

    // Past MAX_BEATS a beat is handed a budget no single completion reaches, and judging "too short"
    // against it would burn a re-draft on every beat of a feature-length production.
    it('caps what a beat is judged against, however much it was asked for', () => {
        expect(expectedWords(1_300)).toBe(MAX_EXPECTED_WORDS);
    });
});

describe('spreadItems', () => {
    it('gives every item at least one beat', () => {
        const groups = spreadItems(['a', 'b', 'c'], 3);

        expect(groups.flat()).toEqual(['a', 'b', 'c']);
    });

    it('groups neighbours when there are more items than beats', () => {
        const groups = spreadItems(['a', 'b', 'c', 'd'], 2);

        expect(groups).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
        expect(groups.flat()).toHaveLength(4);
    });

    it('gives one subject several beats when there are more beats than items', () => {
        const groups = spreadItems(['a'], 3);

        expect(groups).toHaveLength(3);
        // Every beat gets the item, which the outline then takes different angles on.
        expect(groups.every(group => group.length === 1)).toBe(true);
    });

    it('answers an empty group per beat when there are no items at all', () => {
        expect(spreadItems([], 3)).toEqual([[], [], []]);
    });

    it('answers nothing for no beats, rather than dividing by zero', () => {
        expect(spreadItems(['a'], 0)).toEqual([]);
    });
});

// A conversation is planned in a different band, and the reason the band exists at all is that the
// monologue floor of 150 words is a SPEECH when somebody is answering a question.
describe('planning a dialogue', () => {
    it('writes turns rather than beats, so nobody makes a speech', () => {
        const turns = planProduction(minutes(3), { dialogue: true }).beats;
        const monologue = planProduction(minutes(3)).beats;

        expect(turns.length).toBeGreaterThan(monologue.length);
        for (const turn of turns) expect(turn.words).toBeLessThanOrEqual(TURN_BAND.max);
    });

    it('keeps the turn count odd, so the host can both open and close', () => {
        // The format is host, caller, host, …, host. An even count makes those two rules collide on
        // the last turn, so the shape is decided here rather than papered over where speakers are
        // assigned.
        for (const length of [2, 3, 4, 5, 8, 12]) {
            expect(planProduction(minutes(length), { dialogue: true }).beats.length % 2).toBe(1);
        }
    });

    it('rounds the count DOWN, so a programme never runs past the slot it was given', () => {
        // One turn short of the budget is a shorter programme; one turn over is a slot that
        // overruns, and a production is a block inside somebody's running order.
        const budget = wordBudget(minutes(3), WORDS_PER_MINUTE, TURN_BAND);
        const spoken = planProduction(minutes(3), { dialogue: true }).beats.reduce((total, beat) => total + beat.words, 0);

        expect(spoken).toBeLessThanOrEqual(budget);
    });

    it('carries who says each turn, when it was told', () => {
        const plan = planProduction(minutes(3), { dialogue: true, speakers: [0, 1, 0, 1, 0] });

        expect(plan.beats.slice(0, 3).map(beat => beat.speaker)).toEqual([0, 1, 0]);
    });

    it('gives an unnamed turn to the first of the cast rather than nobody', () => {
        // A speaker list shorter than the plan is the arithmetic disagreeing with itself, and the
        // presenter is the safe answer: every production the station made before callers was theirs.
        const plan = planProduction(minutes(3), { dialogue: true, speakers: [0, 1] });

        expect(plan.beats.every(beat => beat.speaker !== undefined)).toBe(true);
        expect(plan.beats[plan.beats.length - 1]?.speaker).toBe(0);
    });

    it('leaves a monologue exactly as it was, which is what a station with no callers still gets', () => {
        expect(planProduction(minutes(10))).toEqual(planProduction(minutes(10), { dialogue: false }));
        expect(planProduction(minutes(10)).beats.every(beat => beat.speaker === undefined)).toBe(true);
    });
});
