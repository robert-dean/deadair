import { describe, expect, it, vi } from 'vitest';
import type { ScheduleOccurrence, ScheduleSlot } from '@deadair/sdk';

import { DayStrip, dayStretchesOf } from '../../../src/components/schedule/day.strip';
import { render, screen, setupUser } from '../../utils/render';

const readTimetable = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { schedule: { readTimetable: (query: unknown) => readTimetable(query) } },
}));

const block = (slotId: string, start: string, end: string, label = slotId): ScheduleOccurrence => ({ slotId, label, start, end });

describe('dayStretchesOf', () => {
    it('lays the day out end to end, with the hours nothing claims as gaps', () => {
        const stretches = dayStretchesOf(
            [block('late', '2026-11-18 22:00:00', '2026-11-19 00:00:00'), block('breakfast', '2026-11-18 06:00:00', '2026-11-18 10:00:00')],
            '2026-11-18',
        );

        expect(stretches).toEqual([
            { kind: 'gap', from: 0, to: 360 },
            { kind: 'block', slotId: 'breakfast', label: 'breakfast', live: false, from: 360, to: 600 },
            { kind: 'gap', from: 600, to: 1320 },
            // Ending at midnight is ending on the next day's date, which is the day's last minute here.
            { kind: 'block', slotId: 'late', label: 'late', live: false, from: 1320, to: 1440 },
        ]);
    });

    it('is one gap on a day with nothing scheduled, and leaves out a block that belongs to another day', () => {
        expect(dayStretchesOf([block('tomorrow', '2026-11-19 06:00:00', '2026-11-19 10:00:00')], '2026-11-18')).toEqual([
            { kind: 'gap', from: 0, to: 1440 },
        ]);
    });
});

describe('DayStrip', () => {
    it('opens a show when its block is pressed', async () => {
        readTimetable.mockResolvedValue({
            from: '2026-11-18',
            days: 1,
            occurrences: [block('slot-1', '2026-11-18 06:00:00', '2026-11-18 10:00:00', 'Breakfast')],
        });
        const breakfast = { id: 'slot-1', label: 'Breakfast' } as ScheduleSlot;
        const onEdit = vi.fn();
        const user = setupUser();

        render(<DayStrip now="2026-11-18 07:30:00" slots={[breakfast]} airingSlotId="slot-1" onEdit={onEdit} />);

        await user.click(await screen.findByRole('button', { name: /^Open Breakfast/ }));
        expect(onEdit).toHaveBeenCalledWith(breakfast);
        expect(readTimetable).toHaveBeenCalledWith({ days: 1 });
    });
});
