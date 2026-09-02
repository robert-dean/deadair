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
import { render, screen, setupUser } from '../../utils/render';

const listImportablePlaylists = vi.fn();
const listPersonas = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: { listImportablePlaylists: () => listImportablePlaylists() },
        personas: { listPersonas: () => listPersonas() },
    },
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
    listPersonas.mockReset();
});

const PLAYLISTS: CatalogPlaylistPage = { playlists: [], errors: [] };
const PERSONAS: PersonaList = { personas: [], onAirPersonaId: undefined };

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
});
