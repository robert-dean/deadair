// The settings page is the first surface for keys that were psql-only, so what matters is that it
// is honest about two things: a secret is never displayed, and a save sends only the section the
// operator actually touched. The second is what keeps one card's button from clearing another
// card's settings, and neither is visible from the API side alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';
import type { StationSettings } from '@deadair/sdk';

import { SettingsSectionPage } from '../../../src/components/settings/settings.page';
import { SETTINGS_SECTIONS } from '../../../src/components/settings/settings.shell';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const updateSettings = vi.fn();
// The page also draws the disk card, which is a read of its own. Stubbed to nothing here rather
// than left undefined, so this file's failures are about settings and not about a card it happens
// to contain — `storage.card.test.tsx` is where that one is pinned.
const readStorage = vi.fn(async () => ({ readAt: '2026-08-16T13:43:48.367Z', totalFiles: 0, totalBytes: 0, stores: [] }));

// Only the blocker is stubbed; the rest of the router stays real, because the page imports `Link`
// through the section list without rendering it. `useBlocker` is the one hook that reaches for a
// router instance, and there is none under this render.
const useBlocker = vi.fn((_options: unknown) => ({ status: 'idle' as const }));

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useBlocker: (options: unknown) => useBlocker(options),
}));

/** What the guard was last told, which is the page's answer to "is anything unsaved here". */
const guarding = (): boolean => {
    const options = useBlocker.mock.calls.at(-1)?.[0] as { disabled?: boolean } | undefined;
    return options?.disabled === false;
};

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
    useBlocker.mockClear();
});

const SETTINGS: StationSettings = {
    descriptors: [
        { group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' },
        { group: 'stream', key: 'stream.bitrate', label: 'Bitrate (kbps)', type: 'string', default: '128' },
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
    values: { 'stream.title': 'Old FM', 'stream.bitrate': '192', 'rotation.breakEveryMinutes': 15, 'playout.airMode': 'audience' },
    configured: { 'stream.sourcePassword': true },
};

const settingsOf = (overrides: Partial<StationSettings> = {}): StationSettings => ({ ...SETTINGS, ...overrides });

describe('SettingsSectionPage', () => {
    it('draws the section it was asked for, with the stored values in it', async () => {
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsSectionPage section="station" />);

        expect(await screen.findByRole('heading', { name: 'Station' })).toBeInTheDocument();
        expect(screen.getByLabelText('Station name')).toHaveValue('Old FM');
    });

    it('draws only that section, where it used to draw every one of them', async () => {
        // The whole of the split, asserted once: one `GET /settings` still answers for all of them,
        // so a page that filtered nothing would look identical until an operator scrolled.
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsSectionPage section="station" />);

        await screen.findByLabelText('Station name');
        expect(screen.queryByLabelText('Minutes between breaks')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Rotation' })).not.toBeInTheDocument();
    });

    // Station used to be every one of these under one save: identity, streams, housekeeping and
    // four passwords together. The bitrate is `stream` now and the station's own name stays where it
    // was — this is the split's one behavioural claim, pinned directly rather than trusted to follow
    // from the section-filter case above, which never had two groups sharing a descriptor list to
    // tell apart.
    it('keeps the bitrate on Stream and the station’s own name on Station', async () => {
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsSectionPage section="stream" />);

        expect(await screen.findByLabelText('Bitrate (kbps)')).toHaveValue('192');
        expect(screen.queryByLabelText('Station name')).not.toBeInTheDocument();
    });

    it('never puts a stored secret on the screen', async () => {
        // The API reports one as a boolean and no more, and this is the surface where forgetting
        // that would print an Icecast password into somebody's browser.
        getSettings.mockResolvedValue(settingsOf());

        render(<SettingsSectionPage section="station" />);

        const secret = await screen.findByLabelText('Icecast source password');
        expect(secret).toHaveValue('');
        expect(screen.getByText('Stored — leave blank to keep it.')).toBeInTheDocument();
    });

    it('sends only the section that was saved', async () => {
        // Each card saves on its own, and the API write is partial. If a card submitted the whole
        // page, saving the station's name would also rewrite every rotation rule.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsSectionPage section="rotation" />);
        await screen.findByLabelText('Minutes between breaks');

        await setupUser().click(screen.getByRole('button', { name: 'Save rotation' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        const sent = (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;
        expect(Object.keys(sent)).toEqual(['rotation.breakEveryMinutes']);
    });

    // The guard is the page's, not a section's: every section is its own form with its own save, so
    // one being clean says nothing about the others and a single flag would answer for all of them.
    it('does not guard a page where nothing has been typed', async () => {
        getSettings.mockResolvedValue(settingsOf());
        render(<SettingsSectionPage section="station" />);
        await screen.findByLabelText('Station name');

        expect(guarding()).toBe(false);
    });

    it('guards the page as soon as one section holds an unsaved edit, and stops once it is saved', async () => {
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsSectionPage section="station" />);
        const user = setupUser();
        await user.type(await screen.findByLabelText('Station name'), '!');

        await waitFor(() => {
            expect(guarding()).toBe(true);
        });

        await user.click(screen.getByRole('button', { name: 'Save station' }));

        // `resetDirty` after a successful save is what puts it back, so an operator who saved and
        // then navigated would otherwise be asked about an edit that is already stored.
        await waitFor(() => {
            expect(guarding()).toBe(false);
        });
    });

    it('leaves an untouched secret out of the submission entirely', async () => {
        // So an operator can rename the station without retyping the Icecast password.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsSectionPage section="station" />);
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

    it('says a section is empty rather than drawing a heading over nothing', async () => {
        // An empty card is not an empty group, it is a group whose settings do not exist yet, and a
        // heading over nothing invites the operator to hunt for them. It was drawn as no card at
        // all when the sections shared a page; a section that IS the page has to say something, and
        // the section list leaves it out so this is only reachable by typing the URL.
        getSettings.mockResolvedValue(settingsOf({ descriptors: SETTINGS.descriptors.filter(d => d.group !== 'render') }));

        render(<SettingsSectionPage section="render" />);

        expect(await screen.findByText('No voice and audio settings yet')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    });

    it('claims no section for a group another page owns', () => {
        // `schedule` is the sustaining source, edited beside the timetable by `SustainingPanel`.
        // Claiming it here as well would be two forms writing one key, and only one of them next to
        // the thing that explains it. Asserted against the list rather than a render, because the
        // list is now what decides: there is no route that could draw it.
        expect(SETTINGS_SECTIONS.some(section => section.group === 'schedule')).toBe(false);
        // `personas` is the presenter name, edited above the roster by `PresenterNamePanel`, where
        // the hosts whose own names override it are in view.
        expect(SETTINGS_SECTIONS.some(section => section.group === 'personas')).toBe(false);
    });

    it('round-trips a dot-keyed setting, which the form library reads as a nested path', async () => {
        // Every station setting is dot-keyed, and Mantine treats a dot in a FIELD NAME as a path
        // into a nested object. Naming the inputs after the keys made every one of them render
        // empty and submit nothing — quietly, with no error anywhere. This is that regression.
        getSettings.mockResolvedValue(settingsOf());
        updateSettings.mockResolvedValue(settingsOf());
        render(<SettingsSectionPage section="station" />);
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
        render(<SettingsSectionPage section="station" />);
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

        render(<SettingsSectionPage section="rotation" />);

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
        render(<SettingsSectionPage section="rotation" />);
        await screen.findByLabelText('What the station says');

        await setupUser().click(screen.getByRole('button', { name: 'Save rotation' }));

        expect(updateSettings).toHaveBeenCalledWith({ values: { 'rotation.breakTemplates': 'That was {{previous.title}}.' } });
    });

    it('says so when the settings cannot be read', async () => {
        getSettings.mockRejectedValue(new Error('nope'));

        render(<SettingsSectionPage section="station" />);

        expect(await screen.findByText('Settings unavailable')).toBeInTheDocument();
    });
});
