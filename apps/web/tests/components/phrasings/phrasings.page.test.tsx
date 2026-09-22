// The Phrasings tab draws one declared group that no settings section draws. What matters is that it
// draws that group and nothing else, and that its save sends only what it drew: the write is partial,
// so a tab that sent a neighbouring group's values back would be overwriting them with a stale read.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationSettings } from '@deadair/sdk';

import { PhrasingsPage } from '../../../src/components/phrasings/phrasings.page';
import { render, screen, setupUser } from '../../utils/render';

const getSettings = vi.fn();
const updateSettings = vi.fn();

// Only the blocker is stubbed, as on the settings page: it is the one hook that reaches for a router
// instance, and there is none under this render.
vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useBlocker: () => ({ status: 'idle' as const }),
}));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: (...args: unknown[]) => getSettings(...args),
            updateSettings: (...args: unknown[]) => updateSettings(...args),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
});

const SETTINGS: StationSettings = {
    descriptors: [
        { group: 'rotation', key: 'rotation.repeatWindowDays', label: 'Do not repeat a song for (days)', type: 'number', default: 3 },
        { group: 'breaks', key: 'rotation.welcome', label: 'Say hello to a new listener', type: 'boolean', default: true },
        {
            group: 'phrasings',
            key: 'rotation.welcomeTemplates',
            label: 'What the station says to a new listener',
            type: 'text',
            default: '',
            dependsOn: 'rotation.welcome',
        },
        { group: 'phrasings', key: 'rotation.jingleTemplates', label: 'What the station says in a jingle', type: 'text', default: '' },
    ],
    values: {
        'rotation.repeatWindowDays': 3,
        'rotation.welcome': 'true',
        'rotation.welcomeTemplates': 'Hello, and welcome to {{station.name}}.',
        'rotation.jingleTemplates': 'This is {{station.name}}.',
    },
    configured: {},
    derived: {},
};

describe('PhrasingsPage', () => {
    it("draws the phrasings group and none of its neighbours'", async () => {
        getSettings.mockResolvedValue(SETTINGS);

        render(<PhrasingsPage />);

        expect(await screen.findByLabelText('What the station says in a jingle')).toHaveValue('This is {{station.name}}.');
        expect(screen.queryByLabelText('Do not repeat a song for (days)')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Say hello to a new listener')).not.toBeInTheDocument();
    });

    it('shows a box whose toggle is on another page rather than hiding it', async () => {
        // The welcome box depends on the welcome toggle, which is under Settings. Hiding it here
        // would leave an operator no hint that the box exists, let alone where its switch is.
        getSettings.mockResolvedValue(SETTINGS);

        render(<PhrasingsPage />);

        expect(await screen.findByLabelText('What the station says to a new listener')).toBeInTheDocument();
    });

    it('saves only what it drew', async () => {
        getSettings.mockResolvedValue(SETTINGS);
        updateSettings.mockResolvedValue(SETTINGS);
        render(<PhrasingsPage />);

        const box = await screen.findByLabelText('What the station says in a jingle');
        const user = setupUser();
        await user.clear(box);
        await user.type(box, 'You are listening to {{{{station.name}}.');
        await user.click(screen.getByRole('button', { name: 'Save phrasings' }));

        expect(updateSettings).toHaveBeenCalledTimes(1);
        const sent = (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;
        expect(Object.keys(sent).sort()).toEqual(['rotation.jingleTemplates', 'rotation.welcomeTemplates']);
        expect(sent['rotation.jingleTemplates']).toBe('You are listening to {{station.name}}.');
    });
});
