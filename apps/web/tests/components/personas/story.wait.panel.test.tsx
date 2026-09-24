// How long a presenter rests a story is one station setting, and this card is the only place it is
// edited: for a while nothing drew it at all. Pinned: the summary says what is stored rather than
// the empty answer it first rendered, a save sends exactly its own key, and an emptied box goes
// back to the default rather than storing an empty string.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationSettings } from '@deadair/sdk';

import { StoryWaitPanel, summaryOf } from '../../../src/components/personas/story.wait.panel';
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
        { group: 'personas', key: 'station.djName', label: 'Presenter name', type: 'string', default: '' },
        { group: 'personas', key: 'personas.threadGapMinutes', label: 'Wait before returning to a story', type: 'number', default: 40 },
    ],
    values: { 'station.djName': 'Max', ...values },
    configured: {},
    derived: {},
});

const sent = (): Record<string, unknown> => (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;

describe('summaryOf', () => {
    it('says minutes under an hour, and hours on the hour', () => {
        expect(summaryOf(40)).toContain('40 minutes');
        expect(summaryOf(60)).toContain('an hour');
        expect(summaryOf(180)).toContain('3 hours');
        expect(summaryOf(90)).toContain('90 minutes');
    });
});

describe('StoryWaitPanel', () => {
    it('says the default on a station that set nothing', async () => {
        getSettings.mockResolvedValue(settingsOf({}));

        render(<StoryWaitPanel />);

        expect(await screen.findByText(/leaves 40 minutes before returning/)).toBeInTheDocument();
    });

    it('says what is stored, including a value a hand-edited row holds as text', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'personas.threadGapMinutes': '120' }));

        render(<StoryWaitPanel />);

        expect(await screen.findByText(/leaves 2 hours before returning/)).toBeInTheDocument();
    });

    it('saves exactly the one key it owns', async () => {
        getSettings.mockResolvedValue(settingsOf({}));
        updateSettings.mockResolvedValue(settingsOf({ 'personas.threadGapMinutes': 60 }));
        render(<StoryWaitPanel />);
        const user = setupUser();
        await screen.findByText(/leaves 40 minutes/);

        await user.click(screen.getByRole('button', { name: 'Change' }));
        const box = screen.getByLabelText(/Wait before returning to a story/);
        await user.clear(box);
        await user.type(box, '60');
        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(Object.keys(sent())).toEqual(['personas.threadGapMinutes']);
        expect(sent()['personas.threadGapMinutes']).toBe(60);
    });

    it('clears an emptied box with a null, so the default stands rather than an empty string', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'personas.threadGapMinutes': 90 }));
        updateSettings.mockResolvedValue(settingsOf({}));
        render(<StoryWaitPanel />);
        const user = setupUser();
        await screen.findByText(/leaves 90 minutes/);

        await user.click(screen.getByRole('button', { name: 'Change' }));
        await user.clear(screen.getByLabelText(/Wait before returning to a story/));
        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()['personas.threadGapMinutes']).toBeNull();
    });
});
