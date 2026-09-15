// The "Playing from" picker every broadcast is described with: the sustaining panel, a schedule slot
// and a put-on-air all draw it. It offers what the station could actually air from, and never
// drops what it already holds.

import type { GetInputPropsReturnType } from '@mantine/form';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourceField, sourceValue } from '../../../src/components/programme/programme.fields';
import { catalogPlaylist, catalogPlaylistPage } from '../../utils/playlist.fixture';
import { render, screen, setupUser } from '../../utils/render';

const listImportablePlaylists = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: { listImportablePlaylists: () => listImportablePlaylists() },
        charts: { listCharts: () => Promise.resolve({ charts: [] }) },
    },
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
});

const input = (value: string): GetInputPropsReturnType => ({ value, onChange: vi.fn() }) as unknown as GetInputPropsReturnType;

describe('SourceField', () => {
    it('does not offer a playlist an operator hid, nor one its source refuses', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [
                    catalogPlaylist({ id: 'mine', name: 'Mine' }),
                    catalogPlaylist({ id: 'hidden', name: 'Hidden one', hidden: true }),
                    catalogPlaylist({ id: 'refused', name: 'Discover Weekly', permissions: [] }),
                ],
            }),
        );
        const user = setupUser();

        render(<SourceField {...input('')} />);
        await user.click(await screen.findByRole('combobox', { name: 'Playing from' }));

        expect(await screen.findByRole('option', { name: 'Mine — Spotify' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Hidden one — Spotify' })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Discover Weekly — Spotify' })).not.toBeInTheDocument();
    });

    it('still shows the playlist it holds after that playlist was hidden', async () => {
        const held = catalogPlaylist({ id: 'hidden', name: 'Hidden one', hidden: true });
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [held] }));

        render(<SourceField {...input(sourceValue(held.pluginId, held.id))} />);

        expect(await screen.findByDisplayValue('Hidden one — Spotify')).toBeInTheDocument();
    });
});
