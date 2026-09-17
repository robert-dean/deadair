// What the card says about each kind, and the one control whose enabled state carries an argument:
// Revert is drawn for every kind and disabled where there is nothing to go back to, because a
// control that is absent reads as a feature that is missing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { BreakArtworkList } from '@deadair/sdk';

import { BreakArtCard } from '../../../src/components/settings/break.art.card';
import { render, screen, waitFor } from '../../utils/render';

const listBreakArtwork = vi.fn();
const replaceBreakArtwork = vi.fn();
const revertBreakArtwork = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        art: {
            listBreakArtwork: (...args: unknown[]) => listBreakArtwork(...args),
            replaceBreakArtwork: (...args: unknown[]) => replaceBreakArtwork(...args),
            revertBreakArtwork: (...args: unknown[]) => revertBreakArtwork(...args),
        },
    },
}));

afterEach(() => {
    listBreakArtwork.mockReset();
    replaceBreakArtwork.mockReset();
    revertBreakArtwork.mockReset();
});

const LISTING: BreakArtworkList = {
    breaks: [
        { kind: 'news', url: 'art/aaaa/cover.png', source: 'shipped', hasShipped: true },
        { kind: 'talkbreak', url: 'art/bbbb/cover.jpg', source: 'operator', hasShipped: false },
        { kind: 'weather', url: 'art/cccc/cover.png', source: 'operator', hasShipped: true },
    ],
};

describe('BreakArtCard', () => {
    it('draws every kind the station holds a picture for, and says where the bytes came from', async () => {
        listBreakArtwork.mockResolvedValue(LISTING);

        render(<BreakArtCard />);

        await waitFor(() => expect(screen.getByText('news')).toBeInTheDocument());
        expect(screen.getByText('The one this station ships')).toBeInTheDocument();
        expect(screen.getAllByText('Yours')).toHaveLength(2);
        // Resolved against the API base exactly as a record's cover is, because that is what it is.
        expect(screen.getByAltText('What a news break shows')).toHaveAttribute('src', '/api/art/aaaa/cover.png');
    });

    it('offers the original back only where there is one to go back to', async () => {
        listBreakArtwork.mockResolvedValue(LISTING);

        render(<BreakArtCard />);
        await waitFor(() => expect(screen.getByText('weather')).toBeInTheDocument());

        const buttons = screen.getAllByRole('button', { name: 'Put the original back' });
        // news is already the shipped picture, so there is nothing to undo; talkbreak has no shipped
        // picture at all; weather is an upload over one this repository ships, which is the only case
        // the button means anything in.
        expect(buttons.map(button => button.hasAttribute('disabled'))).toEqual([true, true, false]);
    });

    it('puts the shipped picture back for the kind whose button was pressed', async () => {
        listBreakArtwork.mockResolvedValue(LISTING);
        revertBreakArtwork.mockResolvedValue(LISTING);

        render(<BreakArtCard />);
        await waitFor(() => expect(screen.getByText('weather')).toBeInTheDocument());
        await userEvent.click(screen.getAllByRole('button', { name: 'Put the original back' })[2]!);

        await waitFor(() => expect(revertBreakArtwork).toHaveBeenCalledWith('weather'));
    });

    it('says so rather than drawing an empty page when the station holds nothing', async () => {
        // A first boot before the shipped pictures have been taken in, or a station whose seed
        // failed. Every break wears the logo then, which is a state worth naming.
        listBreakArtwork.mockResolvedValue({ breaks: [] });

        render(<BreakArtCard />);

        await waitFor(() => expect(screen.getByText('No pictures yet')).toBeInTheDocument());
    });

    it('reports a listing it could not read', async () => {
        listBreakArtwork.mockRejectedValue(new Error('no station'));

        render(<BreakArtCard />);

        await waitFor(() => expect(screen.getByText('Could not read what the station shows')).toBeInTheDocument());
    });
});
