// The shapes a production is made of, and the one place a model's answer becomes one of them.
//
// Two claims are worth pinning here and both were paid for elsewhere first. A hallucinated item index
// must be DROPPED rather than trusted, because it does not fail — it silently points a beat at the
// wrong story and the programme is confidently about something nobody asked for. And a production's
// priority has to move with its slot, because that is what lets three gate tiers cover work that has
// no deadline for hours and then has a real one.

import { describe, expect, it } from 'vitest';

import { coerceOutline, coerceOutlineBeat, isSettled, priorityForSlot } from '../../../src/modules/productions/production.js';

describe('isSettled', () => {
    it('is true for every state nothing more will be spent on', () => {
        expect(isSettled('aired')).toBe(true);
        expect(isSettled('failed')).toBe(true);
        expect(isSettled('cancelled')).toBe(true);
    });

    it('is false for every state a pass can still claim out of', () => {
        for (const state of ['planned', 'outlining', 'drafting', 'checking', 'rendering', 'ready'] as const) {
            expect(isSettled(state)).toBe(false);
        }
    });
});

describe('priorityForSlot', () => {
    const withinMs = 30 * 60_000;
    const now = 1_000_000;

    it('is background for a production nobody scheduled, for its whole life', () => {
        expect(priorityForSlot(undefined, now, withinMs)).toBe('background');
    });

    it('is background while its slot is far off', () => {
        expect(priorityForSlot(now + 6 * 60 * 60_000, now, withinMs)).toBe('background');
    });

    it('rises to air as its slot approaches, which is the whole starvation answer', () => {
        expect(priorityForSlot(now + 10 * 60_000, now, withinMs)).toBe('air');
        // Exactly on the boundary counts as due: the alternative leaves a production one millisecond
        // outside its own window forever if the clock lands badly.
        expect(priorityForSlot(now + withinMs, now, withinMs)).toBe('air');
    });

    it('stays air for a slot already passed, rather than falling back to background', () => {
        // A production that is late is the most urgent one there is, and arithmetic on the raw
        // difference would make it negative and read as "not yet due" under a naive comparison.
        expect(priorityForSlot(now - 60_000, now, withinMs)).toBe('air');
    });

    // The tier is reachable only through a BreakUrgency on something that happened. A production
    // scheduled for 9pm has been known about for hours, which is the opposite kind of thing.
    it('never claims the breaking tier, at any distance', () => {
        for (const at of [now - 1, now, now + 1, now + 10_000_000]) {
            expect(priorityForSlot(at, now, withinMs)).not.toBe('breaking');
        }
    });
});

describe('coerceOutlineBeat', () => {
    it('takes a title and the shape around it', () => {
        const beat = coerceOutlineBeat(
            { title: 'The 808 arrives', angle: 'nobody wanted it', lead: 'HOST', setup: 'mention the price', payoff: 'the price again' },
            3,
        );

        expect(beat).toEqual({
            title: 'The 808 arrives',
            angle: 'nobody wanted it',
            lead: 'HOST',
            setup: 'mention the price',
            payoff: 'the price again',
        });
    });

    it('drops a beat with no title rather than inventing one', () => {
        // A beat called "Untitled" is one the drafting pass writes something arbitrary for.
        expect(coerceOutlineBeat({ angle: 'something' }, 3)).toBeUndefined();
        expect(coerceOutlineBeat({ title: '   ' }, 3)).toBeUndefined();
    });

    it('keeps the item indexes that exist and drops the ones that do not', () => {
        expect(coerceOutlineBeat({ title: 'One', itemIndexes: [0, 2, 9, -1] }, 3)?.itemIndexes).toEqual([0, 2]);
    });

    it('accepts the singular spelling, because models write either', () => {
        expect(coerceOutlineBeat({ title: 'One', itemIndex: 1 }, 3)?.itemIndexes).toEqual([1]);
    });

    it('leaves itemIndexes off entirely when none of them survived', () => {
        // Absent rather than empty: an empty list reads as "this beat covers nothing" where the truth
        // is "the model named things that are not there".
        expect(coerceOutlineBeat({ title: 'One', itemIndexes: [7, 8] }, 3)).not.toHaveProperty('itemIndexes');
    });

    it('deduplicates, so one item named twice does not become two', () => {
        expect(coerceOutlineBeat({ title: 'One', itemIndexes: [1, 1, 1] }, 3)?.itemIndexes).toEqual([1]);
    });
});

describe('coerceOutline', () => {
    it('reads a whole outline', () => {
        const outline = coerceOutline({ throughline: 'a machine nobody wanted', runners: ['the price'], beats: [{ title: 'One' }] }, 1);

        expect(outline).toEqual({ throughline: 'a machine nobody wanted', runners: ['the price'], beats: [{ title: 'One' }] });
    });

    it('keeps the usable beats and drops the rest', () => {
        const outline = coerceOutline({ beats: [{ title: 'One' }, { angle: 'no title' }, null, 'nonsense', { title: 'Two' }] }, 0);

        expect(outline?.beats.map(beat => beat.title)).toEqual(['One', 'Two']);
    });

    // A caller has to tell "the model gave me nothing usable" from "the model gave me an outline",
    // because the first means fall back and the second means carry on.
    it('answers nothing at all when no beat survived', () => {
        expect(coerceOutline({ beats: [] }, 0)).toBeUndefined();
        expect(coerceOutline({ beats: [{ angle: 'no title' }] }, 0)).toBeUndefined();
        expect(coerceOutline({}, 0)).toBeUndefined();
        expect(coerceOutline(null, 0)).toBeUndefined();
        expect(coerceOutline('an outline, honest', 0)).toBeUndefined();
    });

    it('answers an empty runner list rather than omitting it, since it is not optional', () => {
        expect(coerceOutline({ beats: [{ title: 'One' }] }, 0)?.runners).toEqual([]);
    });

    it('drops runners that are not usable text', () => {
        expect(coerceOutline({ runners: ['the price', '', 4, null], beats: [{ title: 'One' }] }, 0)?.runners).toEqual(['the price']);
    });
});
