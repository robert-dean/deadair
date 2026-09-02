// Whether a break's words are still true. Two callers read this at different moments and the whole
// point of the module is that they cannot disagree, so the cases below are about the ANSWER rather
// than about either caller: a claim that holds, each way one can break, and the instants at the
// edges of a time window, which is where an off-by-one would show up as a break dropped a second
// early or aired a second late. The reading claim gets the same edge treatment and one case of its
// own — that it has no `early` — because that absence is what makes it safe to rewrite.

import { describe, expect, it } from 'vitest';

import { brokenClaim } from '../../../src/modules/director/break.claims.js';

const NOW = Date.UTC(2026, 7, 15, 9, 30);
const window = { from: NOW - 60_000, until: NOW + 60_000 };

describe('brokenClaim', () => {
    it('holds for a break that claimed nothing', () => {
        expect(brokenClaim({}, { next: 'item-2' }, NOW)).toBeUndefined();
        // And still holds when there is no next record at all: a break that promised nothing is not
        // made wrong by an order running out behind it.
        expect(brokenClaim({}, {}, NOW)).toBeUndefined();
    });

    it('holds while the record it named is still what plays next', () => {
        expect(brokenClaim({ claimsItemId: 'item-2' }, { next: 'item-2' }, NOW)).toBeUndefined();
    });

    it('breaks when something else plays next', () => {
        expect(brokenClaim({ claimsItemId: 'item-2' }, { next: 'item-7' }, NOW)).toEqual({ kind: 'item', claimed: 'item-2', next: 'item-7' });
    });

    it('breaks with no next when the order has lost its tail', () => {
        // `next` absent rather than a placeholder, so the caller phrases "nothing" once.
        expect(brokenClaim({ claimsItemId: 'item-2' }, {}, NOW)).toEqual({ kind: 'item', claimed: 'item-2' });
    });

    it('holds while the record it back-announced is still what played', () => {
        expect(brokenClaim({ claimsPreviousItemId: 'item-2' }, { previous: 'item-2' }, NOW)).toBeUndefined();
    });

    it('breaks when something else played there', () => {
        expect(brokenClaim({ claimsPreviousItemId: 'item-2' }, { previous: 'item-7' }, NOW)).toEqual({
            kind: 'previous',
            claimed: 'item-2',
            previous: 'item-7',
        });
    });

    it('breaks with no previous when the record it back-announced never survived to air', () => {
        // `previous` absent rather than a placeholder, for the same reason the forward claim's is.
        expect(brokenClaim({ claimsPreviousItemId: 'item-2' }, {}, NOW)).toEqual({ kind: 'previous', claimed: 'item-2' });
    });

    it('holds inside the window a break named a time in', () => {
        expect(brokenClaim({ claimsTime: window }, {}, NOW)).toBeUndefined();
        // The first instant is inside it.
        expect(brokenClaim({ claimsTime: window }, {}, window.from)).toBeUndefined();
        // The last instant before the end is too.
        expect(brokenClaim({ claimsTime: window }, {}, window.until - 1)).toBeUndefined();
    });

    it('breaks once the time it named has passed', () => {
        // Half-open at the end: `until` itself is already too late.
        expect(brokenClaim({ claimsTime: window }, {}, window.until)).toEqual({ kind: 'time', ...window, when: 'late' });
        expect(brokenClaim({ claimsTime: window }, {}, window.until + 1)).toEqual({ kind: 'time', ...window, when: 'late' });
    });

    it('breaks for a break written for a moment that has not arrived', () => {
        // `early` rather than a bare time fault, and the distinction is the whole of why the field
        // exists: the hand-over drops both, and the rewrite must act on `late` alone.
        expect(brokenClaim({ claimsTime: window }, {}, window.from - 1)).toEqual({ kind: 'time', ...window, when: 'early' });
    });

    it('reports the forward claim before the backward one when both are wrong', () => {
        // Order matters only for which sentence an operator is shown, and the forward claim is
        // checked first — see `break.claims.ts`.
        expect(brokenClaim({ claimsItemId: 'item-2', claimsPreviousItemId: 'item-1' }, { previous: 'item-9', next: 'item-7' }, NOW)).toEqual({
            kind: 'item',
            claimed: 'item-2',
            next: 'item-7',
        });
    });

    it('reports the backward claim before the clock when both are wrong', () => {
        expect(brokenClaim({ claimsPreviousItemId: 'item-1', claimsTime: window }, { previous: 'item-9' }, window.until + 1)).toEqual({
            kind: 'previous',
            claimed: 'item-1',
            previous: 'item-9',
        });
    });

    it('reports the record before the clock when both are wrong', () => {
        // Order matters only for which sentence an operator is shown, and the record is the one they
        // can do something about.
        expect(brokenClaim({ claimsItemId: 'item-2', claimsTime: window }, { next: 'item-7' }, window.until + 1)).toEqual({
            kind: 'item',
            claimed: 'item-2',
            next: 'item-7',
        });
    });

    it('holds while what a break reported is still current', () => {
        expect(brokenClaim({ claimsReadingUntil: NOW + 60_000 }, {}, NOW)).toBeUndefined();
        // Half-open at the end, exactly as the time window is: the last instant before it is inside.
        expect(brokenClaim({ claimsReadingUntil: NOW }, {}, NOW - 1)).toBeUndefined();
    });

    it('breaks once the reading behind it has aged out', () => {
        expect(brokenClaim({ claimsReadingUntil: NOW }, {}, NOW)).toEqual({ kind: 'reading', until: NOW });
        expect(brokenClaim({ claimsReadingUntil: NOW }, {}, NOW + 1)).toEqual({ kind: 'reading', until: NOW });
    });

    it('reports no direction for a reading, because there is only one', () => {
        // An observation has no not-true-yet. A reading stamped for the future is simply still
        // current, which is what every freshly written weather break looks like — and the absence of
        // an `early` here is what lets the rewrite act on this claim where it must not act on a time
        // claim that has not arrived.
        expect(brokenClaim({ claimsReadingUntil: NOW + 3_600_000 }, {}, NOW)).toBeUndefined();
    });

    it('reports the record and the clock before the reading when more than one is wrong', () => {
        const stale = { claimsItemId: 'item-2', claimsTime: window, claimsReadingUntil: NOW - 60_000 };

        expect(brokenClaim(stale, { next: 'item-7' }, window.until + 1)).toEqual({ kind: 'item', claimed: 'item-2', next: 'item-7' });
        expect(brokenClaim({ ...stale, claimsItemId: undefined }, {}, window.until + 1)).toEqual({
            kind: 'time',
            ...window,
            when: 'late',
        });
    });
});
