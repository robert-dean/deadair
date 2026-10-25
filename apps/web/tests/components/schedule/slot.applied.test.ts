// What the console says after a slot is applied to the show on air. Done and queued are different
// news: a replan has not happened yet when the answer arrives, and the old records keep playing until
// it has. And what only the next occurrence can change is named, or an operator waits for it now.

import { describe, expect, it } from 'vitest';

import { describeApplied } from '../../../src/components/schedule/slot.applied';

describe('describeApplied', () => {
    it('reports a replan as queued, saying the planned records keep playing', () => {
        expect(describeApplied({ applied: ['brief'], waiting: [], replanning: true })).toEqual({
            message:
                'Applied to the show on air. The records still to come are being chosen again, and what is planned keeps playing until they are ready.',
            queued: true,
        });
    });

    it('reports a change that needs no replan as done', () => {
        expect(describeApplied({ applied: ['name', 'host'], waiting: [], replanning: false })).toEqual({
            message: 'Applied to the show on air.',
            queued: false,
        });
    });

    it('says so when the show already matched the slot', () => {
        expect(describeApplied({ applied: [], waiting: [], replanning: false }).message).toBe('Saved. The show on air already matched this slot.');
    });

    it('names what waits for the next occurrence, joined as a list', () => {
        expect(describeApplied({ applied: ['brief'], waiting: ['source', 'mode', 'onEnd'], replanning: false }).message).toBe(
            'Applied to the show on air. The next time it comes round, it takes on its new source, mode, and ending as well.',
        );
    });

    it('names a single waiting part on its own', () => {
        expect(describeApplied({ applied: [], waiting: ['coHosts'], replanning: false }).message).toBe(
            'Saved. The show on air already matched this slot. The next time it comes round, it takes on its new co-hosts as well.',
        );
    });
});
