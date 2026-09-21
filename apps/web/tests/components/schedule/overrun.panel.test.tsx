// Whether a block starts on time is two station settings, and this card is the only place they are
// edited. Pinned: it opens on what is stored rather than on the empty answer it first rendered, the
// minutes box is inert while the switch is off, and a save sends exactly its own two keys, so a card
// under the timetable can never rewrite a setting nobody opened it to change.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationSettings } from '@deadair/sdk';

import { OverrunPanel } from '../../../src/components/schedule/overrun.panel';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: () => getSettings(),
            updateSettings: (...args: unknown[]) => updateSettings(...args),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
});

const settingsOf = (values: Record<string, unknown>): StationSettings => ({
    descriptors: [
        { group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' },
        { group: 'schedule', key: 'schedule.capOverrun', label: 'Start shows on time', type: 'boolean', default: false },
        { group: 'schedule', key: 'schedule.overrunMinutes', label: 'Minutes', type: 'number', default: 5 },
    ],
    values: { 'stream.title': 'Old FM', ...values },
    configured: {},
    derived: {},
});

const sent = (): Record<string, unknown> => (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;

describe('OverrunPanel', () => {
    it('opens off, with the default filled in and the box inert, on a station that set nothing', async () => {
        getSettings.mockResolvedValue(settingsOf({}));

        render(<OverrunPanel />);

        expect(await screen.findByRole('switch', { name: /Start shows on time/ })).not.toBeChecked();
        expect(screen.getByLabelText(/Minutes a record may run/)).toHaveValue('5');
        expect(screen.getByLabelText(/Minutes a record may run/)).toBeDisabled();
    });

    it('opens on what is stored', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'schedule.capOverrun': true, 'schedule.overrunMinutes': 3 }));

        render(<OverrunPanel />);

        expect(await screen.findByRole('switch', { name: /Start shows on time/ })).toBeChecked();
        expect(screen.getByLabelText(/Minutes a record may run/)).toHaveValue('3');
        expect(screen.getByLabelText(/Minutes a record may run/)).toBeEnabled();
    });

    it('saves exactly the two keys it owns', async () => {
        getSettings.mockResolvedValue(settingsOf({}));
        updateSettings.mockResolvedValue(settingsOf({ 'schedule.capOverrun': true }));
        render(<OverrunPanel />);
        const user = setupUser();

        await user.click(await screen.findByRole('switch', { name: /Start shows on time/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(Object.keys(sent()).sort()).toEqual(['schedule.capOverrun', 'schedule.overrunMinutes']);
        expect(sent()['schedule.capOverrun']).toBe(true);
        expect(sent()['schedule.overrunMinutes']).toBe(5);
    });

    it('clears an emptied box with a null, so the default stands rather than an empty string', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'schedule.capOverrun': true, 'schedule.overrunMinutes': 3 }));
        updateSettings.mockResolvedValue(settingsOf({ 'schedule.capOverrun': true }));
        render(<OverrunPanel />);
        const user = setupUser();
        await screen.findByRole('switch', { name: /Start shows on time/ });

        await user.clear(screen.getByLabelText(/Minutes a record may run/));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()['schedule.overrunMinutes']).toBeNull();
    });
});
