// The button that puts an album on air. One press and no menu: an album goes out as a feature, so
// there is nothing to mix in and nobody to ring, and the request carries the album and nothing else.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayAlbumButton } from '../../../src/components/playout/play.playlist.button';
import { render, screen, setupUser } from '../../utils/render';

const playAnAlbum = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playout: {
            playAnAlbum: (...args: unknown[]) => playAnAlbum(...args),
        },
    },
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('PlayAlbumButton', () => {
    it('airs the album with nothing but its id', async () => {
        playAnAlbum.mockResolvedValue({ active: true, items: [] });
        const user = setupUser();
        render(<PlayAlbumButton albumId="al-1" />);

        await user.click(screen.getByRole('button', { name: 'Air this album' }));

        expect(playAnAlbum).toHaveBeenCalledWith({ albumId: 'al-1' });
        expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    });

    it('says so on the button when the station refuses it', async () => {
        playAnAlbum.mockRejectedValue(new Error('no'));
        const user = setupUser();
        render(<PlayAlbumButton albumId="al-1" />);

        await user.click(screen.getByRole('button', { name: 'Air this album' }));

        expect(await screen.findByRole('button', { name: 'Failed' })).toBeInTheDocument();
    });
});
