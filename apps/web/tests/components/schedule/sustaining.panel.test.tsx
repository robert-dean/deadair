// What plays between blocks is seven station settings, and this panel is the only place they are
// edited now. Two things about that are invisible from the API side and are what is pinned here: a
// save sends exactly those seven keys and nothing else on the settings page, and a field the operator
// emptied is sent as `null` rather than `''` — the first is what keeps this card from clearing the
// station's name, and the second is the difference between a setting going back to unset and one
// pinned to an empty string that reads as set.
//
// Seven rather than five because a gap can now be sustained from a chart, which is an ALTERNATIVE to
// the playlist rather than a companion — so the arm nobody chose is cleared on every save, and that
// is pinned too.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogPlaylistPage, StationSettings } from '@deadair/sdk';

import { SustainingPanel } from '../../../src/components/schedule/sustaining.panel';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const updateSettings = vi.fn();
const listImportablePlaylists = vi.fn();
// The source picker offers charts beside playlists now, so it reads both. Empty by default: a
// station with no chart plugin is the ordinary case and the one every case below is written for.
const listCharts = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: () => getSettings(),
            updateSettings: (...args: unknown[]) => updateSettings(...args),
        },
        playlists: {
            listImportablePlaylists: () => listImportablePlaylists(),
        },
        charts: {
            listCharts: () => listCharts(),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    listImportablePlaylists.mockReset();
    listCharts.mockReset();
    listCharts.mockResolvedValue({ charts: [] });
});

const PLAYLISTS: CatalogPlaylistPage = {
    playlists: [
        { id: 'late-night', name: 'Late Night', pluginId: 'spotify', pluginName: 'Spotify', trackCount: 40 },
        { id: 'breakfast', name: 'Breakfast', pluginId: 'spotify', pluginName: 'Spotify', trackCount: 12 },
    ],
    errors: [],
};

/** The settings answer, which carries every station setting rather than only this panel's five. */
const settingsOf = (values: Record<string, unknown>): StationSettings => ({
    descriptors: [
        { group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' },
        { group: 'rotation', key: 'schedule.sustainingPluginId', label: 'Which plugin', type: 'string' },
        { group: 'rotation', key: 'schedule.sustainingPlaylistId', label: 'Which playlist', type: 'string' },
        { group: 'rotation', key: 'schedule.sustainingBrief', label: 'What to play', type: 'text' },
        { group: 'rotation', key: 'schedule.sustainingEraFrom', label: 'Earliest year', type: 'number' },
        { group: 'rotation', key: 'schedule.sustainingEraTo', label: 'Latest year', type: 'number' },
    ],
    values: { 'stream.title': 'Old FM', ...values },
    configured: {},
});

const SET: Record<string, unknown> = {
    'schedule.sustainingPluginId': 'spotify',
    'schedule.sustainingPlaylistId': 'late-night',
    'schedule.sustainingBrief': 'warm and unhurried',
    'schedule.sustainingEraFrom': 1975,
    'schedule.sustainingEraTo': 1985,
};

/** What a save was sent, as the map the API takes. */
const sent = (): Record<string, unknown> => (updateSettings.mock.calls[0]?.[0] as { values: Record<string, unknown> }).values;

describe('SustainingPanel', () => {
    it('says what plays between blocks, naming the playlist rather than its id', async () => {
        getSettings.mockResolvedValue(settingsOf(SET));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);

        render(<SustainingPanel />);

        expect(await screen.findByText(/Late Night — Spotify/)).toBeInTheDocument();
        expect(screen.getByText(/1975–1985/)).toBeInTheDocument();
    });

    it('says nothing is set rather than leaving the line empty', async () => {
        // A station with no sustaining source is working — a gap keeps what was on — so the line
        // says that rather than reading as a panel that failed to load.
        getSettings.mockResolvedValue(settingsOf({}));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);

        render(<SustainingPanel />);

        expect(await screen.findByText(/Nothing is set to play between blocks/)).toBeInTheDocument();
    });

    it('opens on the stored values rather than on the empty answer it first rendered', async () => {
        // The settings arrive after the first render, and Mantine's `useForm` reads its initial
        // values once per mount. Without the key on the form this draws empty boxes over a station
        // that has a sustaining source set.
        getSettings.mockResolvedValue(settingsOf(SET));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        render(<SustainingPanel />);
        await screen.findByText(/Late Night — Spotify/);

        await setupUser().click(screen.getByRole('button', { name: 'Change' }));

        // Awaited rather than read straight off, because the fold is a `Collapse` and its content
        // is display:none until it has opened.
        expect(await screen.findByRole('combobox', { name: 'Playing from' })).toHaveValue('Late Night — Spotify');
        expect(screen.getByLabelText('Asked to play')).toHaveValue('warm and unhurried');
        expect(screen.getByLabelText('From year')).toHaveValue('1975');
    });

    it('saves exactly the seven keys it owns', async () => {
        // The write is partial and this card sits on a page of its own, so anything extra in the
        // submission would be this panel quietly rewriting a setting nobody opened it to change.
        getSettings.mockResolvedValue(settingsOf(SET));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        updateSettings.mockResolvedValue(settingsOf(SET));
        render(<SustainingPanel />);
        await screen.findByText(/Late Night — Spotify/);
        const user = setupUser();
        await user.click(screen.getByRole('button', { name: 'Change' }));

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(Object.keys(sent()).sort()).toEqual([
            'schedule.sustainingBrief',
            'schedule.sustainingChartId',
            'schedule.sustainingChartOrder',
            'schedule.sustainingEraFrom',
            'schedule.sustainingEraTo',
            'schedule.sustainingPlaylistId',
            'schedule.sustainingPluginId',
        ]);
        expect(sent()['schedule.sustainingPluginId']).toBe('spotify');
        expect(sent()['schedule.sustainingPlaylistId']).toBe('late-night');
        // The arm that was not chosen is CLEARED rather than left alone: a stale chart id beside a
        // fresh playlist is a source that would win over it on the way back out.
        expect(sent()['schedule.sustainingChartId']).toBeNull();
        expect(sent()['schedule.sustainingChartOrder']).toBeNull();
    });

    it('clears an emptied field with a null, so the row goes rather than holding an empty string', async () => {
        getSettings.mockResolvedValue(settingsOf(SET));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        updateSettings.mockResolvedValue(settingsOf({}));
        render(<SustainingPanel />);
        await screen.findByText(/Late Night — Spotify/);
        const user = setupUser();
        await user.click(screen.getByRole('button', { name: 'Change' }));
        await screen.findByRole('button', { name: 'Save' });

        await user.clear(screen.getByLabelText('Asked to play'));
        await user.clear(screen.getByLabelText('From year'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()['schedule.sustainingBrief']).toBeNull();
        expect(sent()['schedule.sustainingEraFrom']).toBeNull();
        // Untouched, and still sent: the write is partial, so a key left out would be kept anyway —
        // what matters is that clearing one is expressible at all.
        expect(sent()['schedule.sustainingEraTo']).toBe(1985);
    });

    it('drops both halves of the source together when the picker is cleared', async () => {
        // A plugin with no playlist names nothing a reader could be asked for, so it is not a state
        // this panel can leave the station in.
        getSettings.mockResolvedValue(settingsOf(SET));
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        updateSettings.mockResolvedValue(settingsOf({}));
        render(<SustainingPanel />);
        await screen.findByText(/Late Night — Spotify/);
        const user = setupUser();
        await user.click(screen.getByRole('button', { name: 'Change' }));
        await screen.findByRole('button', { name: 'Save' });

        // By label rather than by role, because Mantine marks its clear button `aria-hidden` —
        // treating the combobox as the control — and a role query skips it however it is asked. It
        // is still the only way an operator clears the picker with a mouse.
        await user.click(screen.getByLabelText('Play from no playlist or chart'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
        });
        expect(sent()['schedule.sustainingPluginId']).toBeNull();
        expect(sent()['schedule.sustainingPlaylistId']).toBeNull();
    });
});
