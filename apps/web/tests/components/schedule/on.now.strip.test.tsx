// The strip's gap card used to say "Sustaining", which is also the name of a destination tab on
// this page. An eyebrow reading the same as a tab read as a link to it, when it is actually
// describing the gap the station is filling right now — so this pins the wording that replaced it.

import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Persona, ScheduleNow, ScheduleSlot } from '@deadair/sdk';

import { OnNowStrip } from '../../../src/components/schedule/on.now.strip';
import { render, screen } from '../../utils/render';

const SLOTS: readonly ScheduleSlot[] = [];
const PERSONAS: readonly Persona[] = [];

describe('OnNowStrip', () => {
    it('names the gap "Between blocks" rather than "Sustaining", which is also a tab on this page', () => {
        // The first block starts in the future, so nothing covers `now` and the strip falls into
        // the gap arm rather than the live one.
        const current: ScheduleNow = {
            now: '2026-01-05 12:00:00',
            upcoming: [{ slotId: 'evening', label: 'Evening Drive', start: '2026-01-05 18:00:00', end: '2026-01-05 22:00:00' }],
        };

        render(<OnNowStrip current={current} slots={SLOTS} personas={PERSONAS} />);

        expect(screen.getByText('Between blocks')).toBeInTheDocument();
        expect(screen.queryByText('Sustaining')).not.toBeInTheDocument();
    });

    it('opens the slot behind a block from its card, so a block can be edited without finding it on the grid', async () => {
        // Asked for because a late show ending at midnight was on this strip and nowhere on the
        // Timetable, which left the operator no way into its editor.
        const late: ScheduleSlot = {
            id: 'late',
            label: 'LateNite',
            startsAtMinutes: 22 * 60,
            endsAtMinutes: 0,
            days: [],
            mode: 'rotation',
            onEnd: 'extend',
        };
        const current: ScheduleNow = {
            now: '2026-01-05 12:00:00',
            upcoming: [{ slotId: 'late', label: 'LateNite', start: '2026-01-05 22:00:00', end: '2026-01-06 00:00:00' }],
        };
        const onEdit = vi.fn();

        render(<OnNowStrip current={current} slots={[late]} personas={PERSONAS} onEdit={onEdit} />);
        await userEvent.click(screen.getByRole('button', { name: 'Edit LateNite' }));

        expect(onEdit).toHaveBeenCalledWith(late);
    });

    it('offers no edit for a block whose slot the page has not got', () => {
        const current: ScheduleNow = {
            now: '2026-01-05 12:00:00',
            upcoming: [{ slotId: 'gone', label: 'Gone', start: '2026-01-05 18:00:00', end: '2026-01-05 22:00:00' }],
        };

        render(<OnNowStrip current={current} slots={SLOTS} personas={PERSONAS} onEdit={vi.fn()} />);

        expect(screen.queryByRole('button', { name: 'Edit Gone' })).not.toBeInTheDocument();
    });
});
