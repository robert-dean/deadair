// What going on air as a slot asks for, for the festival a slot names: it rides the order's rules so every
// refill and every break of the show reads it, and a slot naming none asks for none.

import { describe, expect, it } from 'vitest';

import { rulesAskedFor } from '../../../src/modules/director/director.console.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { slotInput } from '../../../src/modules/director/slot.input.js';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id: 'weekend',
    label: 'Festival weekend',
    startsAtMinutes: 12 * 60,
    endsAtMinutes: 18 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

describe('slotInput, for a festival', () => {
    it('carries the festival onto the broadcast and from there onto its rules', () => {
        const input = slotInput(slot({ festivalId: 'f1' }));

        expect(input.festivalId).toBe('f1');
        expect(rulesAskedFor(input).rules).toEqual({ festivalId: 'f1' });
    });

    it('keeps the festival for a block started without its source', () => {
        expect(slotInput(slot({ festivalId: 'f1' }), { withoutSource: true }).festivalId).toBe('f1');
    });

    it('asks for no festival when the slot names none', () => {
        const input = slotInput(slot());

        expect(input).not.toHaveProperty('festivalId');
        expect(rulesAskedFor(input)).toEqual({});
    });
});
