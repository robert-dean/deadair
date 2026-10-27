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
const listStationPlaylists = vi.fn(async () => ({ playlists: [] as unknown[] }));
const readSlotPlaylistPosition = vi.fn(async (_id: string): Promise<{ title?: string; artist?: string }> => ({}));
const restartSlotPlaylist = vi.fn(async (_id: string) => undefined);

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: { listImportablePlaylists: () => listImportablePlaylists(), listStationPlaylists: () => listStationPlaylists() },
        personas: { listPersonas: () => listPersonas() },
        charts: { listCharts: () => listCharts() },
        schedule: {
            readSlotPlaylistPosition: (id: string) => readSlotPlaylistPosition(id),
            restartSlotPlaylist: (id: string) => restartSlotPlaylist(id),
        },
    },
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
    listPersonas.mockReset();
    listCharts.mockReset();
    readSlotPlaylistPosition.mockReset();
    readSlotPlaylistPosition.mockResolvedValue({});
    restartSlotPlaylist.mockClear();
});

const PLAYLISTS: CatalogPlaylistPage = { playlists: [], errors: [] };
const PERSONAS: PersonaList = { personas: [] };
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

    it('says the slot is on air only when it is the one the running order belongs to', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        const { rerender } = render(
            <SlotEditor target={{ kind: 'edit', slot: slot() }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />,
        );

        await screen.findByRole('combobox', { name: 'Mode' });
        expect(screen.queryByText(/This slot is on air/)).toBeNull();

        rerender(
            <SlotEditor
                target={{ kind: 'edit', slot: slot() }}
                onClose={noop}
                onSubmit={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
                airing
            />,
        );

        expect(await screen.findByText(/^This slot is on air\. Save keeps your changes for the next time it comes round/)).toBeInTheDocument();
    });

    it('offers Save and apply now on the slot on air, handing it the same draft Save would send', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const onApply = vi.fn();
        const user = setupUser();

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ brief: 'Heavy metal' }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onApply={onApply}
                onDelete={noop}
                saving={false}
                deleting={false}
                airing
            />,
        );

        await user.click(await screen.findByRole('button', { name: 'Save and apply now' }));

        await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ label: 'Late Night', brief: 'Heavy metal' })));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps plain Save to saving, so nothing on air changes unless somebody asks', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const onApply = vi.fn();
        const user = setupUser();

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot() }}
                onClose={noop}
                onSubmit={onSubmit}
                onApply={onApply}
                onDelete={noop}
                saving={false}
                deleting={false}
                airing
            />,
        );

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(onApply).not.toHaveBeenCalled();
    });

    it('offers no apply on a slot that is not on air, or when the page cannot carry it out', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        const { rerender } = render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot() }}
                onClose={noop}
                onSubmit={noop}
                onApply={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        await screen.findByRole('combobox', { name: 'Mode' });
        expect(screen.queryByRole('button', { name: 'Save and apply now' })).toBeNull();

        rerender(
            <SlotEditor
                target={{ kind: 'edit', slot: slot() }}
                onClose={noop}
                onSubmit={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
                airing
            />,
        );
        expect(screen.queryByRole('button', { name: 'Save and apply now' })).toBeNull();
    });

    it('says the save landed when only the apply failed, rather than that nothing was saved', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot() }}
                onClose={noop}
                onSubmit={noop}
                onApply={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
                applyError={new Error('boom')}
                airing
            />,
        );

        expect(await screen.findByText('Saved, but the show on air was not changed')).toBeInTheDocument();
        expect(screen.queryByText('That slot could not be saved')).toBeNull();
    });

    it('does not say a new slot is on air', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} airing />);

        await screen.findByRole('combobox', { name: 'Mode' });
        expect(screen.queryByText(/This slot is on air/)).toBeNull();
    });

    it('says starting again replays what already aired, and nothing about a dislike', async () => {
        // The lift-does-not-reach-a-dislike copy from [repeat-overrules](https://github.com/robert-dean/deadair/discussions/30) phase 3: a
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
        // Unticked, so nothing: a setlist's own answer is silence.
        expect(draft).not.toHaveProperty('breaks');
    });

    it('offers a host only under a setlist, and asks for one when it is ticked', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('combobox', { name: 'Mode' });

        // A rotation already talks and a feature never does, so there is nothing to ask.
        expect(screen.queryByRole('checkbox', { name: /Host talks between records/ })).toBeNull();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'US Countdown');
        await user.click(screen.getByRole('combobox', { name: 'Mode' }));
        await user.click(await screen.findByRole('option', { name: 'Setlist' }));
        await user.click(screen.getByRole('checkbox', { name: /Host talks between records/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'setlist', breaks: true }));
    });

    it('opens a setlist slot that talks ticked, and keeps a rotation told to stay silent silent', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();

        const { unmount } = render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ mode: 'setlist', breaks: true }) }}
                onClose={noop}
                onSubmit={noop}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        expect(await screen.findByRole('checkbox', { name: /Host talks between records/ })).toBeChecked();
        unmount();

        // No box can say `false`, so a value set through the API has to survive a save untouched.
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ mode: 'rotation', breaks: false }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        await screen.findByRole('combobox', { name: 'Mode' });
        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'rotation', breaks: false }));
    });

    describe('a special', () => {
        const halloween = slot({
            label: 'Halloween',
            startsAtMinutes: 20 * 60,
            endsAtMinutes: 23 * 60,
            startsOn: '2026-10-31',
            endsOn: '2026-10-31',
            yearly: true,
        });

        it('is titled as one and offers the yearly switch, which a weekly slot does not', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);

            const { rerender } = render(
                <SlotEditor
                    target={{ kind: 'edit', slot: halloween }}
                    onClose={noop}
                    onSubmit={noop}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            expect(await screen.findByText('Edit special')).toBeInTheDocument();
            expect(screen.getByRole('switch', { name: /Repeats every year/ })).toBeChecked();

            rerender(
                <SlotEditor target={{ kind: 'edit', slot: slot() }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />,
            );
            expect(screen.queryByRole('switch', { name: /Repeats every year/ })).toBeNull();
        });

        it('sends its dates back with everything else, so a save keeps it a special', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);
            const onSubmit = vi.fn();
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: halloween }}
                    onClose={noop}
                    onSubmit={onSubmit}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );
            await screen.findByRole('combobox', { name: 'Mode' });

            await user.click(screen.getByRole('button', { name: 'Save' }));

            expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ startsOn: '2026-10-31', endsOn: '2026-10-31', yearly: true });
        });

        it('refuses a new special with no dates rather than saving a weekly slot', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);
            const onSubmit = vi.fn();
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'new', special: true }}
                    onClose={noop}
                    onSubmit={onSubmit}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );
            await screen.findByRole('combobox', { name: 'Mode' });

            await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Halloween');
            await user.click(screen.getByRole('button', { name: 'Save' }));

            expect(onSubmit).not.toHaveBeenCalled();
            expect(await screen.findByText('A special needs its first and last date')).toBeInTheDocument();
        });
    });

    describe('a live show', () => {
        const pirate = slot({
            label: 'Pirate Hour',
            startsAtMinutes: 20 * 60,
            endsAtMinutes: 22 * 60,
            startsOn: '2026-11-06',
            endsOn: '2026-11-06',
            live: true,
        });

        it('is offered only on a special', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);

            const { rerender } = render(
                <SlotEditor target={{ kind: 'new', special: true }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />,
            );
            expect(await screen.findByRole('switch', { name: /A live show/ })).not.toBeChecked();

            rerender(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />);
            expect(screen.queryByRole('switch', { name: /A live show/ })).toBeNull();
        });

        it('draws none of the programme, and sends only when it is on and that it is live', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);
            const onSubmit = vi.fn();
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: pirate }}
                    onClose={noop}
                    onSubmit={onSubmit}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            expect(await screen.findByRole('switch', { name: /A live show/ })).toBeChecked();
            expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull();

            await user.click(screen.getByRole('button', { name: 'Save' }));

            const sent = onSubmit.mock.calls[0]?.[0];
            expect(sent).toMatchObject({ label: 'Pirate Hour', startsOn: '2026-11-06', endsOn: '2026-11-06', live: true });
            expect(sent).not.toHaveProperty('brief');
            expect(sent).not.toHaveProperty('sourcePlaylistId');
        });

        it('turns back into an ordinary special, with its programme, when switched off', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);
            const onSubmit = vi.fn();
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: pirate }}
                    onClose={noop}
                    onSubmit={onSubmit}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            await user.click(await screen.findByRole('switch', { name: /A live show/ }));
            expect(await screen.findByRole('combobox', { name: 'Mode' })).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Save' }));
            expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('live');
        });

        it('offers no Save and apply, since the station never changes over onto it', async () => {
            listImportablePlaylists.mockResolvedValue(PLAYLISTS);
            listPersonas.mockResolvedValue(PERSONAS);

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: pirate }}
                    onClose={noop}
                    onSubmit={noop}
                    onApply={noop}
                    airing
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            await screen.findByRole('switch', { name: /A live show/ });
            expect(screen.queryByRole('button', { name: 'Save and apply now' })).toBeNull();
        });
    });

    it('sends call-ins only when they are asked for, so an untouched box changes nothing', async () => {
        // Absent is no calls, with nothing station-wide behind it, so an untouched box need say nothing.
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

    it('sends a request show only when it is asked for, with how many records follow each request', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('checkbox', { name: /Request show/ });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Request hour');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('requestShow');
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('requestFollowOn');

        await user.click(screen.getByRole('checkbox', { name: /Request show/ }));
        const count = screen.getByRole('textbox', { name: /Records after each request/ });
        await user.clear(count);
        await user.type(count, '6');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ requestShow: true, requestFollowOn: 6 });
    });

    it('sends only the repeat rules somebody typed, a zero as the lift it is', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('textbox', { name: /Artist rest \(minutes\)/ });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Metallica hour');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        // Untouched boxes keep the station's own rules, which is sending nothing at all.
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('repeatWindowDays');
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('artistCooldownMinutes');
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('maxPerArtist');

        await user.type(screen.getByRole('textbox', { name: /Artist rest \(minutes\)/ }), '0');
        await user.type(screen.getByRole('textbox', { name: /Most per artist/ }), '20');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ artistCooldownMinutes: 0, maxPerArtist: 20 });
        expect(onSubmit.mock.calls[1]?.[0]).not.toHaveProperty('repeatWindowDays');
    });

    it('opens a slot on the repeat rules it lifts, and keeps them under a mode that draws no boxes', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();
        const lifted = slot({ artistCooldownMinutes: 0, repeatWindowDays: 0 });

        render(
            <SlotEditor target={{ kind: 'edit', slot: lifted }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />,
        );

        expect(await screen.findByRole('textbox', { name: /Artist rest \(minutes\)/ })).toHaveValue('0');

        await user.click(screen.getByRole('combobox', { name: 'Mode' }));
        await user.click(await screen.findByRole('option', { name: 'Setlist' }));
        expect(screen.queryByRole('textbox', { name: /Artist rest \(minutes\)/ })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ mode: 'setlist', artistCooldownMinutes: 0, repeatWindowDays: 0 });
    });

    it('sends a writer order only when the slot chose one, and keeps it under a feature', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('combobox', { name: /Who writes the breaks first/ });

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Own words');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        // Following the station is sending nothing at all.
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('writerOrder');

        await user.click(screen.getByRole('combobox', { name: /Who writes the breaks first/ }));
        await user.click(await screen.findByRole('option', { name: 'The phrasings, with the model underneath' }));
        await user.click(screen.getByRole('combobox', { name: 'Mode' }));
        await user.click(await screen.findByRole('option', { name: 'Feature' }));
        expect(screen.queryByRole('combobox', { name: /Who writes the breaks first/ })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ mode: 'feature', writerOrder: 'station' });
    });

    it('opens a slot on the writer order it chose', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);

        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ writerOrder: 'station' }) }}
                onClose={noop}
                onSubmit={vi.fn()}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );

        expect(await screen.findByRole('combobox', { name: /Who writes the breaks first/ })).toHaveValue('The phrasings, with the model underneath');
    });

    it('offers a request show only under a rotation', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={vi.fn()} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('checkbox', { name: /Request show/ });

        await user.click(screen.getByRole('combobox', { name: 'Mode' }));
        await user.click(await screen.findByRole('option', { name: 'Setlist' }));

        expect(screen.queryByRole('checkbox', { name: /Request show/ })).toBeNull();
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

    it('offers mixing similar records in only beside a playlist, and sends it only when ticked', async () => {
        // The same three-way as call-ins: an untouched box leaves `rotation.mixInSimilar` standing.
        const offered = { pluginId: 'deadair.spotify', id: 'pl_1', name: 'Evergreen Rock', pluginName: 'Spotify' };
        listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        const user = setupUser();

        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
        await screen.findByRole('combobox', { name: 'Playing from' });
        // A slot the station fills itself has nothing to mix into, so there is nothing to offer.
        expect(screen.queryByRole('checkbox', { name: /Mix in similar records/ })).toBeNull();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Breakfast');
        await user.click(screen.getByRole('combobox', { name: 'Playing from' }));
        await user.click(await screen.findByRole('option', { name: `${offered.name} — ${offered.pluginName}` }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('mixInSimilar');

        await user.click(screen.getByRole('checkbox', { name: /Mix in similar records/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[1]?.[0].mixInSimilar).toBe(true);
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
                saving={false}
                deleting={false}
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

        render(<SlotEditor target={{ kind: 'edit', slot: slot() }} onClose={noop} onSubmit={noop} onDelete={noop} saving={false} deleting={false} />);

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
                saving={false}
                deleting={false}
            />,
        );
        await screen.findByRole('combobox', { name: 'Playing from' });

        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sourceChartId: 'deadair.lastfm:top-100', sourceChartOrder: 'countdown' }));
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourcePluginId');
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourcePlaylistId');
        // Ticked, so nothing: absent is yes.
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('chartPositions');
    });

    it('opens a chart slot that keeps its positions quiet unticked, and sends that back', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        listCharts.mockResolvedValue(CHARTS);
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ sourceChartId: 'deadair.lastfm:top-100', chartPositions: false }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );

        expect(await screen.findByRole('checkbox', { name: "Say each record's chart position" })).not.toBeChecked();
        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chartPositions: false }));
    });

    it("opens a slot that plays one of the station's own playlists on it, and sends it back alone", async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        listCharts.mockResolvedValue({ charts: [] });
        listStationPlaylists.mockResolvedValue({
            playlists: [{ id: 'owned-1', name: 'Rock hours', prompt: '', trackCount: 3000, resolvedCount: 3000 }],
        });
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ sourceStationPlaylistId: 'owned-1' }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        expect(await screen.findByDisplayValue('Rock hours')).toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sourceStationPlaylistId: 'owned-1' }));
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourcePluginId');
        expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('sourceChartId');
    });

    it('sends the mood a slot leans toward, and nothing for a slot with no lean', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ moods: ['comfort'] }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        expect(await screen.findByDisplayValue('Comfort')).toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[0]![0].moods).toEqual(['comfort']);

        const untouched = vi.fn();
        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={untouched} onDelete={noop} saving={false} deleting={false} />);
        await setupUser().type((await screen.findAllByRole('textbox', { name: 'Name' })).at(-1)!, 'Breakfast');
        await setupUser().click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
        expect(untouched.mock.calls[0]?.[0]).not.toHaveProperty('moods');
    });

    it('sends the moods a slot steers away from, and nothing for a slot that avoids none', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ moods: ['happiness'], avoidMoods: ['sadness', 'anger'] }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        expect(await screen.findByText('Steers away from')).toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit.mock.calls[0]![0].avoidMoods).toEqual(['sadness', 'anger']);
        expect(onSubmit.mock.calls[0]![0].moods).toEqual(['happiness']);

        const untouched = vi.fn();
        render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={untouched} onDelete={noop} saving={false} deleting={false} />);
        await setupUser().type((await screen.findAllByRole('textbox', { name: 'Name' })).at(-1)!, 'Breakfast');
        await setupUser().click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
        expect(untouched.mock.calls[0]?.[0]).not.toHaveProperty('avoidMoods');
    });

    it('sends a second mood stage after the first, and closes the gap when one is cleared', async () => {
        listImportablePlaylists.mockResolvedValue(PLAYLISTS);
        listPersonas.mockResolvedValue(PERSONAS);
        const onSubmit = vi.fn();
        render(
            <SlotEditor
                target={{ kind: 'edit', slot: slot({ moods: ['comfort', 'loneliness', 'sadness'] }) }}
                onClose={noop}
                onSubmit={onSubmit}
                onDelete={noop}
                saving={false}
                deleting={false}
            />,
        );
        // The input, not the listbox Mantine labels the same way.
        const stage = async (number: number) =>
            (await screen.findAllByLabelText(`Mood stage ${number}`)).find(element => element.tagName === 'INPUT');
        // Three stages and a blank one for a fourth.
        expect(await stage(4)).toHaveValue('');
        expect(await stage(2)).toHaveValue('Loneliness');

        // Clearing the middle stage moves the last one up rather than leaving a hole.
        // Mantine's clear control is a button kept out of the accessibility tree, so it is found by its label.
        await setupUser().click(screen.getByLabelText('Remove mood stage 2'));
        await setupUser().click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]![0].moods).toEqual(['comfort', 'sadness']);
    });

    describe('a slot that resumes its playlist', () => {
        const playlistSlot = (over: Partial<ScheduleSlot> = {}) =>
            slot({ sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'pl_1', resumePlaylist: true, ...over });
        const offered = { pluginId: 'deadair.spotify', id: 'pl_1', name: 'Evergreen Rock', pluginName: 'Spotify' };
        const resumeSwitch = () => screen.queryByRole('switch', { name: /Pick the playlist up where it left off/ });

        it('offers resuming only beside a playlist, and sends it only when it is switched on', async () => {
            listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
            listPersonas.mockResolvedValue(PERSONAS);
            const onSubmit = vi.fn();
            const user = setupUser();

            render(<SlotEditor target={{ kind: 'new' }} onClose={noop} onSubmit={onSubmit} onDelete={noop} saving={false} deleting={false} />);
            await screen.findByRole('combobox', { name: 'Playing from' });
            // A slot the station fills itself has no playlist to pick up.
            expect(resumeSwitch()).toBeNull();

            await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Late night');
            await user.click(screen.getByRole('combobox', { name: 'Playing from' }));
            await user.click(await screen.findByRole('option', { name: `${offered.name} — ${offered.pluginName}` }));
            await user.click(screen.getByRole('button', { name: 'Save' }));
            expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('resumePlaylist');

            await user.click(resumeSwitch()!);
            // A slot not saved yet has aired nothing, so there is no place to show and nothing is asked.
            expect(screen.getByText('Save the slot to see where it will pick up.')).toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'Save' }));
            expect(onSubmit.mock.calls[1]?.[0].resumePlaylist).toBe(true);
            expect(readSlotPlaylistPosition).not.toHaveBeenCalled();
        });

        it('shows the record it will open on next, and starts it from the top when asked', async () => {
            listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
            listPersonas.mockResolvedValue(PERSONAS);
            readSlotPlaylistPosition.mockResolvedValueOnce({ title: 'Roads', artist: 'Portishead' });
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: playlistSlot() }}
                    onClose={noop}
                    onSubmit={noop}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            expect(resumeSwitch()).toBeChecked();
            expect(await screen.findByText('Next time it opens on Roads by Portishead.')).toBeInTheDocument();
            expect(readSlotPlaylistPosition).toHaveBeenCalledWith('slot-1');

            await user.click(screen.getByRole('button', { name: 'Start from the top' }));

            expect(restartSlotPlaylist).toHaveBeenCalledWith('slot-1');
            expect(await screen.findByText('Next time it starts from the top.')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Start from the top' })).toBeNull();
        });

        it('says when it would start from the top anyway, and offers nothing to press', async () => {
            listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
            listPersonas.mockResolvedValue(PERSONAS);

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: playlistSlot() }}
                    onClose={noop}
                    onSubmit={noop}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            expect(await screen.findByText('Next time it starts from the top.')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Start from the top' })).toBeNull();
        });

        it('asks nothing of a slot whose resuming is not saved yet', async () => {
            listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
            listPersonas.mockResolvedValue(PERSONAS);
            const user = setupUser();

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: playlistSlot({ resumePlaylist: false }) }}
                    onClose={noop}
                    onSubmit={noop}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );
            await screen.findByRole('combobox', { name: 'Playing from' });
            expect(resumeSwitch()).not.toBeChecked();

            await user.click(resumeSwitch()!);

            expect(screen.getByText('Save the slot to see where it will pick up.')).toBeInTheDocument();
            expect(readSlotPlaylistPosition).not.toHaveBeenCalled();
        });

        it('says so when where it got to cannot be read', async () => {
            listImportablePlaylists.mockResolvedValue({ playlists: [offered], errors: [] });
            listPersonas.mockResolvedValue(PERSONAS);
            readSlotPlaylistPosition.mockRejectedValue(new Error('the provider did not answer'));

            render(
                <SlotEditor
                    target={{ kind: 'edit', slot: playlistSlot() }}
                    onClose={noop}
                    onSubmit={noop}
                    onDelete={noop}
                    saving={false}
                    deleting={false}
                />,
            );

            expect(await screen.findByText('Where it got to could not be read.', {}, { timeout: 5000 })).toBeInTheDocument();
        });
    });
});
