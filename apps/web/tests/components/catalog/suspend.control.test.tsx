// A suspension sits beside an opinion rather than inside it, and says how long is LEFT, because a
// week is what was asked for and a timestamp is not what anybody typed.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { SuspendControl } from '../../../src/components/catalog/suspend.control';
import { render, screen, setupUser } from '../../utils/render';

describe('SuspendControl', () => {
    it('offers a day, a week or a month, and sends the days chosen', async () => {
        const onSuspend = vi.fn();
        const user = setupUser();
        render(<SuspendControl onSuspend={onSuspend} onLift={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Suspend' }));
        await user.click(await screen.findByRole('menuitem', { name: 'For a week' }));

        expect(onSuspend).toHaveBeenCalledWith(7);
    });

    it('says how many days are left, and lifts it', async () => {
        const onLift = vi.fn();
        const user = setupUser();
        render(<SuspendControl suspendedUntil={DateTime.now().plus({ days: 4, hours: 2 })} onSuspend={vi.fn()} onLift={onLift} />);

        expect(screen.getByText('Off the station for 5 more days')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Lift' }));
        expect(onLift).toHaveBeenCalled();
    });

    it('says the time it lapses once less than a day is left', () => {
        render(<SuspendControl suspendedUntil={DateTime.now().plus({ hours: 3 })} onSuspend={vi.fn()} onLift={vi.fn()} />);

        expect(screen.getByText(/^Off the station until /)).toBeInTheDocument();
    });
});
