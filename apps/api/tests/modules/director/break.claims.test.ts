// Whether a break's words are still true. Two callers read this at different moments and the whole
// point of the module is that they cannot disagree, so the cases below are about the ANSWER rather
// than about either caller: a claim that holds, each way one can break, and the instants at the
// edges of a time window, which is where an off-by-one would show up as a break dropped a second
// early or aired a second late.

import { describe, expect, it } from 'vitest';

import { brokenClaim } from '../../../src/modules/director/break.claims.js';

const NOW = Date.UTC(2026, 7, 15, 9, 30);
const window = { from: NOW - 60_000, until: NOW + 60_000 };

describe('brokenClaim', () => {
    it('holds for a break that claimed nothing', () => {
        expect(brokenClaim({}, 'item-2', NOW)).toBeUndefined();
        // And still holds when there is no next record at all: a break that promised nothing is not
        // made wrong by an order running out behind it.
        expect(brokenClaim({}, undefined, NOW)).toBeUndefined();
    });

    it('holds while the record it named is still what plays next', () => {
        expect(brokenClaim({ claimsItemId: 'item-2' }, 'item-2', NOW)).toBeUndefined();
    });

    it('breaks when something else plays next', () => {
        expect(brokenClaim({ claimsItemId: 'item-2' }, 'item-7', NOW)).toEqual({ kind: 'item', claimed: 'item-2', next: 'item-7' });
    });

    it('breaks with no next when the order has lost its tail', () => {
        // `next` absent rather than a placeholder, so the caller phrases "nothing" once.
        expect(brokenClaim({ claimsItemId: 'item-2' }, undefined, NOW)).toEqual({ kind: 'item', claimed: 'item-2' });
    });

    it('holds inside the window a break named a time in', () => {
        expect(brokenClaim({ claimsTime: window }, undefined, NOW)).toBeUndefined();
        // The first instant is inside it.
        expect(brokenClaim({ claimsTime: window }, undefined, window.from)).toBeUndefined();
        // The last instant before the end is too.
        expect(brokenClaim({ claimsTime: window }, undefined, window.until - 1)).toBeUndefined();
    });

    it('breaks once the time it named has passed', () => {
        // Half-open at the end: `until` itself is already too late.
        expect(brokenClaim({ claimsTime: window }, undefined, window.until)).toEqual({ kind: 'time', ...window });
        expect(brokenClaim({ claimsTime: window }, undefined, window.until + 1)).toEqual({ kind: 'time', ...window });
    });

    it('breaks for a break written for a moment that has not arrived', () => {
        expect(brokenClaim({ claimsTime: window }, undefined, window.from - 1)).toEqual({ kind: 'time', ...window });
    });

    it('reports the record before the clock when both are wrong', () => {
        // Order matters only for which sentence an operator is shown, and the record is the one they
        // can do something about.
        expect(brokenClaim({ claimsItemId: 'item-2', claimsTime: window }, 'item-7', window.until + 1)).toEqual({
            kind: 'item',
            claimed: 'item-2',
            next: 'item-7',
        });
    });
});
