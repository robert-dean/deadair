// The list is the year's specials in the order an operator asks about them, and its one job beyond
// that is opening the editor on the right one. Today is handed in, as the page hands in the station's.

import { describe, expect, it, vi } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { SpecialsPanel } from '../../../src/components/schedule/specials.panel';
import { render, screen, setupUser, within } from '../../utils/render';

const slot = (id: string, over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes: 20 * 60,
    endsAtMinutes: 23 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

const SLOTS = [
    slot('The Boneyard', { startsAtMinutes: 990, endsAtMinutes: 0 }),
    slot('Halloween', { startsOn: '2020-10-31', endsOn: '2020-10-31', yearly: true }),
    slot('Last Christmas', { startsOn: '2025-12-24', endsOn: '2025-12-25' }),
];

describe('SpecialsPanel', () => {
    it('lists the specials and leaves the weekly slots out', () => {
        render(<SpecialsPanel slots={SLOTS} today="2026-10-09" onEdit={vi.fn()} onNew={vi.fn()} />);

        const rows = screen.getAllByRole('row');
        expect(rows).toHaveLength(2);
        expect(within(rows[0]!).getByText('Halloween')).toBeInTheDocument();
        expect(within(rows[0]!).getByText('Every year')).toBeInTheDocument();
        expect(within(rows[0]!).getByText('Coming up')).toBeInTheDocument();
        expect(within(rows[1]!).getByText('Over')).toBeInTheDocument();
        expect(screen.queryByText('The Boneyard')).toBeNull();
    });

    it('lists a special on a rule by when it next falls, and says what the rule is', () => {
        const thanksgiving = slot('Thanksgiving', {
            recurrence: { ruleKind: 'weekday', month: 11, ordinal: 4, weekday: 4 },
            nextDate: '2026-11-26',
        });

        render(<SpecialsPanel slots={[thanksgiving, ...SLOTS]} today="2026-10-09" onEdit={vi.fn()} onNew={vi.fn()} />);

        const row = screen.getByRole('row', { name: 'Edit Thanksgiving' });
        expect(within(row).getByText('Nov 26, 2026')).toBeInTheDocument();
        expect(within(row).getByText('The fourth Thursday of November')).toBeInTheDocument();
        expect(within(row).getByText('Coming up')).toBeInTheDocument();
    });

    it('shows a list of dates that has run out as over, on its last date', () => {
        const listed = slot('Eclipse', { recurrence: { ruleKind: 'dates', dates: ['2024-04-08', '2025-03-29'] } });

        render(<SpecialsPanel slots={[listed]} today="2026-10-09" onEdit={vi.fn()} onNew={vi.fn()} />);

        const row = screen.getByRole('row', { name: 'Edit Eclipse' });
        expect(within(row).getByText('Mar 29, 2025')).toBeInTheDocument();
        expect(within(row).getByText('Over')).toBeInTheDocument();
    });

    it('marks a booked live show as live', () => {
        render(
            <SpecialsPanel
                slots={[slot('Pirate Hour', { startsOn: '2026-11-06', endsOn: '2026-11-06', live: true }), SLOTS[1]!]}
                today="2026-10-09"
                onEdit={vi.fn()}
                onNew={vi.fn()}
            />,
        );

        expect(within(screen.getByRole('row', { name: 'Edit Pirate Hour' })).getByText('Live')).toBeInTheDocument();
        expect(within(screen.getByRole('row', { name: 'Edit Halloween' })).queryByText('Live')).toBeNull();
    });

    it('says so when there are none', () => {
        render(<SpecialsPanel slots={[SLOTS[0]!]} today="2026-10-09" onEdit={vi.fn()} onNew={vi.fn()} />);

        expect(screen.getByText('No specials. The station plays its weekly schedule every day.')).toBeInTheDocument();
    });

    it('opens the editor on the special clicked, and a new one from the button', async () => {
        const onEdit = vi.fn();
        const onNew = vi.fn();
        const user = setupUser();

        render(<SpecialsPanel slots={SLOTS} today="2026-10-09" onEdit={onEdit} onNew={onNew} />);

        await user.click(screen.getByRole('row', { name: 'Edit Halloween' }));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'Halloween' }));

        await user.click(screen.getByRole('button', { name: 'New special' }));
        expect(onNew).toHaveBeenCalledTimes(1);
    });
});
