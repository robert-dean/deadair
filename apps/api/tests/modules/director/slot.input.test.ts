import { describe, expect, it } from 'vitest';

import { slotInput } from '../../../src/modules/director/slot.input.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot =>
    ({ id: 'slot-1', label: 'Afternoons', startsAtMinutes: 720, endsAtMinutes: 840, days: [], mode: 'rotation', onEnd: 'extend', ...over }) as ScheduleSlot;

describe('slotInput and music beds', () => {
    it("carries a show's dry breaks onto its broadcast", () => {
        expect(slotInput(slot({ beds: false }))).toMatchObject({ beds: false });
    });

    it('says nothing for a show that never answered, which is beds wherever the library has them', () => {
        expect(slotInput(slot())).not.toHaveProperty('beds');
    });
});
