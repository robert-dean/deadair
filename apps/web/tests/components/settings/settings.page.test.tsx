// The settings page is the first surface for keys that were psql-only, so what matters is that it
// is honest about two things: a secret is never displayed, and a save sends only the section the
// operator actually touched. The second is what keeps one card's button from clearing another
// card's settings, and neither is visible from the API side alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';
import type { StationSettings } from '@deadair/sdk';

import { SettingsPage } from '../../../src/components/settings/settings.page';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const updateSettings = vi.fn();
// The page also draws the disk card, which is a read of its own. Stubbed to nothing here rather
// than left undefined, so this file's failures are about settings and not about a card it happens
// to contain — `storage.card.test.tsx` is where that one is pinned.
const readStorage = vi.fn(async () => ({ readAt: '2026-08-16T13:43:48.367Z', totalFiles: 0, totalBytes: 0, stores: [] }));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: (...args: unknown[]) => getSettings(...args),
            updateSettings: (...args: unknown[]) => updateSettings(...args),
        },
        storage: {
            readStorage: () => readStorage(),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
});

const SETTINGS: StationSettings = {
    descriptors: [
        { group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' },
        { group: 'station', key: 'stream.sourcePassword', label: 'Icecast source password', type: 'secret' },
        { group: 'rotation', key: 'rotation.breakEveryMinutes', label: 'Minutes between breaks', type: 'number', default: 15 },
        {
            group: 'playout',
            key: 'playout.airMode',
            label: 'What puts the station on air',
            type: 'select',
            default: 'audience',
            options: [
                { value: 'audience', label: 'Only while somebody is listening' },
                { value: 'always', label: 'Whenever there is a running order' },
            ],
        },
    ],
    values: { 'stream.title': 'Old FM', 'rotation.breakEveryMinutes': 15, 'playout.airMode': 'audience' },
    configured: { 'stream.sourcePassword': true },
};

const settingsOf = (overrides: Partial<StationSettings> = {}): StationSettings => ({ ...SETTINGS, ...overrides });

describe('SettingsPage', () => {
    it('draws a section per group, with the stored values in them', async () => {
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsPage />);

        expect(await screen.findByRole('heading', { name: 'Station' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Rotation' })).toBeInTheDocument();
        expect(screen.getByLabelText('Station name')).toHaveValue('Old FM');
        expect(screen.getByLabelText('Minutes between breaks')).toHaveValue('15');
    });

    it('never puts a stored secret on the screen', async () => {
        // The API reports one as a boolean and no more, and this is the surface where forgetting
        // that would print an Icecast password into somebody's browser.
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsPage />);

        const secret = await screen.findByLabelText('Icecast source password');
        expect(secret).toHaveValue('');
        expect(screen.getByText('Stored — leave blank to keep it.')).toBeInTheDocument();
    });

    it('sends only the section that was saved', async () => {
        // Each card saves on its own, and the API write is partial. If a card submitted the whole
        // page, saving the station's name would also rewrite every rotation rule.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsPage />);
        await screen.findByLabelText('Minutes between breaks');

        await setupUser().click(screen.getByRole('button', { name: 'Save rotation' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        const sent = (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;
        expect(Object.keys(sent)).toEqual(['rotation.breakEveryMinutes']);
    });

    it('leaves an untouched secret out of the submission entirely', async () => {
        // So an operator can rename the station without retyping the Icecast password.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsPage />);
        const user = setupUser();
        await user.clear(await screen.findByLabelText('Station name'));
        await user.type(screen.getByLabelText('Station name'), 'New FM');

        await user.click(screen.getByRole('button', { name: 'Save station' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        const sent = (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;
        expect(sent['stream.title']).toBe('New FM');
        expect('stream.sourcePassword' in sent).toBe(false);
    });

    it('draws no section for a group nothing declares', async () => {
        // An empty card is not an empty group, it is a group whose settings do not exist yet, and a
        // heading over nothing invites the operator to hunt for them.
        getSettings.mockResolvedValue(settingsOf({ descriptors: SETTINGS.descriptors.filter(d => d.group !== 'render') }));

        render(<SettingsPage />);

        await screen.findByRole('heading', { name: 'Station' });
        expect(screen.queryByRole('heading', { name: 'Voice' })).not.toBeInTheDocument();
    });

    it('round-trips a dot-keyed setting, which the form library reads as a nested path', async () => {
        // Every station setting is dot-keyed, and Mantine treats a dot in a FIELD NAME as a path
        // into a nested object. Naming the inputs after the keys made every one of them render
        // empty and submit nothing — quietly, with no error anywhere. This is that regression.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsPage />);
        const user = setupUser();

        const input = await screen.findByLabelText('Station name');
        expect(input).toHaveValue('Old FM');

        await user.clear(input);
        await user.type(input, 'Dot FM');
        await user.click(screen.getByRole('button', { name: 'Save station' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect((updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values['stream.title']).toBe('Dot FM');
    });

    it('routes a rejected value back to the dot-keyed input it names', async () => {
        // The server refuses by key and the form knows its inputs by position, so a 422 has to be
        // translated on the way in or the message lands on nothing.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockRejectedValue(
            new SdkError(
                422,
                'Unprocessable Entity',
                { statusCode: 422, message: 'settings are invalid', details: { 'stream.title': 'That name is taken' } },
                new Headers(),
            ),
        );
        render(<SettingsPage />);
        await screen.findByLabelText('Station name');

        await setupUser().click(screen.getByRole('button', { name: 'Save station' }));

        expect(await screen.findByText('That name is taken')).toBeInTheDocument();
    });

    it('gives a multi-line setting a box worth typing into', async () => {
        // A `text` field is stored and submitted exactly like a `string`; the only difference is the
        // box. That difference is the whole point: a setting somebody WRITES rather than pastes — a
        // list of phrasings, a persona, a prompt — is edited in psql the moment its input is one
        // line tall.
        getSettings.mockResolvedValue(
            settingsOf({
                descriptors: [{ group: 'rotation', key: 'rotation.breakTemplates', label: 'What the station says', type: 'text', default: '' }],
                values: { 'rotation.breakTemplates': 'That was {{previous.title}}.\nYou just heard {{previous.title}}.' },
            }),
        );

        render(<SettingsPage />);

        const box = await screen.findByLabelText('What the station says');
        expect(box.tagName).toBe('TEXTAREA');
        expect(box).toHaveValue('That was {{previous.title}}.\nYou just heard {{previous.title}}.');
    });

    it('sends a multi-line setting back as the plain string it is', async () => {
        const templates = settingsOf({
            descriptors: [{ group: 'rotation', key: 'rotation.breakTemplates', label: 'What the station says', type: 'text', default: '' }],
            values: { 'rotation.breakTemplates': 'That was {{previous.title}}.' },
        });
        getSettings.mockResolvedValue(templates);
        // The settings as they now stand, which is what the route answers with and what the
        // mutation writes straight into the cache. An empty object here is not a lighter fake, it
        // is a body the API cannot send: the page re-renders off whatever this resolves to, so a
        // partial one crashes an unrelated card and shows up as an unhandled error attributed to
        // this test.
        updateSettings.mockResolvedValue(templates);
        render(<SettingsPage />);
        await screen.findByLabelText('What the station says');

        await setupUser().click(screen.getByRole('button', { name: 'Save rotation' }));

        expect(updateSettings).toHaveBeenCalledWith({ values: { 'rotation.breakTemplates': 'That was {{previous.title}}.' } });
    });

    it('says so when the settings cannot be read', async () => {
        getSettings.mockRejectedValue(new Error('nope'));

        render(<SettingsPage />);

        expect(await screen.findByText('Settings unavailable')).toBeInTheDocument();
    });
});
