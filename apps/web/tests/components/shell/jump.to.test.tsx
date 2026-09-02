import { spotlight } from '@mantine/spotlight';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JumpTo } from '../../../src/components/shell/jump.to';
import { render, screen, setupUser } from '../../utils/render';

const navigate = vi.fn();

// Only the navigation is reached: the palette is a list of places and a way to go to one.
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
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
        act(() => {
            spotlight.close();
        });
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

    it('says so rather than sitting empty when nothing matches', async () => {
        open();
        await setupUser().type(screen.getByPlaceholderText('Jump to anything'), 'lineups');

        expect(screen.getByText('No page by that name.')).toBeInTheDocument();
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
});
