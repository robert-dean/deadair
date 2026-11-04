// Where a slot that is off can be found. What is pinned: it draws nothing for a station with none, and a row
// opens the editor on that slot, since that is the only way back on.

import { describe, expect, it, vi } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { SwitchedOffPanel } from '../../../src/components/schedule/switched.off.panel';
import { render, screen, setupUser } from '../../utils/render';

const slot: ScheduleSlot = {
    id: 'a',
    label: 'The Boneyard',
    startsAtMinutes: 1200,
    endsAtMinutes: 1380,
    days: [],
    enabled: false,
    mode: 'rotation',
    onEnd: 'extend',
};

describe('SwitchedOffPanel', () => {
    it('draws nothing when no slot is off', () => {
        render(<SwitchedOffPanel slots={[]} onEdit={vi.fn()} />);
        expect(screen.queryByText('Switched off')).toBeNull();
    });

    it('opens the editor on the slot chosen', async () => {
        const onEdit = vi.fn();
        const user = setupUser();
        render(<SwitchedOffPanel slots={[slot]} onEdit={onEdit} />);
        await user.click(screen.getByText('The Boneyard'));
        expect(onEdit).toHaveBeenCalledWith(slot);
    });
});
