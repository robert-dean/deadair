// The editor already offered `mode` and `onEnd`; what it had no test for was whether either one
// actually round-trips, and the survey that sent this work reported the pair as unreachable from
// the console on the strength of a grep that found nothing. That grep was wrong — this file carries
// NUL bytes as a value delimiter, so git and grep both read it as binary and skip it — which is
// exactly why the behaviour is pinned here rather than left to the next reader's search.
//
// What is pinned: a new slot opens on the ordinary defaults, an existing slot opens on its OWN mode
// and onEnd rather than those defaults, a change to either reaches `onSubmit`, and the copy beside
// the pair does not overstate what "start again" does — it replays what the block already aired,
// and it says nothing about a dislike.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogPlaylistPage, PersonaList, ScheduleSlot } from '@deadair/sdk';

import { SlotEditor } from '../../../src/components/schedule/slot.editor';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listImportablePlaylists = vi.fn();
const listPersonas = vi.fn();
const listCharts = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: { listImportablePlaylists: () => listImportablePlaylists() },
        personas: { listPersonas: () => listPersonas() },
        charts: { listCharts: () => listCharts() },
    },
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
    listPersonas.mockReset();
    listCharts.mockReset();
});

const PLAYLISTS: CatalogPlaylistPage = { playlists: [], errors: [] };
const PERSONAS: PersonaList = { personas: [], onAirPersonaId: undefined };
const CHARTS = { charts: [{ id: 'deadair.lastfm:top-100', pluginId: 'deadair.lastfm', name: 'Global Top 100' }] };

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id: 'slot-1',
    label: 'Late Night',
    startsAtMinutes: 22 * 60,
    endsAtMinutes: 2 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

const noop = () => {};

describe('SlotEditor', () => {
    it('opens a new slot on rotation, keep-going — the ordinary case', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />);

        expect(await screen.findByRole('combobox', { name: 'Mode' })).toHaveValue('Rotation');
        expect(screen.getByRole('combobox', { name: 'When it runs out' })).toHaveValue('Keep going');
    });

    it('opens an existing slot on its own mode and onEnd, not the defaults', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ mode: 'setlist', onEnd: 'repeat' }) }}
                onClose={noop}
                onSubmit={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );

        expect(await screen.findByRole('combobox', { name: 'Mode' })).toHaveValue('Setlist');
        expect(screen.getByRole('combobox', { name: 'When it runs out' })).toHaveValue('Start again');
    });

    it('says starting again replays what already aired, and nothing about a dislike', async () => {
        // The lift-does-not-reach-a-dislike copy from docs/todo/repeat-overrules.md phase 3: a
        // record kept off the air for that reason stays off it whether the block is on its first
        // pass or its fifth, and the editor must not claim otherwise.
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />);

        expect(await screen.findByText(/Starting again replays what this block already aired/)).toBeInTheDocument();
        expect(screen.getByText(/stays off\s*(the\s*)?air whether the block is running for the first time or the fifth/)).toBeInTheDocument();
    });

    it('sends the chosen mode and onEnd on submit', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('combobox', { name: 'Mode' });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Overnight');

        await user.click(screen.getByRole('combobox', { name: 'Mode' }));
        await user.click(await screen.findByRole('option', { name: 'Setlist' }));

        await user.click(screen.getByRole('combobox', { name: 'When it runs out' }));
        await user.click(await screen.findByRole('option', { name: 'Start again' }));

        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]?.[0];
        expect(draft.mode).toBe('setlist');
        expect(draft.onEnd).toBe('repeat');
    });

    it('sends call-ins only when they are asked for, so an untouched box changes nothing', async () => {
        // The three-way the column is nullable for: absent leaves `rotation.callins` standing, where
        // a `false` on every slot would be the schedule overruling a station that takes calls.
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('checkbox', { name: /Take calls/ });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Breakfast');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('callins');

        await user.click(screen.getByRole('checkbox', { name: /Take calls/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[1]?.[0].callins).toBe(true);
    });

    it('sends both halves of a chosen playlist, which is what the pair encoding is for', async () => {
        // The source travels as one string because a picker holds one, so an encode that does not
        // match its decode loses the playlist silently and the slot reads as one the station fills
        // itself. That is a failure with no error and no visible symptom until a changeover.
        const offered = { pluginId: 'deadair.spotify', id: '37i9dQ EvergreenRock', name: 'Evergreen Rock', pluginName: 'Spotify' };
        listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('combobox', { name: 'Playing from' });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Breakfast');
        await user.click(screen.getByRole('combobox', { name: 'Playing from' }));
        await user.click(await screen.findByRole('option', { name: `${offered.name} — ${offered.pluginName}` }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        const draft = onSubmit.mock.calls[0]?.[0];
        expect(draft.sourcePluginId).toBe(offered.pluginId);
        // A space in the id is the case a naive `split(' ')` loses the tail of. Nothing promises a
        // provider's ids have none, and losing it names a different playlist rather than erroring.
        expect(draft.sourcePlaylistId).toBe(offered.id);
    });

    it('opens a slot that plays a chart on its chart, and on the way round it plays it', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        listCharts.mockResolvedValue(CHARTS);

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ sourceChartId: 'deadair.lastfm:top-100', sourceChartOrder: 'ranked' }) }}
                onClose={noop}
                onSubmit={noop}
                onDelete={noop}
            />,
        );

        // Waited for rather than read straight off: a Mantine `Select` shows a name only once the
        // option carrying it is in `data`, and the chart menu is a second request behind the form.
        await waitFor(() => {
            expect(screen.getByRole('combobox', { name: 'Playing from' })).toHaveValue('Global Top 100 — deadair.lastfm');
        });
        expect(screen.getByRole('combobox', { name: 'Played' })).toHaveValue('Number one first');
    });

    it('offers the way-round picker only under a chart', async () => {
        // It means nothing under a playlist, and a row sitting there greyed out for every other kind
        // of source is a control explaining its own irrelevance on the page an operator uses most.
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        listCharts.mockResolvedValue(CHARTS);

        render(<SlotEditor target={{ kind: 'edit', slot: slot() }} onClose={noop} onSubmit={noop} onDelete={noop} />);

        await screen.findByRole('combobox', { name: 'Playing from' });
        expect(screen.queryByRole('combobox', { name: 'Played' })).toBeNull();
    });

    it('sends a chart slot its chart and no playlist, since the two are alternatives', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        listCharts.mockResolvedValue(CHARTS);
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ sourceChartId: 'deadair.lastfm:top-100' }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
            />,
        );
        await screen.findByRole('combobox', { name: 'Playing from' });

        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ sourceChartId: 'deadair.lastfm:top-100', sourceChartOrder: 'countdown' }),
        );
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourcePluginId');
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourcePlaylistId');
    });
});
