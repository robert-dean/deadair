// The button that puts a playlist on air. What is worth pinning is the shape of the request: the
// ordinary press says nothing about mixing similar records in, so the station's own setting stands,
// and only the menu's second action asks for it.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayPlaylistButton } from '../../../src/components/playout/play.playlist.button';
import { render, screen, setupUser } from '../../utils/render';

const playAPlaylist = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playout: {
            playAPlaylist: (...args: unknown[]) => playAPlaylist(...args),
        },
    },
}));

const status = { active: true, items: [] };

afterEach(() => {
    vi.clearAllMocks();
});

describe('PlayPlaylistButton', () => {
    it('airs the playlist and says nothing about mixing, so the station setting stands', async () => {
        playAPlaylist.mockResolvedValue(status);
        const user = setupUser();
        render(<PlayPlaylistButton pluginId="deadair.spotify" playlistId="pl_1" />);

        await user.click(screen.getByRole('button', { name: 'Air this playlist' }));

        expect(playAPlaylist).toHaveBeenCalledWith({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });
    });

    it('asks for similar records to be mixed in from the menu', async () => {
        playAPlaylist.mockResolvedValue(status);
        const user = setupUser();
        render(<PlayPlaylistButton pluginId="deadair.spotify" playlistId="pl_1" />);

        await user.click(screen.getByRole('button', { name: 'More ways to air this playlist' }));
        await user.click(await screen.findByRole('menuitem', { name: 'Air with similar records mixed in' }));

        expect(playAPlaylist).toHaveBeenCalledWith({ pluginId: 'deadair.spotify', playlistId: 'pl_1', mixInSimilar: true });
    });

    it('offers nothing for a playlist the source will not hand over', () => {
        render(<PlayPlaylistButton pluginId="deadair.spotify" playlistId="pl_1" playable={false} />);

        expect(screen.queryByRole('button', { name: 'Air this playlist' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'More ways to air this playlist' })).toBeNull();
    });
});
