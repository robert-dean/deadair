// The presenter name is one station setting, and this panel is the only place it is edited now. What
// is pinned here is what the station card could never say: which hosts it actually reaches, since any
// host with a name of its own overrides it. And a save sends that one key and nothing else, as a
// null when emptied, so the row goes back to unset rather than holding an empty string.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Persona, StationSettings } from '@deadair/sdk';

import { PresenterNamePanel, summaryOf } from '../../../src/components/personas/presenter.name.panel';
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

const host = (label: string, djName?: string): Persona => ({
    id: `id-${label}`,
    key: label.toLowerCase(),
    kind: 'host',
    label,
    style: 'somebody',
    active: false,
    ...(djName === undefined ? {} : { djName }),
});

/** The settings answer, which carries every station setting rather than only this panel's one. */
const settingsOf = (values: Record<string, unknown>): StationSettings => ({
    descriptors: [
        { group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' },
        { group: 'personas', key: 'station.djName', label: 'Presenter name', type: 'string', default: '' },
    ],
    values: { 'stream.title': 'Old FM', ...values },
    configured: {},
});

/** What a save was sent, as the map the API takes. */
const sent = (): Record<string, unknown> => (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;

describe('summaryOf', () => {
    it('names the hosts the setting reaches', () => {
        expect(summaryOf('Casey', [host('Classic host')])).toBe('Classic host goes by Casey on air, having no name of its own.');
        expect(summaryOf('Casey', [host('Classic host'), host('Night owl')])).toBe(
            'Classic host, Night owl go by Casey on air, having no name of their own.',
        );
    });

    it('says when every host overrides it', () => {
        expect(summaryOf('Casey', [])).toBe('Every host here has a name of its own, so Casey is heard only while nobody is on air.');
        expect(summaryOf('', [])).toBe('Every host here has a name of its own.');
    });

    it('says what an unnamed host loses when nothing is set', () => {
        expect(summaryOf('', [host('Classic host')])).toMatch(/^Classic host has no name on air, so the phrasings that ask for one are skipped/);
    });
});

describe('PresenterNamePanel', () => {
    it('leaves a host with a name of its own out of the line', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'station.djName': 'Casey' }));

        render(<PresenterNamePanel hosts={[host('Classic host'), host('Late night', 'Ray')]} />);

        expect(await screen.findByText('Classic host goes by Casey on air, having no name of its own.')).toBeInTheDocument();
    });

    it('saves exactly the one key it owns', async () => {
        // The write is partial, so anything else in the submission would be this panel quietly
        // rewriting a setting nobody opened it to change.
        getSettings.mockResolvedValue(settingsOf({ 'station.djName': 'Casey' }));
        updateSettings.mockResolvedValue(settingsOf({ 'station.djName': 'Sam' }));
        render(<PresenterNamePanel hosts={[host('Classic host')]} />);
        await screen.findByText(/goes by Casey/);
        const user = setupUser();
        await user.click(screen.getByRole('button', { name: 'Change' }));

        // Awaited, because the fold is a `Collapse` and its content is hidden until it has opened.
        // Opening on the stored value rather than the empty map of the first render is the key's job.
        const field = await screen.findByLabelText('Presenter name');
        expect(field).toHaveValue('Casey');
        await user.clear(field);
        await user.type(field, '  Sam ');
        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()).toEqual({ 'station.djName': 'Sam' });
    });

    it('clears an emptied name with a null, so the row goes rather than holding an empty string', async () => {
        getSettings.mockResolvedValue(settingsOf({ 'station.djName': 'Casey' }));
        updateSettings.mockResolvedValue(settingsOf({}));
        render(<PresenterNamePanel hosts={[host('Classic host')]} />);
        await screen.findByText(/goes by Casey/);
        const user = setupUser();
        await user.click(screen.getByRole('button', { name: 'Change' }));

        await user.clear(await screen.findByLabelText('Presenter name'));
        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()).toEqual({ 'station.djName': null });
    });
});
