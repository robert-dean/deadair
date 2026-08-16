// The ordering policy the two one-slot gates share, on its own.
//
// Worth testing apart from either gate because it is where the four tiers are actually decided, and
// because one of the three claims here is a rule the rank table alone does not express: `breaking`
// outranks `air` and must NOT preempt it.

import { describe, expect, it } from 'vitest';

import { insertionIndex, priorityRank, shouldPreempt, type GatePriority } from '../../../src/modules/shared/gate.priority.js';

/** A queue as the gates hold it: whatever else a waiter is, it has a priority. */
const queue = (...priorities: GatePriority[]) => priorities.map(priority => ({ priority }));

/** Insert into a queue the way both gates do, so the assertions read as the resulting order. */
function order(existing: readonly GatePriority[], arriving: GatePriority): GatePriority[] {
    const waiting = queue(...existing);
    waiting.splice(insertionIndex(waiting, arriving), 0, { priority: arriving });
    return waiting.map(waiter => waiter.priority);
}

describe('priorityRank', () => {
    it('ranks the four tiers by how soon the work is needed', () => {
        expect(priorityRank.breaking).toBeGreaterThan(priorityRank.air);
        expect(priorityRank.air).toBeGreaterThan(priorityRank.background);
        expect(priorityRank.background).toBeGreaterThan(priorityRank.preview);
    });
});

describe('insertionIndex', () => {
    it('puts a caller behind everyone at least as important as it', () => {
        expect(order(['air', 'air'], 'air')).toEqual(['air', 'air', 'air']);
    });

    it('puts a whole tier in front of the one below', () => {
        expect(order(['background', 'preview'], 'air')).toEqual(['air', 'background', 'preview']);
    });

    it('keeps arrival order inside a tier while jumping the tiers under it', () => {
        expect(order(['air', 'background', 'preview'], 'air')).toEqual(['air', 'air', 'background', 'preview']);
    });

    it('sends breaking news to the front of a queue of ordinary breaks', () => {
        expect(order(['air', 'air', 'background'], 'breaking')).toEqual(['breaking', 'air', 'air', 'background']);
    });

    it('leaves a preview at the back, which is the only place it ever goes', () => {
        expect(order(['air', 'background'], 'preview')).toEqual(['air', 'background', 'preview']);
    });

    it('answers the queue length for a caller nobody outranks, which is the ordinary push', () => {
        expect(insertionIndex(queue('breaking', 'air'), 'preview')).toBe(2);
        expect(insertionIndex([], 'air')).toBe(0);
    });
});

describe('shouldPreempt', () => {
    it('takes the slot back from work with no deadline', () => {
        expect(shouldPreempt('air', 'background')).toBe(true);
        expect(shouldPreempt('air', 'preview')).toBe(true);
        expect(shouldPreempt('breaking', 'background')).toBe(true);
        expect(shouldPreempt('breaking', 'preview')).toBe(true);
    });

    // The rule the rank table cannot express, and the reason this is a function. Evicting a
    // half-written break destroys that work and frees the slot no sooner, because a holder stops
    // when its own work returns rather than when its signal aborts — so the interrupt would pay for
    // the eviction and still wait exactly as long.
    it('does not evict a break for breaking news, despite outranking it', () => {
        expect(shouldPreempt('breaking', 'air')).toBe(false);
    });

    it('never evicts a peer, so nothing inside a tier can interrupt anything else in it', () => {
        expect(shouldPreempt('air', 'air')).toBe(false);
        expect(shouldPreempt('background', 'background')).toBe(false);
        expect(shouldPreempt('preview', 'preview')).toBe(false);
    });

    it('never evicts upward', () => {
        expect(shouldPreempt('background', 'air')).toBe(false);
        expect(shouldPreempt('preview', 'breaking')).toBe(false);
        expect(shouldPreempt('background', 'breaking')).toBe(false);
    });
});
