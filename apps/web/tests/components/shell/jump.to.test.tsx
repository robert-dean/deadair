import { spotlight } from '@mantine/spotlight';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JumpTo } from '../../../src/components/shell/jump.to';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const navigate = vi.fn();

// Only the navigation is reached: the palette is a list of places and a way to go to one.
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}));

const listTracks = vi.fn();
const listArtists = vi.fn();
const listPersonas = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        catalog: {
            listTracks: (...args: unknown[]) => listTracks(...args),
            listArtists: (...args: unknown[]) => listArtists(...args),
        },
        personas: {
            listPersonas: (...args: unknown[]) => listPersonas(...args),
        },
    },
}));

/** The palette is a portal opened by an imperative store, so every case opens it the same way. */
function open() {
    render(<JumpTo />);
    act(() => {
        spotlight.open();
    });
}

describe('JumpTo', () => {
    beforeEach(() => {
        navigate.mockClear();
        // Answering empty is the ordinary case for every case that never types enough to search —
        // only the cases that DO search override these, and they do it before `open()` so the first
        // render already has something to resolve.
        listTracks.mockResolvedValue({ data: [], meta: { total: 0 }, states: {} });
        listArtists.mockResolvedValue({ data: [], meta: { total: 0 } });
        listPersonas.mockResolvedValue({ personas: [] });
        act(() => {
            spotlight.close();
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    /**
     * Nineteen nav links became four destinations, which is the right shape for arriving and the
     * wrong one for going somewhere specific. Every tab that is no longer a nav link has to be
     * reachable by name, or folding it into a destination hid it.
     */
    it('holds every tab that stopped being a nav link', () => {
        open();

        for (const label of [
            // Voice, which absorbed eight links.
            'Characters',
            'Pronunciations',
            'Soundboard',
            'What it said',
            // Library, which absorbed four.
            'Playlists',
            'Charts',
            'News',
            // Programme and Check-up.
            'Sustaining',
            'What it has been doing',
            // Settings, whose sections are cards on one page rather than pages.
            'Measurement',
            'Plugins',
        ]) {
            expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
        }
    });

    it('narrows to the one thing typed', async () => {
        open();
        await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'pronun');

        expect(screen.getByRole('button', { name: /Pronunciations/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Charts/ })).not.toBeInTheDocument();
    });

    it('says so rather than sitting empty when nothing matches, on a name too short to search on', async () => {
        // Six characters, past the two-character floor, so this also proves the empty catalog/persona
        // answers above do not leave the box silently broken — it has actually asked and come back
        // with nothing, not merely declined to ask.
        open();
        await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'lineup');

        await waitFor(() => {
            expect(screen.getByText('No page, record or character by that name.')).toBeInTheDocument();
        });
    });

    it('lands a tab on the tab, not on its destination', async () => {
        open();
        await setupUser().click(screen.getByRole('button', { name: /Pronunciations/ }));

        // Unnarrowed as well as on the tab: the palette asks for the whole of a destination, and a
        // `segment` left over from a link off the running order would follow the operator into it.
        expect(navigate).toHaveBeenCalledWith({ to: '/voice', search: { tab: 'pronunciations', segment: '', persona: '' } });
    });

    /**
     * A tab strip replaces, so stepping between three tabs is not three back-button presses. A jump
     * comes from somewhere else entirely, and replacing THAT entry is how Back stops taking an
     * operator back to the page they left.
     */
    it('leaves the page it was opened from in the history', async () => {
        open();
        await setupUser().click(screen.getByRole('button', { name: /Sustaining/ }));

        expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'sustaining' } });
    });

    it('reaches a settings section by its own route, because they are pages now', async () => {
        open();
        await setupUser().click(screen.getByRole('button', { name: /Measurement/ }));

        expect(navigate).toHaveBeenCalledWith({ to: '/settings/analysis' });
    });

    it('reaches Plugins the same way, though its route is not under /settings', async () => {
        // The one section whose route was never `/settings/…`, and the palette does not special-case
        // it: `SETTINGS_ROUTES` is what knows, and it is the only thing that does.
        open();
        await setupUser().click(screen.getByRole('button', { name: /Plugins/ }));

        expect(navigate).toHaveBeenCalledWith({ to: '/plugins' });
    });

    // The four cases below are what changed: the palette used to be pages only, and a typed record
    // name answered "no page by that name" for the one thing this station actually exists to hold.
    describe('records and characters', () => {
        it('asks nothing below the two-character floor', async () => {
            open();
            await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'a');

            // A pause would let a debounced call land; there is nothing to wait for here on
            // purpose, so the assertion is made straight away rather than after a `waitFor`.
            expect(listTracks).not.toHaveBeenCalled();
            expect(listArtists).not.toHaveBeenCalled();
        });

        it('lists a matching record under Records, and goes straight to its page', async () => {
            listTracks.mockResolvedValue({
                data: [{ id: 'track-1', title: '1-2-3-4 (Sumpin’ New)', artistName: 'Coolio', artistId: 'artist-1' }],
                meta: { total: 1 },
                states: {},
            });

            open();
            await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'coolio');

            const result = await screen.findByRole('button', { name: /1-2-3-4/ });
            await setupUser().click(result);

            expect(navigate).toHaveBeenCalledWith({ to: '/catalog/tracks/$trackId', params: { trackId: 'track-1' } });
        });

        it('lists a matching artist under Artists', async () => {
            listArtists.mockResolvedValue({ data: [{ id: 'artist-1', name: 'Coolio', albumCount: 1, trackCount: 1 }], meta: { total: 1 } });

            open();
            await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'coolio');

            const result = await screen.findByRole('button', { name: /^Coolio/ });
            await setupUser().click(result);

            expect(navigate).toHaveBeenCalledWith({
                to: '/catalog/artists/$artistId',
                params: { artistId: 'artist-1' },
                search: expect.objectContaining({ page: 0 }),
            });
        });

        // Personas carry no search parameter of their own, so this is a narrowing of the roster
        // already in memory rather than a fourth request — the point this case actually pins.
        it('narrows the roster already in memory rather than asking the API for one', async () => {
            listPersonas.mockResolvedValue({
                personas: [
                    { id: 'p1', key: 'marlowe', label: 'Marlowe', kind: 'host', style: 'noir' },
                    { id: 'p2', key: 'judith', label: 'Judith', kind: 'caller', style: 'pedant' },
                ],
            });

            open();
            await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'marlo');

            const result = await screen.findByRole('button', { name: /Marlowe/ });
            expect(screen.queryByRole('button', { name: /Judith/ })).not.toBeInTheDocument();
            await setupUser().click(result);

            expect(navigate).toHaveBeenCalledWith({ to: '/voice', search: { tab: 'characters', segment: '', persona: 'marlowe' } });
        });
    });
});
